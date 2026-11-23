import type {
  BatchScrapeRequest,
  CrawlRequest,
  Document,
  ExtractRequest,
} from '@crawlcheap/contracts';
import {
  assertSafeUrl,
  deriveCrawlParamsFromPrompt,
  extractAvailable,
  extractWithAI,
  fetchRobots,
  isAllowed,
  mapSite,
  scrape,
  synthesizeDeterministicJson,
  webSearch,
} from '@crawlcheap/engine';
import { engineEnv, type Env } from '../env';
import {
  activeCrawlsRegistry,
  markActiveCrawlFinished,
  type CrawlError,
  type CrawlMeta,
  type CrawlStatusResult,
} from '../crawl-do';
import type { ExtractStatusResult } from '../extract-do';

/**
 * In-isolate fallback runners for Crawl, Batch Scrape, and Extract/Agent jobs when
 * Durable Object bindings (`env.CRAWL`, `env.EXTRACT`) are not bound (e.g. in local Vitest
 * execution or lightweight self-hosted Worker mode). When DO bindings ARE present, the
 * routes use the Durable Objects directly.
 */

interface LocalCrawlState {
  meta: CrawlMeta;
  pages: Document[];
  errors: CrawlError[];
  robotsBlocked: string[];
  task?: Promise<void>;
}

const localCrawls = new Map<string, LocalCrawlState>();

interface LocalExtractState {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  data?: unknown;
  sources?: Record<string, string[]>;
  error?: string;
  task?: Promise<void>;
}

const localExtracts = new Map<string, LocalExtractState>();

export const recentScrapeJobs = new Map<string, Document>();

function computeDurationSec(createdAt: string, completedAt?: string): number {
  const s = Date.parse(createdAt);
  const e = completedAt ? Date.parse(completedAt) : Date.now();
  return Math.max(0.001, Number(((e - s) / 1000).toFixed(3)));
}

function toRegexPattern(pat: string): RegExp {
  if (pat.includes('*') && !pat.includes('.*') && !pat.startsWith('^')) {
    return new RegExp(pat.replace(/\*/g, '.*'));
  }
  return new RegExp(pat);
}

function pathAllowedLocal(u: string, opts: CrawlRequest): boolean {
  try {
    const parsed = new URL(u);
    const target = opts.regexOnFullURL ? parsed.toString() : parsed.pathname;
    for (const re of opts.excludePaths ?? []) {
      try {
        if (toRegexPattern(re).test(target)) return false;
      } catch {
        /* ignore */
      }
    }
    if (opts.includePaths && opts.includePaths.length > 0) {
      return opts.includePaths.some((re) => {
        try {
          return toRegexPattern(re).test(target);
        } catch {
          return false;
        }
      });
    }
    const entireDomain = opts.crawlEntireDomain ?? opts.allowBackwardLinks ?? true;
    if (!entireDomain) {
      const basePath = new URL(opts.url).pathname;
      if (basePath && basePath !== '/' && !parsed.pathname.startsWith(basePath)) {
        return false;
      }
    }
    return true;
  } catch {
    return true;
  }
}

