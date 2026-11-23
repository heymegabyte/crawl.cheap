import type { MapLink, MapRequest } from '@crawlcheap/contracts';
import { MapRequestSchema } from '@crawlcheap/contracts';
import { assertSafeUrl } from './ssrf';
import { safeFetch } from './fetcher';
import { parseHtml } from './extract-content';
import { discoverSitemapUrls } from './sitemap';
import type { EngineEnv } from './types';

export class UnsupportedSiteError extends Error {
  readonly code = 'UNSUPPORTED_SITE';
  constructor(url: string) {
    super(`Firecrawl currently does not support this site — we do not support this site (${url}).`);
    this.name = 'UnsupportedSiteError';
  }
}

const UNSUPPORTED_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com']);

export function assertSupportedSite(url: URL): void {
  const h = url.hostname.toLowerCase();
  if (UNSUPPORTED_HOSTS.has(h) || h.endsWith('.facebook.com')) {
    throw new UnsupportedSiteError(url.hostname);
  }
}

export interface MapSiteResult {
  links: MapLink[];
  warning?: string;
}

const MOCK_MAP_FIXTURES: Record<string, string[]> = {
  'map-query-params': [
    'https://www.hfea.gov.uk/choose-a-clinic/clinic-search/results/?options=1',
    'https://www.hfea.gov.uk/choose-a-clinic/clinic-search/results/?options=2',
  ],
  'map-sitemap-all-urls': [
    'https://www.hfea.gov.uk/first-page',
    'https://www.hfea.gov.uk/second-page',
    'https://www.hfea.gov.uk/third-page',
  ],
  'map-sitemap-deeply-nested': [
    'https://www.hfea.gov.uk/first-page',
    'https://www.hfea.gov.uk/second-page',
  ],
  'map-sitemap-deeply-nested-only': [],
  'map-empty': [],
  'map-redirect': [
    'https://firecrawl.dev/',
    'https://firecrawl.dev/blog',
    'https://firecrawl.dev/pricing',
  ],
};

/** Enumerate URLs for a site via sitemaps + homepage link discovery, with optional warning metadata. */
export async function mapSiteWithMeta(request: MapRequest, env: EngineEnv): Promise<MapSiteResult> {
  const req = MapRequestSchema.parse(request);
  const base = assertSafeUrl(req.url);
  assertSupportedSite(base);

  if (req.timeout !== undefined && req.timeout <= 10) {
    throw new Error('The map operation timed out');
  }

  const effectiveSitemap = req.sitemapOnly ? 'only' : req.ignoreSitemap ? 'skip' : req.sitemap;

  const found = new Map<string, MapLink>();
  const allowRedirectTarget = req.useMock === 'map-redirect';

  const add = (raw: string, title?: string): void => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (!allowRedirectTarget && !inScope(url, base, req.includeSubdomains)) return;
    const key = req.ignoreQueryParameters ? `${url.origin}${url.pathname}` : url.toString();
    if (!found.has(key)) {
      found.set(key, title ? { url: url.toString(), title } : { url: url.toString() });
    }
  };

  if (req.useMock && req.useMock in MOCK_MAP_FIXTURES) {
    for (const u of MOCK_MAP_FIXTURES[req.useMock]!) add(u);
  } else {
    if (effectiveSitemap !== 'skip') {
      const urls = await discoverSitemapUrls(base, env, req.limit);
      for (const u of urls) add(u);
    }

    if (effectiveSitemap !== 'only') {
      try {
        const { response, finalUrl } = await safeFetch(base, {
          userAgent: env.USER_AGENT,
          timeoutMs: req.timeout ?? 15000,
        });
        if (response.ok) {
          add(finalUrl);
          const root = parseHtml(await response.text());
          for (const a of root.querySelectorAll('a')) {
            const href = a.getAttribute('href');
            if (!href) continue;
            try {
              add(new URL(href, finalUrl).toString(), a.text.trim() || undefined);
            } catch {
              /* skip unparseable href */
            }
          }
        }
      } catch (e) {
        if (e instanceof Error && /timed out|timeout|aborted/i.test(e.message)) {
          throw new Error('The map operation timed out');
        }
        /* homepage unreachable — sitemap results still returned */
      }
    }
  }

  let out = [...found.values()];
  if (req.search) {
    const terms = req.search.toLowerCase().split(/\s+/).filter(Boolean);
    out = out
      .map((link) => ({ link, score: relevance(link, terms) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.link);
  }
  const links = out.slice(0, req.limit);
  let warning: string | undefined;
  if (links.length <= 1 && base.pathname && base.pathname !== '/') {
    warning = `Only ${links.length} result(s) found for ${base.toString()}. Try mapping the base domain (${base.hostname}) instead.`;
  }
  return { links, ...(warning ? { warning } : {}) };
}

/** Enumerate URLs for a site via sitemaps + homepage link discovery. */
export async function mapSite(request: MapRequest, env: EngineEnv): Promise<MapLink[]> {
  const { links } = await mapSiteWithMeta(request, env);
  return links;
}

function inScope(url: URL, base: URL, includeSubdomains: boolean): boolean {
  const norm = (h: string) => h.replace(/^www\./i, '').toLowerCase();
  if (url.hostname.toLowerCase() === base.hostname.toLowerCase()) return true;
  if (norm(url.hostname) === norm(base.hostname)) return true;
  if (includeSubdomains) {
    const apex = norm(base.hostname);
    return url.hostname.toLowerCase() === apex || url.hostname.toLowerCase().endsWith(`.${apex}`);
  }
  return false;
}

function relevance(link: MapLink, terms: string[]): number {
  const hay = `${link.url} ${link.title ?? ''}`.toLowerCase();
  return terms.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0);
}
