import { DurableObject } from 'cloudflare:workers';
import type {
  Document,
  CrawlRequest,
  BatchScrapeRequest,
  WebhookConfig,
} from '@crawlcheap/contracts';
import {
  scrape,
  mapSite,
  assertSafeUrl,
  fetchRobots,
  isAllowed,
  cloudflareCrawlAvailable,
  startCloudflareCrawl,
  getCloudflareCrawlStatus,
  cancelCloudflareCrawl,
  deriveCrawlParamsFromPrompt,
} from '@crawlcheap/engine';
import { engineEnv, type Env } from './env';
import { deliverWebhook } from './lib/webhook';

/**
 * CrawlCoordinator — one SQLite-backed Durable Object per crawl/batch job.
 *
 * Dual-mode Cloudflare-native architecture:
 *   1. Native Cloudflare Browser Rendering `/crawl` mode (`startCloudflareCrawl` /
 *      `getCloudflareCrawlStatus` / `cancelCloudflareCrawl`) when `BROWSER.crawl` binding
 *      is present or `CF_CRAWL_ENABLED === 'true'` with `CF_ACCOUNT_ID` + `CF_BROWSER_TOKEN`.
 *   2. Alarm-driven Durable Object BFS crawler with configurable `maxConcurrency`,
 *      per-origin politeness, RFC 9309 robots.txt policy, prompt-to-params derivation,
 *      `sitemap: 'only' | 'include' | 'skip'`, and signed completion webhooks.
 */

const MAX_PAGES_CAP = 10_000;
const DEFAULT_BATCH_CONCURRENCY = 5;
const DEFAULT_DELAY_MS = 150;
const FIELD_CAP = 120_000;

interface FrontierItem {
  url: string;
  depth: number;
}

export interface CrawlMeta {
  id?: string;
  status: 'scraping' | 'completed' | 'failed' | 'cancelled';
  url: string;
  options: CrawlRequest;
  total: number;
  completed: number;
  creditsUsed: number;
  createdAt: string;
  completedAt?: string;
  expiresAt: string;
  duration?: number;
  limit: number;
  maxDepth: number;
  maxConcurrency: number;
  mode?: 'crawl' | 'batch';
  cfJobId?: string;
  teamId?: string;
  warning?: string;
}

export interface CrawlError {
  id: string;
  timestamp: string;
  url: string;
  error: string;
}

export interface CrawlStatusResult {
  id?: string;
  status: CrawlMeta['status'];
  total: number;
  completed: number;
  creditsUsed: number;
  createdAt: string;
  completedAt?: string;
  expiresAt: string;
  duration?: number;
  warning?: string;
  data: Document[];
  nextOffset: number | null;
  activeConcurrency?: number;
}

// Track active crawls & idempotency keys across the isolate (+ D1 when bound)
export interface ActiveCrawlEntry {
  id: string;
  teamId: string;
  url: string;
  created_at: string;
  options?: Record<string, unknown>;
  status: 'scraping' | 'completed' | 'failed' | 'cancelled';
  maxConcurrency: number;
  currentConcurrency: number;
}

export const activeCrawlsRegistry = new Map<string, ActiveCrawlEntry>();
export const seenIdempotencyKeys = new Map<string, string>();

export function getActiveConcurrencyForTeam(teamId?: string): number {
  let sum = 0;
  for (const entry of activeCrawlsRegistry.values()) {
    if (entry.status === 'scraping' && (!teamId || entry.teamId === teamId)) {
      sum += entry.currentConcurrency;
    }
  }
  return sum;
}

export async function registerActiveCrawl(
  db: D1Database | undefined,
  entry: ActiveCrawlEntry,
): Promise<void> {
  activeCrawlsRegistry.set(entry.id, entry);
  if (db) {
    try {
      await db
        .prepare(
          'INSERT OR REPLACE INTO active_crawls (id, team_id, url, options, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(
          entry.id,
          entry.teamId,
          entry.url,
          entry.options ? JSON.stringify(entry.options) : null,
          entry.status,
          entry.created_at,
        )
        .run();
    } catch {
      /* in-memory registry already updated */
    }
  }
}