function inScopeLocal(u: string, base: URL, opts: CrawlRequest): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (opts.allowExternalLinks) return true;
    const norm = (h: string) => h.replace(/^www\./i, '').toLowerCase();
    if (url.hostname.toLowerCase() === base.hostname.toLowerCase()) return true;
    if (opts.allowSubdomains) {
      const apex = norm(base.hostname);
      if (url.hostname.toLowerCase() === apex || url.hostname.toLowerCase().endsWith(`.${apex}`)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function normalizeLocal(u: string, ignoreQuery: boolean): string {
  try {
    const url = new URL(u);
    url.hash = '';
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    return ignoreQuery ? url.origin + path : url.origin + path + url.search;
  } catch {
    return u;
  }
}

export function getCrawlRunner(env: Env, id: string) {
  if (env.CRAWL) {
    const stub = env.CRAWL.get(env.CRAWL.idFromName(id));
    return {
      start: (
        body: CrawlRequest,
        jobId?: string,
        teamOpts?: { teamId?: string; teamMaxConcurrency?: number },
      ) => stub.start(body, jobId, teamOpts),
      startBatch: (
        body: BatchScrapeRequest,
        jobId?: string,
        teamOpts?: { teamId?: string; teamMaxConcurrency?: number },
      ) => stub.startBatch(body, jobId, teamOpts),
      status: (skip = 0, pageSize = 10) =>
        stub.status(skip, pageSize) as Promise<CrawlStatusResult | null>,
      cancel: () => stub.cancel(),
      getErrors: () =>
        stub.getErrors() as Promise<{ errors: CrawlError[]; robotsBlocked: string[] } | null>,
    };
  }

  return {
    async start(
      body: CrawlRequest,
      jobId = id,
      teamOpts?: { teamId?: string; teamMaxConcurrency?: number },
    ) {
      const base = assertSafeUrl(body.url);
      const eng = engineEnv(env);
      let effectiveBody: CrawlRequest = { ...body };
      if (body.prompt && body.prompt.trim()) {
        const preview = await deriveCrawlParamsFromPrompt(base.toString(), body.prompt, eng);
        effectiveBody = {
          ...preview,
          ...body,
          includePaths: body.includePaths ?? preview.includePaths,
          excludePaths: body.excludePaths ?? preview.excludePaths,
          maxDiscoveryDepth: body.maxDiscoveryDepth ?? body.maxDepth ?? preview.maxDiscoveryDepth,
          allowSubdomains:
            body.allowSubdomains !== undefined
              ? body.allowSubdomains
              : (preview.allowSubdomains ?? false),
          allowExternalLinks:
            body.allowExternalLinks !== undefined
              ? body.allowExternalLinks
              : (preview.allowExternalLinks ?? false),
        };
      }
      const effectiveSitemap = effectiveBody.ignoreSitemap
        ? 'skip'
        : (effectiveBody.sitemap ?? 'include');
      effectiveBody.sitemap = effectiveSitemap;
      const limit = Math.min(effectiveBody.limit ?? 100, 10_000);
      const maxDepth =
        effectiveSitemap === 'only'
          ? 0
          : (effectiveBody.maxDiscoveryDepth ?? effectiveBody.maxDepth ?? 1_000_000);
      const teamMax = teamOpts?.teamMaxConcurrency ?? 25;
      const maxConcurrency = Math.min(Math.max(effectiveBody.maxConcurrency ?? 5, 1), teamMax);
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

      const state: LocalCrawlState = {
        meta: {
          id: jobId,
          status: 'scraping',
          url: base.toString(),
          options: effectiveBody,
          total: 1,
          completed: 0,
          creditsUsed: 0,
          createdAt,
          expiresAt,
          limit,
          maxDepth,
          maxConcurrency,
          mode: 'crawl',
          teamId: teamOpts?.teamId ?? 'default',
        },
        pages: [],
        errors: [],
        robotsBlocked: [],
      };
      localCrawls.set(jobId, state);

      const runAsync = async () => {
        const ignoreQuery = effectiveBody.ignoreQueryParameters ?? false;
        const seen = new Set<string>([normalizeLocal(base.toString(), ignoreQuery)]);
        const frontier: Array<{ url: string; depth: number }> = [
          { url: base.toString(), depth: 0 },
        ];

        if (effectiveSitemap !== 'skip') {
          try {
            const links = await mapSite(
              {
                url: base.toString(),
                limit,
                sitemap: 'only',
                includeSubdomains: Boolean(effectiveBody.allowSubdomains),
                ignoreQueryParameters: ignoreQuery,
              },
              eng,
            );
            for (const l of links) {
              if (frontier.length >= limit) break;
              const n = normalizeLocal(l.url, ignoreQuery);
              if (
                !seen.has(n) &&
                inScopeLocal(l.url, base, effectiveBody) &&
                pathAllowedLocal(l.url, effectiveBody)
              ) {
                seen.add(n);
                frontier.push({ url: l.url, depth: 1 });
              }
            }
          } catch {
            /* ignore */
          }
        }
        state.meta.total = Math.min(limit, frontier.length);

        let robotsTxt: string | null = null;
        if (effectiveBody.ignoreRobotsTxt !== true) {
          try {
            robotsTxt = await fetchRobots(base, eng);
          } catch {
            robotsTxt = null;
          }
        }

        while (frontier.length > 0 && state.meta.completed < limit) {
          if (state.meta.status === 'cancelled') break;
          const batchSize = Math.min(maxConcurrency, limit - state.meta.completed);
          const batch = frontier.splice(0, batchSize);
          const reg = activeCrawlsRegistry.get(jobId);
          if (reg) reg.currentConcurrency = batch.length;

          const batchResults = await Promise.all(
            batch.map(async (item) => {
              if (
                effectiveBody.ignoreRobotsTxt !== true &&
                robotsTxt &&
                !isAllowed(
                  robotsTxt,
                  new URL(item.url).pathname,
                  effectiveBody.robotsUserAgent ?? 'crawlcheapbot',
                )
              ) {
                return { item, kind: 'robots' as const };
              }
              try {
                const so = effectiveBody.scrapeOptions ?? {};
                const wantFormats = so.formats ?? ['markdown'];
                const formatsForScrape =
                  item.depth < maxDepth && !wantFormats.includes('links')
                    ? [...wantFormats, 'links' as const]
                    : wantFormats;
                const { document } = await scrape(
                  {
                    ...so,
                    url: item.url,
                    formats: formatsForScrape,
                    onlyMainContent: so.onlyMainContent ?? true,
                  } as never,
                  eng,
                );
                const discoveredLinks = document.links ?? [];
                if (!wantFormats.includes('links')) delete document.links;
                return { item, kind: 'ok' as const, document, discoveredLinks };
              } catch (e) {
                return {
                  item,
                  kind: 'error' as const,
                  error: e instanceof Error ? e.message : String(e),
                };
              }
            }),
          );

          for (const res of batchResults) {
            if (state.meta.completed >= limit || (state.meta.status as string) === 'cancelled')
              break;
            if (res.kind === 'robots') {
              state.robotsBlocked.push(res.item.url);
              continue;
            }
            if (res.kind === 'error') {
              state.errors.push({
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                url: res.item.url,
                error: res.error,
              });
              continue;
            }
            if (pathAllowedLocal(res.document.metadata?.sourceURL ?? res.item.url, effectiveBody)) {
              state.pages.push(res.document);
              state.meta.completed += 1;
              state.meta.creditsUsed += 1;
            }
            if (res.item.depth < maxDepth && state.meta.completed + frontier.length < limit) {
              for (const link of res.discoveredLinks) {
                if (state.meta.completed + frontier.length >= limit) break;
                if (!/^https?:/i.test(link)) continue;
                const n = normalizeLocal(link, ignoreQuery);
                if (
                  !seen.has(n) &&
                  inScopeLocal(link, base, effectiveBody) &&
                  pathAllowedLocal(link, effectiveBody)
                ) {
                  seen.add(n);
                  frontier.push({ url: link, depth: res.item.depth + 1 });
                }
              }
            }
          }
          state.meta.total = Math.min(limit, state.meta.completed + frontier.length);
          if (effectiveBody.delay && frontier.length > 0 && state.meta.completed < limit) {
            await new Promise((r) => setTimeout(r, Math.min(effectiveBody.delay! * 1000, 10_000)));
          }
        }

        if (state.meta.status !== 'cancelled') {
          state.meta.status = 'completed';
        }
        state.meta.completedAt = new Date(
          Math.max(Date.now(), Date.parse(state.meta.createdAt) + 5),
        ).toISOString();
        state.meta.duration = computeDurationSec(state.meta.createdAt, state.meta.completedAt);
        if (state.robotsBlocked.length > 0) {
          state.meta.warning = `${state.robotsBlocked.length} URL(s) were blocked by robots.txt (see robotsBlocked in /errors).`;
        } else if (
          state.meta.completed <= 1 &&
          base.pathname &&
          base.pathname !== '/' &&
          !effectiveBody.crawlEntireDomain
        ) {
          state.meta.warning = `Only ${state.meta.completed} result(s) found for ${base.toString()}. Consider setting crawlEntireDomain=true or starting from a higher-level path on ${base.hostname}.`;
        }
        await markActiveCrawlFinished(env.DB, jobId, state.meta.status);
      };

      state.task = runAsync();
      return { ok: true as const };
    },

    async startBatch(
      body: BatchScrapeRequest,
      jobId = id,
      teamOpts?: { teamId?: string; teamMaxConcurrency?: number },
    ) {
      const urls = body.urls ?? [];
      const valid: string[] = [];
      const invalidURLs: string[] = [];
      for (const u of urls) {
        try {
          assertSafeUrl(u);
          valid.push(u);
        } catch {
          invalidURLs.push(u);
        }
      }
      const mergedScrapeOptions = {
        ...(body.options ?? {}),
        formats: body.formats ?? body.options?.formats,
        onlyMainContent: body.onlyMainContent ?? body.options?.onlyMainContent,
        includeTags: body.includeTags ?? body.options?.includeTags,
        excludeTags: body.excludeTags ?? body.options?.excludeTags,
        headers: body.headers ?? body.options?.headers,
        waitFor: body.waitFor ?? body.options?.waitFor,
        timeout: body.timeout ?? body.options?.timeout,
        mobile: body.mobile ?? body.options?.mobile,
        proxy: body.proxy ?? body.options?.proxy,
        jsonOptions: body.jsonOptions ?? body.options?.jsonOptions,
        extract: body.extract ?? body.options?.extract,
        parsePDF: body.parsePDF ?? body.options?.parsePDF,
        removeBase64Images: body.removeBase64Images ?? body.options?.removeBase64Images,
      };
      const teamMax = teamOpts?.teamMaxConcurrency ?? 25;
      const maxConcurrency = Math.min(Math.max(body.maxConcurrency ?? 5, 1), teamMax);
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

      const state: LocalCrawlState = {
        meta: {
          id: jobId,
          status: valid.length === 0 ? 'failed' : 'scraping',
          url: valid[0] ?? '',
          options: {
            url: valid[0] ?? 'https://example.com',
            scrapeOptions: mergedScrapeOptions,
          } as CrawlRequest,
          total: valid.length,
          completed: 0,
          creditsUsed: 0,
          createdAt,
          expiresAt,
          limit: Math.max(valid.length, 1),
          maxDepth: 0,
          maxConcurrency,
          mode: 'batch',
          teamId: teamOpts?.teamId ?? 'default',
        },
        pages: [],
        errors: [],
        robotsBlocked: [],
      };
      if (valid.length === 0) {
        state.meta.completedAt = new Date(Date.now() + 2).toISOString();
        state.meta.duration = computeDurationSec(state.meta.createdAt, state.meta.completedAt);
      }
      localCrawls.set(jobId, state);

      if (valid.length > 0) {
        const eng = engineEnv(env);
        const queue = [...valid];
        state.task = (async () => {
          while (queue.length > 0) {
            if (state.meta.status === 'cancelled') break;
            const batch = queue.splice(0, maxConcurrency);
            const reg = activeCrawlsRegistry.get(jobId);
            if (reg) reg.currentConcurrency = batch.length;
            const results = await Promise.all(
              batch.map(async (u) => {
                try {
                  const { document } = await scrape(
                    {
                      ...mergedScrapeOptions,
                      url: u,
                      formats: mergedScrapeOptions.formats ?? ['markdown'],
                    } as never,
                    eng,
                  );
                  return { ok: true as const, document };
                } catch (e) {
                  return {
                    ok: false as const,
                    url: u,
                    error: e instanceof Error ? e.message : String(e),
                  };
                }
              }),
            );
            for (const r of results) {
              if ((state.meta.status as string) === 'cancelled') break;
              if (r.ok) {
                state.pages.push(r.document);
                state.meta.completed += 1;
                state.meta.creditsUsed += 1;
              } else {
                state.errors.push({
                  id: crypto.randomUUID(),
                  timestamp: new Date().toISOString(),
                  url: r.url,
                  error: r.error,
                });
              }
            }
          }
          if (state.meta.status !== 'cancelled') state.meta.status = 'completed';
          state.meta.completedAt = new Date(
            Math.max(Date.now(), Date.parse(state.meta.createdAt) + 5),
          ).toISOString();
          state.meta.duration = computeDurationSec(state.meta.createdAt, state.meta.completedAt);
          await markActiveCrawlFinished(env.DB, jobId, state.meta.status);
        })();
      }
      return { invalidURLs };
    },

    async status(offset = 0, pageSize = 10): Promise<CrawlStatusResult | null> {
      const state = localCrawls.get(id);
      if (!state) return null;
      const end = Math.min(offset + pageSize, state.pages.length);
      const data = state.pages.slice(offset, end);
      return {
        id: state.meta.id,
        status: state.meta.status,
        total: state.meta.total,
        completed: state.meta.completed,
        creditsUsed: state.meta.creditsUsed,
        createdAt: state.meta.createdAt,
        completedAt: state.meta.completedAt,
        expiresAt: state.meta.expiresAt,
        ...(state.meta.duration !== undefined ? { duration: state.meta.duration } : {}),
        ...(state.meta.warning ? { warning: state.meta.warning } : {}),
        data,
        nextOffset: end < state.pages.length ? end : null,
      };
    },

    async cancel(): Promise<boolean> {
      const state = localCrawls.get(id);
      if (!state) return false;
      state.meta.status = 'cancelled';
      state.meta.completedAt = new Date(
        Math.max(Date.now(), Date.parse(state.meta.createdAt) + 5),
      ).toISOString();
      state.meta.duration = computeDurationSec(state.meta.createdAt, state.meta.completedAt);
      await markActiveCrawlFinished(env.DB, id, 'cancelled');
      return true;
    },

    async getErrors(): Promise<{ errors: CrawlError[]; robotsBlocked: string[] } | null> {
      const state = localCrawls.get(id);
      if (!state) return null;
      return { errors: state.errors, robotsBlocked: state.robotsBlocked };
    },
  };
}

export function getExtractRunner(env: Env, id: string) {
  if (env.EXTRACT) {
    const stub = env.EXTRACT.get(env.EXTRACT.idFromName(id));
    return {
      start: (body: ExtractRequest) => stub.start(body),
      status: () => stub.status() as Promise<ExtractStatusResult | null>,
    };
  }

  return {
    async start(body: ExtractRequest): Promise<{ invalidURLs: string[] }> {
      const urls = body.urls ?? [];
      const valid: string[] = [];
      const invalidURLs: string[] = [];
      for (const u of urls) {
        try {
          assertSafeUrl(u);
          valid.push(u);
        } catch {
          invalidURLs.push(u);
        }
      }
      const state: LocalExtractState = {
        id,
        status: 'processing',
        createdAt: new Date().toISOString(),
      };
      localExtracts.set(id, state);

      const eng = engineEnv(env);
      state.task = (async () => {
        try {
          let targetUrls = valid.slice(0, 10);
          if (targetUrls.length === 0 && body.prompt) {
            const { web } = await webSearch(body.prompt, { limit: 3, sources: ['web'] }, eng);
            targetUrls = (web ?? []).map((r) => r.url).slice(0, 5);
          }
          const parts: string[] = [];
          const sources: Record<string, string[]> = {};
          let lastTitle: string | undefined;
          let lastDesc: string | undefined;
          let lastLinks: string[] = [];
          for (const u of targetUrls) {
            try {
              const { document } = await scrape(
                { url: u, formats: ['markdown', 'links'] } as never,
                eng,
              );
              parts.push(`# Source: ${u}\n\n${document.markdown ?? ''}`);
              sources[u] = [u];
              lastTitle = lastTitle ?? document.title;
              lastDesc = lastDesc ?? document.description;
              lastLinks = [...lastLinks, ...(document.links ?? [])];
            } catch {
              sources[u] = [u];
            }
          }
          const combined = parts.join('\n\n---\n\n');
          let data: unknown;
          if (extractAvailable(eng)) {
            try {
              data = await extractWithAI(
                combined,
                {
                  prompt: body.prompt,
                  schema: body.schema as Record<string, unknown> | undefined,
                  systemPrompt: body.systemPrompt,
                },
                eng,
              );
            } catch {
              /* fallback below */
            }
          }
          if (
            data === undefined ||
            data === null ||
            (typeof data === 'object' && '_raw' in (data as Record<string, unknown>))
          ) {
            data = synthesizeDeterministicJson(
              combined,
              { title: lastTitle, description: lastDesc, url: targetUrls[0] },
              lastLinks,
              body.schema as Record<string, unknown> | undefined,
            );
          }
          state.data = data;
          if (body.showSources) state.sources = sources;
          state.status = 'completed';
          state.completedAt = new Date().toISOString();
        } catch (e) {
          state.status = 'failed';
          state.error = e instanceof Error ? e.message : String(e);
          state.completedAt = new Date().toISOString();
        }
      })();
      return { invalidURLs };
    },

    async status(): Promise<ExtractStatusResult | null> {
      const state = localExtracts.get(id);
      if (!state) return null;
      return {
        status: state.status,
        data: state.data,
        sources: state.sources,
        error: state.error,
        createdAt: state.createdAt,
        completedAt: state.completedAt,
      };
    },
  };
}