export async function markActiveCrawlFinished(
  db: D1Database | undefined,
  id: string,
  status: 'completed' | 'failed' | 'cancelled' = 'completed',
): Promise<void> {
  const existing = activeCrawlsRegistry.get(id);
  if (existing) {
    existing.status = status;
    existing.currentConcurrency = 0;
  }
  if (db) {
    try {
      await db.prepare('UPDATE active_crawls SET status = ? WHERE id = ?').bind(status, id).run();
    } catch {
      /* ignore */
    }
  }
}

function normalize(u: string, ignoreQuery: boolean): string {
  try {
    const url = new URL(u);
    url.hash = '';
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    return ignoreQuery ? url.origin + path : url.origin + path + url.search;
  } catch {
    return u;
  }
}

function inScope(u: string, base: URL, opts: CrawlRequest): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (opts.allowExternalLinks) return true;
    const norm = (h: string) => h.replace(/^www\./i, '').toLowerCase();
    if (url.hostname.toLowerCase() === base.hostname.toLowerCase()) return true;
    if (norm(url.hostname) === norm(base.hostname) && (opts.allowSubdomains ?? false) !== false) {
      return true;
    }
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

function toRegexPattern(pat: string): RegExp {
  // Support both regex patterns (`^/blog`) and glob wildcards (`/blog/*` where `/*` means `/.*`)
  if (pat.includes('*') && !pat.includes('.*') && !pat.startsWith('^')) {
    const converted = pat.replace(/\*/g, '.*');
    return new RegExp(converted);
  }
  return new RegExp(pat);
}

function pathAllowed(u: string, opts: CrawlRequest): boolean {
  try {
    const parsed = new URL(u);
    const target = opts.regexOnFullURL ? parsed.toString() : parsed.pathname;
    for (const re of opts.excludePaths ?? []) {
      try {
        if (toRegexPattern(re).test(target)) return false;
      } catch {
        /* bad pattern — ignore */
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
    // If crawlEntireDomain and allowBackwardLinks are both explicitly false and base has a subpath, scope to base pathname prefix
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

function capField(s?: string): string | undefined {
  if (s === undefined) return undefined;
  return s.length > FIELD_CAP ? `${s.slice(0, FIELD_CAP)}\n\n…[truncated by crawl.cheap crawl]` : s;
}
function capDoc(d: Document): Document {
  return {
    ...d,
    markdown: capField(d.markdown),
    html: capField(d.html),
    rawHtml: capField(d.rawHtml),
  };
}

function computeDurationSec(createdAt: string, completedAt?: string): number {
  const startMs = Date.parse(createdAt);
  const endMs = completedAt ? Date.parse(completedAt) : Date.now();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 0.001;
  return Math.max(0.001, Number(((endMs - startMs) / 1000).toFixed(3)));
}

export class CrawlCoordinator extends DurableObject<Env> {
  private eng() {
    return engineEnv(this.env);
  }

  /** Initialize the job, seed the frontier (sitemap + start URL), and kick off the alarm loop. */
  async start(
    body: CrawlRequest,
    id?: string,
    teamOpts?: { teamId?: string; teamMaxConcurrency?: number },
  ): Promise<{ ok: true; cfJobId?: string }> {
    const base = assertSafeUrl(body.url);
    const eng = this.eng();

    // 1. Merge prompt-derived parameters (explicit options in `body` always take precedence!)
    let effectiveBody: CrawlRequest = { ...body };
    if (body.prompt && body.prompt.trim().length > 0) {
      try {
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
      } catch {
        /* ignore prompt derivation errors */
      }
    }

    const effectiveSitemap = effectiveBody.ignoreSitemap
      ? 'skip'
      : (effectiveBody.sitemap ?? 'include');
    effectiveBody.sitemap = effectiveSitemap;

    const limit = Math.min(effectiveBody.limit ?? MAX_PAGES_CAP, MAX_PAGES_CAP);
    const ignoreQuery = effectiveBody.ignoreQueryParameters ?? false;
    const teamMax = teamOpts?.teamMaxConcurrency ?? 25;
    const maxConcurrency = Math.min(
      Math.max(effectiveBody.maxConcurrency ?? DEFAULT_BATCH_CONCURRENCY, 1),
      teamMax,
    );
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

    // 2. Try native Cloudflare Browser Rendering `/crawl` when enabled & bound
    let cfJobId: string | undefined;
    const useCfNativeCrawl =
      Boolean(this.env.BROWSER?.crawl) ||
      (this.env.CF_CRAWL_ENABLED === 'true' && cloudflareCrawlAvailable(eng));

    if (useCfNativeCrawl) {
      try {
        const started = await startCloudflareCrawl(effectiveBody, eng);
        cfJobId = started.cfJobId;
      } catch {
        cfJobId = undefined;
      }
    }

    const maxDepth =
      effectiveSitemap === 'only'
        ? 0
        : (effectiveBody.maxDiscoveryDepth ?? effectiveBody.maxDepth ?? 1_000_000);

    const meta: CrawlMeta = {
      id,
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
      ...(cfJobId ? { cfJobId } : {}),
    };

    const seen = new Set<string>([normalize(base.toString(), ignoreQuery)]);
    const frontier: FrontierItem[] = [{ url: base.toString(), depth: 0 }];

    if (!cfJobId && effectiveSitemap !== 'skip') {
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
          const n = normalize(l.url, ignoreQuery);
          if (
            !seen.has(n) &&
            inScope(l.url, base, effectiveBody) &&
            pathAllowed(l.url, effectiveBody)
          ) {
            seen.add(n);
            frontier.push({ url: l.url, depth: 1 });
          }
        }
      } catch {
        /* sitemap optional */
      }
    }

    let robotsTxt: string | null = null;
    if (!cfJobId && effectiveBody.ignoreRobotsTxt !== true) {
      try {
        robotsTxt = await fetchRobots(base, eng);
      } catch {
        robotsTxt = null;
      }
    }

    meta.total = Math.min(limit, frontier.length);
    await this.ctx.storage.put('meta', meta);
    await this.ctx.storage.put('frontier', frontier);
    await this.ctx.storage.put('seen', [...seen]);
    await this.ctx.storage.put('errors', [] as CrawlError[]);
    await this.ctx.storage.put('robotsBlocked', [] as string[]);
    await this.ctx.storage.put('robotsTxt', robotsTxt);
    await this.ctx.storage.setAlarm(Date.now() + 10);
    return { ok: true, ...(cfJobId ? { cfJobId } : {}) };
  }

  /** Initialize a batch-scrape job: a crawl over a fixed frontier with no link discovery. */
  async startBatch(
    body: BatchScrapeRequest,
    id?: string,
    teamOpts?: { teamId?: string; teamMaxConcurrency?: number },
  ): Promise<{ invalidURLs: string[] }> {
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
    const frontier: FrontierItem[] = valid
      .slice(0, MAX_PAGES_CAP)
      .map((u) => ({ url: u, depth: 0 }));

    // Merge optional nested `body.options` with top-level ScrapeOptions
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

    const options = {
      ...body,
      maxDiscoveryDepth: 0,
      scrapeOptions: mergedScrapeOptions,
    } as unknown as CrawlRequest;

    const teamMax = teamOpts?.teamMaxConcurrency ?? 25;
    const maxConcurrency = Math.min(
      Math.max(body.maxConcurrency ?? DEFAULT_BATCH_CONCURRENCY, 1),
      teamMax,
    );
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

    const meta: CrawlMeta = {
      id,
      status: valid.length === 0 ? 'failed' : 'scraping',
      url: valid[0] ?? '',
      options,
      total: frontier.length,
      completed: 0,
      creditsUsed: 0,
      createdAt,
      expiresAt,
      limit: Math.min(Math.max(valid.length, 1), MAX_PAGES_CAP),
      maxDepth: 0,
      maxConcurrency,
      mode: 'batch',
      teamId: teamOpts?.teamId ?? 'default',
    };
    if (valid.length === 0) {
      meta.completedAt = new Date(Date.now() + 2).toISOString();
      meta.duration = computeDurationSec(meta.createdAt, meta.completedAt);
    }

    await this.ctx.storage.put('meta', meta);
    await this.ctx.storage.put('frontier', frontier);
    await this.ctx.storage.put(
      'seen',
      frontier.map((f) => f.url),
    );
    await this.ctx.storage.put('errors', [] as CrawlError[]);
    await this.ctx.storage.put('robotsBlocked', [] as string[]);
    await this.ctx.storage.put('robotsTxt', null);
    if (valid.length > 0) await this.ctx.storage.setAlarm(Date.now() + 10);
    return { invalidURLs };
  }

  override async alarm(): Promise<void> {
    const meta = (await this.ctx.storage.get<CrawlMeta>('meta')) ?? null;
    if (!meta || meta.status !== 'scraping') return;

    // Mode 1: Cloudflare Browser Rendering `/crawl` native job sync
    if (meta.cfJobId) {
      try {
        const cfStatus = await getCloudflareCrawlStatus(meta.cfJobId, this.eng());
        for (let i = 0; i < cfStatus.documents.length; i += 1) {
          await this.ctx.storage.put(`page:${i}`, capDoc(cfStatus.documents[i]!));
        }
        meta.completed = cfStatus.documents.length;
        meta.total = Math.max(cfStatus.total, meta.completed);
        meta.creditsUsed = meta.completed;
        await this.ctx.storage.put('errors', cfStatus.errors);
        await this.ctx.storage.put('robotsBlocked', cfStatus.robotsBlocked);

        if (cfStatus.status !== 'scraping') {
          meta.status = cfStatus.status;
          meta.completedAt = new Date(
            Math.max(Date.now(), Date.parse(meta.createdAt) + 5),
          ).toISOString();
          meta.duration = computeDurationSec(meta.createdAt, meta.completedAt);
          if (meta.id) {
            await markActiveCrawlFinished(this.env.DB, meta.id, cfStatus.status);
          }
          await this.ctx.storage.put('meta', meta);
          return;
        }
        await this.ctx.storage.put('meta', meta);
        await this.ctx.storage.setAlarm(Date.now() + 1000);
        return;
      } catch {
        // Fallback transparently to DO BFS execution if Cloudflare `/crawl` poll fails
        meta.cfJobId = undefined;
      }
    }

    const frontier = (await this.ctx.storage.get<FrontierItem[]>('frontier')) ?? [];
    const seen = new Set<string>((await this.ctx.storage.get<string[]>('seen')) ?? []);
    const errors = (await this.ctx.storage.get<CrawlError[]>('errors')) ?? [];
    const robotsBlocked = (await this.ctx.storage.get<string[]>('robotsBlocked')) ?? [];
    const robotsTxt = (await this.ctx.storage.get<string | null>('robotsTxt')) ?? null;
    const base = new URL(meta.url);
    const opts = meta.options;
    const ignoreQuery = opts.ignoreQueryParameters ?? false;
    const robotUa = opts.robotsUserAgent ?? 'crawlcheapbot';

    const batchSize = Math.min(
      meta.maxConcurrency ?? DEFAULT_BATCH_CONCURRENCY,
      Math.max(1, meta.limit - meta.completed),
    );
    const batch = frontier.splice(0, batchSize);

    if (meta.id) {
      const reg = activeCrawlsRegistry.get(meta.id);
      if (reg) reg.currentConcurrency = batch.length;
    }

    const results = await Promise.all(
      batch.map(async (item) => {
        if (
          opts.ignoreRobotsTxt !== true &&
          robotsTxt &&
          !isAllowed(robotsTxt, new URL(item.url).pathname, robotUa)
        ) {
          return { item, kind: 'robots' as const };
        }
        try {
          const so = opts.scrapeOptions ?? {};
          const wantFormats = so.formats ?? ['markdown'];
          // Always extract links internally during crawl discovery if depth < maxDepth
          const formatsForScrape =
            item.depth < meta.maxDepth && !wantFormats.includes('links')
              ? [...wantFormats, 'links' as const]
              : wantFormats;
          const scrapeOpts = {
            ...so,
            url: item.url,
            formats: formatsForScrape,
            onlyMainContent: so.onlyMainContent ?? true,
          };
          const { document } = await scrape(scrapeOpts as never, this.eng());
          // Remove links if caller didn't ask for links format
          const discoveredLinks = document.links ?? [];
          if (!wantFormats.includes('links')) {
            delete document.links;
          }
          return { item, kind: 'ok' as const, document, discoveredLinks };
        } catch (err) {
          return {
            item,
            kind: 'error' as const,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    for (const res of results) {
      if (meta.completed >= meta.limit) break;
      if (res.kind === 'robots') {
        robotsBlocked.push(res.item.url);
        continue;
      }
      if (res.kind === 'error') {
        errors.push({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          url: res.item.url,
          error: res.error,
        });
        continue;
      }

      const { item, document, discoveredLinks } = res;
      const shouldIncludeDoc =
        meta.mode === 'batch' || pathAllowed(document.metadata?.sourceURL ?? item.url, opts);

      if (shouldIncludeDoc) {
        await this.ctx.storage.put(`page:${meta.completed}`, capDoc(document));
        meta.completed += 1;
        meta.creditsUsed += 1;
      }

      if (item.depth < meta.maxDepth && meta.completed + frontier.length < meta.limit) {
        for (const link of discoveredLinks) {
          if (meta.completed + frontier.length >= meta.limit) break;
          if (!/^https?:/i.test(link)) continue;
          const n = normalize(link, ignoreQuery);
          if (!seen.has(n) && inScope(link, base, opts) && pathAllowed(link, opts)) {
            seen.add(n);
            frontier.push({ url: link, depth: item.depth + 1 });
          }
        }
      }
    }

    // Re-read meta before writing: cancel() may have run while we awaited scrapes
    const latest = await this.ctx.storage.get<CrawlMeta>('meta');
    const cancelled = latest?.status === 'cancelled';
    meta.total = Math.min(meta.limit, meta.completed + frontier.length);
    const done = frontier.length === 0 || meta.completed >= meta.limit;
    if (cancelled) {
      meta.status = 'cancelled';
      meta.completedAt =
        latest?.completedAt ??
        new Date(Math.max(Date.now(), Date.parse(meta.createdAt) + 5)).toISOString();
      meta.duration = computeDurationSec(meta.createdAt, meta.completedAt);
    } else if (done) {
      meta.status = 'completed';
      meta.completedAt = new Date(
        Math.max(Date.now(), Date.parse(meta.createdAt) + 5),
      ).toISOString();
      meta.duration = computeDurationSec(meta.createdAt, meta.completedAt);
    }

    if (done || cancelled) {
      if (robotsBlocked.length > 0) {
        meta.warning = `${robotsBlocked.length} URL(s) were blocked by robots.txt (see robotsBlocked in /errors).`;
      } else if (
        meta.mode === 'crawl' &&
        meta.completed <= 1 &&
        base.pathname &&
        base.pathname !== '/' &&
        !opts.crawlEntireDomain
      ) {
        meta.warning = `Only ${meta.completed} result(s) found for ${base.toString()}. Consider setting crawlEntireDomain=true or starting from a higher-level path on ${base.hostname}.`;
      }
      if (meta.id) {
        await markActiveCrawlFinished(this.env.DB, meta.id, cancelled ? 'cancelled' : 'completed');
      }
    }

    await this.ctx.storage.put('meta', meta);
    await this.ctx.storage.put('frontier', frontier);
    await this.ctx.storage.put('seen', [...seen]);
    await this.ctx.storage.put('errors', errors);
    await this.ctx.storage.put('robotsBlocked', robotsBlocked);

    if (!done && !cancelled) {
      const delay = opts.delay ? Math.min(opts.delay * 1000, 60_000) : DEFAULT_DELAY_MS;
      await this.ctx.storage.setAlarm(Date.now() + delay);
    }

    // Deliver a signed completion webhook (best-effort, retried) when configured.
    if (done && !cancelled && meta.options.webhook && this.env.WEBHOOK_SECRET) {
      const type = meta.mode === 'batch' ? 'batch_scrape.completed' : 'crawl.completed';
      const wh: WebhookConfig =
        typeof meta.options.webhook === 'string'
          ? { url: meta.options.webhook }
          : meta.options.webhook;
      await deliverWebhook(
        wh,
        {
          success: true,
          type,
          id: meta.id ?? '',
          metadata: {
            ...(wh.metadata ?? {}),
            total: meta.total,
            completed: meta.completed,
            creditsUsed: meta.creditsUsed,
          },
        },
        this.env.WEBHOOK_SECRET,
      );
    }
  }

  async status(offset = 0, pageSize = 10): Promise<CrawlStatusResult | null> {
    const meta = (await this.ctx.storage.get<CrawlMeta>('meta')) ?? null;
    if (!meta) return null;
    const end = Math.min(offset + pageSize, meta.completed);
    const data: Document[] = [];
    for (let i = offset; i < end; i += 1) {
      const d = await this.ctx.storage.get<Document>(`page:${i}`);
      if (d) data.push(d);
    }
    const duration =
      meta.duration ??
      (meta.completedAt ? computeDurationSec(meta.createdAt, meta.completedAt) : undefined);
    return {
      id: meta.id,
      status: meta.status,
      total: meta.total,
      completed: meta.completed,
      creditsUsed: meta.creditsUsed,
      createdAt: meta.createdAt,
      completedAt: meta.completedAt,
      expiresAt: meta.expiresAt ?? new Date(Date.parse(meta.createdAt) + 86_400_000).toISOString(),
      ...(duration !== undefined ? { duration } : {}),
      ...(meta.warning ? { warning: meta.warning } : {}),
      data,
      nextOffset: end < meta.completed ? end : null,
    };
  }

  async cancel(): Promise<boolean> {
    const meta = (await this.ctx.storage.get<CrawlMeta>('meta')) ?? null;
    if (!meta) return false;
    if (meta.cfJobId) {
      await cancelCloudflareCrawl(meta.cfJobId, this.eng());
    }
    if (meta.status === 'scraping') {
      meta.status = 'cancelled';
      meta.completedAt = new Date(
        Math.max(Date.now(), Date.parse(meta.createdAt) + 5),
      ).toISOString();
      meta.duration = computeDurationSec(meta.createdAt, meta.completedAt);
      await this.ctx.storage.put('meta', meta);
      await this.ctx.storage.deleteAlarm();
    }
    if (meta.id) await markActiveCrawlFinished(this.env.DB, meta.id, 'cancelled');
    return true;
  }

  async getErrors(): Promise<{ errors: CrawlError[]; robotsBlocked: string[] } | null> {
    const meta = (await this.ctx.storage.get<CrawlMeta>('meta')) ?? null;
    if (!meta) return null;
    return {
      errors: (await this.ctx.storage.get<CrawlError[]>('errors')) ?? [],
      robotsBlocked: (await this.ctx.storage.get<string[]>('robotsBlocked')) ?? [],
    };
  }
}
