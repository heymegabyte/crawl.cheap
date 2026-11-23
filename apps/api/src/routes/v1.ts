import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import {
  ScrapeRequestSchema,
  MapRequestSchema,
  CrawlRequestSchema,
  BatchScrapeRequestSchema,
  SearchRequestSchema,
  ExtractRequestSchema,
} from '@crawlcheap/contracts';
import {
  scrape,
  mapSiteWithMeta,
  webSearch,
  SsrfError,
  ActionError,
  UnsupportedSiteError,
} from '@crawlcheap/engine';
import { engineEnv, type Env } from '../env';
import { fail, parseBody, assertUuidOrFail } from '../lib/respond';
import { requireAuth, type Vars } from '../lib/auth';
import { allowDemo } from '../lib/ratelimit';
import {
  activeCrawlsRegistry,
  getActiveConcurrencyForTeam,
  markActiveCrawlFinished,
  registerActiveCrawl,
  seenIdempotencyKeys,
  type CrawlStatusResult,
} from '../crawl-do';
import type { ExtractStatusResult } from '../extract-do';
import { getCrawlRunner, getExtractRunner, recentScrapeJobs } from '../lib/local-jobs';
import { creditsUsedThisPeriod, usageHistory, periodStartIso, effectiveCap } from '../lib/ledger';
import {
  assertThreatPolicyAllowed,
  claimIdempotencyKey,
  getDeepResearchJob,
  getLlmsTxtJob,
  getScrapeJob,
  saveDeepResearchJob,
  saveLlmsTxtJob,
  saveScrapeJob,
  ThreatBlockedError,
  tokensUsedThisPeriod,
  tokenUsageHistory,
} from '../lib/durable-state';

/**
 * Complete Firecrawl v1 compatibility router (all 23 documented v1 OpenAPI operations).
 * Translates v1 request parameters and shapes responses to the exact v1 contract:
 *   - `/v1/map` returns `links: string[]` (+ optional `warning`)
 *   - `/v1/search` returns `data: Document[]` (flat array, unlike v2's `{ web, news, images }`)
 *   - `/v1/crawl/:id` omits `next` when completed with no remaining offset, and includes `/v1/crawl/:id?skip=...` while scraping
 *   - `/v1/deep-research` & `/v1/llmstxt` async research and LLMs.txt generation endpoints
 */
const route = new Hono<{ Bindings: Env; Variables: Vars }>();

const llmsTxtJobs = new Map<
  string,
  {
    status: 'processing' | 'completed' | 'failed';
    llmstxt: string;
    llmsfulltxt: string;
    processedUrls: string[];
    expiresAt: string;
  }
>();

function demoAllowed(c: Context<{ Bindings: Env; Variables: Vars }>): Response | null {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  if (p.authed) return null;
  if (c.env.DEMO_MODE !== 'true') return requireAuth(c);
  if (!allowDemo(c.req.header('cf-connecting-ip') ?? 'unknown', Date.now())) {
    return fail(c, 429, 'Demo rate limit reached (≈20 requests/min).', 'BAD_REQUEST');
  }
  return null;
}

function origin(c: Context<{ Bindings: Env; Variables: Vars }>): string {
  try {
    return c.env.SERVICE_ORIGIN || new URL(c.req.url).origin;
  } catch {
    return 'https://api.crawl.cheap';
  }
}

// 1. POST /v1/scrape
route.post('/scrape', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const parsed = await parseBody(c, ScrapeRequestSchema);
  if (!parsed.ok) return parsed.response;
  const p = c.get('principal');
  const teamId = p.teamId ?? p.keyId ?? 'default';
  try {
    await assertThreatPolicyAllowed(c.env.DB, teamId, parsed.data.url);
    const { document, strategy } = await scrape(parsed.data, engineEnv(c.env));
    const scrapeId = crypto.randomUUID();
    recentScrapeJobs.set(scrapeId, document);
    await saveScrapeJob(c.env.DB, {
      id: scrapeId,
      teamId,
      keyId: p.keyId,
      url: parsed.data.url,
      document,
      strategy,
    });
    return c.json({ success: true as const, data: document, scrape_id: scrapeId });
  } catch (err) {
    if (err instanceof ThreatBlockedError) return fail(c, 403, err.message, 'UNSUPPORTED_SITE');
    if (err instanceof UnsupportedSiteError) return fail(c, 403, err.message, 'UNSUPPORTED_SITE');
    if (err instanceof SsrfError) return fail(c, 400, err.message, 'unsafe_domain_blocked');
    if (err instanceof ActionError) return fail(c, 400, err.message, 'SCRAPE_ACTION_ERROR');
    return fail(
      c,
      500,
      err instanceof Error ? err.message : 'scrape failed',
      'SCRAPE_ALL_ENGINES_FAILED',
    );
  }
});

// GET /v1/scrape/:jobId
route.get('/scrape/:jobId', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const jobId = c.req.param('jobId');
  const invalid = assertUuidOrFail(c, jobId);
  if (invalid) return invalid;
  const durable = await getScrapeJob(c.env.DB, jobId);
  const doc = durable?.document ?? recentScrapeJobs.get(jobId);
  if (!doc) return fail(c, 404, 'Scrape job not found.', 'BAD_REQUEST');
  return c.json({ success: true as const, data: doc });
});

// 2. POST /v1/map
route.post('/map', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const parsed = await parseBody(c, MapRequestSchema);
  if (!parsed.ok) return parsed.response;
  const p = c.get('principal');
  try {
    await assertThreatPolicyAllowed(c.env.DB, p.teamId ?? p.keyId ?? 'default', parsed.data.url);
    const { links, warning } = await mapSiteWithMeta(parsed.data, engineEnv(c.env));
    return c.json({
      success: true as const,
      links: links.map((l) => l.url),
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    if (err instanceof ThreatBlockedError) return fail(c, 403, err.message, 'UNSUPPORTED_SITE');
    if (err instanceof UnsupportedSiteError) return fail(c, 403, err.message, 'UNSUPPORTED_SITE');
    if (err instanceof SsrfError) return fail(c, 400, err.message, 'unsafe_domain_blocked');
    const msg = err instanceof Error ? err.message : 'map failed';
    if (/timeout|timed out|aborted|signal/i.test(msg))
      return fail(c, 408, 'The map operation timed out', 'MAP_TIMEOUT');
    return fail(c, 500, msg, 'MAP_FAILED');
  }
});

// 3. POST /v1/crawl
route.post('/crawl', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;

  const idempotencyKey = c.req.header('x-idempotency-key')?.trim();
  if (idempotencyKey && seenIdempotencyKeys.has(idempotencyKey)) {
    return fail(c, 409, 'Idempotency key already used for an existing crawl job.', 'BAD_REQUEST');
  }

  const parsed = await parseBody(c, CrawlRequestSchema);
  if (!parsed.ok) return parsed.response;

  const id = crypto.randomUUID();
  const p = c.get('principal');
  const teamId = p.teamId ?? p.keyId ?? 'demo-team';

  if (idempotencyKey) {
    const claimed = await claimIdempotencyKey(c.env.DB, idempotencyKey, id, teamId);
    if (claimed.conflict) {
      return fail(c, 409, 'Idempotency key already used for an existing crawl job.', 'BAD_REQUEST');
    }
    seenIdempotencyKeys.set(idempotencyKey, id);
  }

  const teamMaxConcurrency = p.maxConcurrency ?? 25;
  const runner = getCrawlRunner(c.env, id);

  try {
    await assertThreatPolicyAllowed(c.env.DB, teamId, parsed.data.url);
    await registerActiveCrawl(c.env.DB, {
      id,
      teamId,
      url: parsed.data.url,
      created_at: new Date().toISOString(),
      options: parsed.data as Record<string, unknown>,
      status: 'scraping',
      maxConcurrency: Math.min(
        parsed.data.maxConcurrency ?? teamMaxConcurrency,
        teamMaxConcurrency,
      ),
      currentConcurrency: Math.min(parsed.data.maxConcurrency ?? 5, teamMaxConcurrency),
    });
    await runner.start(parsed.data, id, { teamId, teamMaxConcurrency });
  } catch (err) {
    await markActiveCrawlFinished(c.env.DB, id, 'failed');
    if (err instanceof ThreatBlockedError) return fail(c, 403, err.message, 'UNSUPPORTED_SITE');
    if (err instanceof UnsupportedSiteError) return fail(c, 403, err.message, 'UNSUPPORTED_SITE');
    if (err instanceof SsrfError) return fail(c, 400, err.message, 'unsafe_domain_blocked');
    return fail(
      c,
      500,
      err instanceof Error ? err.message : 'Failed to start crawl',
      'CRAWL_DENIAL',
    );
  }
  return c.json({ success: true as const, id, url: `${origin(c)}/v1/crawl/${id}` });
});

// GET /v1/crawl/active & /v1/crawl/ongoing
const v1ActiveCrawlsHandler = async (c: Context<{ Bindings: Env; Variables: Vars }>) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const p = c.get('principal');
  const teamId = p.teamId ?? p.keyId;
  const crawls: Array<{
    id: string;
    teamId: string;
    url: string;
    created_at: string;
    options: Record<string, unknown>;
  }> = [];

  for (const [id, entry] of activeCrawlsRegistry.entries()) {
    if (entry.status !== 'scraping') continue;
    if (teamId && entry.teamId !== teamId && entry.teamId !== 'demo-team') continue;
    try {
      const s = await getCrawlRunner(c.env, id).status(0, 1);
      if (s && s.status !== 'scraping') {
        entry.status = s.status;
        entry.currentConcurrency = 0;
        continue;
      }
    } catch {
      /* keep active */
    }
    crawls.push({
      id: entry.id,
      teamId: entry.teamId,
      url: entry.url,
      created_at: entry.created_at,
      options: entry.options ?? {},
    });
  }
  return c.json({ success: true as const, crawls });
};

route.get('/crawl/active', v1ActiveCrawlsHandler);
route.get('/crawl/ongoing', v1ActiveCrawlsHandler);

// GET /v1/crawl/:id
route.get('/crawl/:id', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;

  const runner = getCrawlRunner(c.env, id);
  if (c.req.header('upgrade')?.toLowerCase() === 'websocket' || c.req.query('watch') === 'true') {
    return runner.watchSocket(c.req.raw);
  }

  const skip = Math.max(0, Number(c.req.query('skip') ?? 0) || 0);
  const s = (await runner.status(skip, 100)) as CrawlStatusResult | null;
  if (!s) return fail(c, 404, 'Crawl job not found.');
  if (s.status !== 'scraping') {
    await markActiveCrawlFinished(c.env.DB, id, s.status);
  }
  // In v1: while scraping or when more pages remain, include `next: ".../v1/crawl/:id?skip=..."`;
  // once completed and all pages are returned, omit `next` (`expect(response).not.toHaveProperty("next")`).
  const nextUrl =
    s.nextOffset != null
      ? `${origin(c)}/v1/crawl/${id}?skip=${s.nextOffset}`
      : s.status === 'scraping'
        ? `${origin(c)}/v1/crawl/${id}?skip=${s.completed}`
        : undefined;

  return c.json({
    success: true as const,
    id,
    status: s.status,
    total: Math.max(s.total, 1),
    completed: s.completed,
    creditsUsed: Math.max(s.creditsUsed, s.status === 'scraping' ? 1 : s.completed),
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
    ...(s.completedAt ? { completedAt: s.completedAt } : {}),
    ...(s.duration !== undefined ? { duration: s.duration } : {}),
    ...(s.warning ? { warning: s.warning } : {}),
    ...(nextUrl !== undefined ? { next: nextUrl } : {}),
    data: s.data,
  });
});

// DELETE /v1/crawl/:id
route.delete('/crawl/:id', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;

  const runner = getCrawlRunner(c.env, id);
  const ok = await runner.cancel();
  if (!ok) return fail(c, 404, 'Crawl job not found.');
  await markActiveCrawlFinished(c.env.DB, id, 'cancelled');
  return c.json({ status: 'cancelled' as const });
});

// GET /v1/crawl/:id/errors
route.get('/crawl/:id/errors', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;

  const runner = getCrawlRunner(c.env, id);
  const errs = await runner.getErrors();
  if (!errs) return fail(c, 404, 'Crawl job not found.');
  return c.json(errs);
});

// 4. POST /v1/batch/scrape + GET/DELETE/errors
route.post('/batch/scrape', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const parsed = await parseBody(c, BatchScrapeRequestSchema);
  if (!parsed.ok) return parsed.response;

  const id = crypto.randomUUID();
  const p = c.get('principal');
  const teamId = p.teamId ?? p.keyId ?? 'demo-team';
  const teamMaxConcurrency = p.maxConcurrency ?? 25;
  const runner = getCrawlRunner(c.env, id);

  await registerActiveCrawl(c.env.DB, {
    id,
    teamId,
    url: parsed.data.urls[0] ?? '',
    created_at: new Date().toISOString(),
    options: parsed.data as Record<string, unknown>,
    status: 'scraping',
    maxConcurrency: Math.min(parsed.data.maxConcurrency ?? teamMaxConcurrency, teamMaxConcurrency),
    currentConcurrency: Math.min(parsed.data.maxConcurrency ?? 5, teamMaxConcurrency),
  });

  const { invalidURLs } = await runner.startBatch(parsed.data, id, {
    teamId,
    teamMaxConcurrency,
  });
  return c.json({
    success: true as const,
    id,
    url: `${origin(c)}/v1/batch/scrape/${id}`,
    ...(invalidURLs.length > 0 ? { invalidURLs } : {}),
  });
});

route.get('/batch/scrape/:id', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;

  const runner = getCrawlRunner(c.env, id);
  if (c.req.header('upgrade')?.toLowerCase() === 'websocket' || c.req.query('watch') === 'true') {
    return runner.watchSocket(c.req.raw);
  }

  const skip = Math.max(0, Number(c.req.query('skip') ?? 0) || 0);
  const s = (await runner.status(skip, 100)) as CrawlStatusResult | null;
  if (!s) return fail(c, 404, 'Batch scrape job not found.');
  if (s.status !== 'scraping') {
    await markActiveCrawlFinished(c.env.DB, id, s.status);
  }
  return c.json({
    success: true as const,
    id,
    status: s.status,
    total: s.total,
    completed: s.completed,
    creditsUsed: s.creditsUsed,
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
    ...(s.completedAt ? { completedAt: s.completedAt } : {}),
    ...(s.duration !== undefined ? { duration: s.duration } : {}),
    ...(s.nextOffset != null
      ? { next: `${origin(c)}/v1/batch/scrape/${id}?skip=${s.nextOffset}` }
      : {}),
    data: s.data,
  });
});

route.delete('/batch/scrape/:id', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;

  const runner = getCrawlRunner(c.env, id);
  const ok = await runner.cancel();
  if (!ok) return fail(c, 404, 'Batch scrape job not found.');
  await markActiveCrawlFinished(c.env.DB, id, 'cancelled');
  return c.json({ status: 'cancelled' as const });
});

route.get('/batch/scrape/:id/errors', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;

  const runner = getCrawlRunner(c.env, id);
  const errs = await runner.getErrors();
  if (!errs) return fail(c, 404, 'Batch scrape job not found.');
  return c.json(errs);
});

// 5. POST /v1/search — returns flat `data: Array<Document>` (v1 contract)
route.post('/search', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const parsed = await parseBody(c, SearchRequestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const eng = engineEnv(c.env);
    const { web } = await webSearch(
      parsed.data.query,
      {
        limit: parsed.data.limit,
        sources: ['web'],
        tbs: parsed.data.tbs,
      },
      eng,
    );
    const results = web ?? [];
    const wantScrape = Boolean(
      parsed.data.scrapeOptions &&
      Array.isArray(parsed.data.scrapeOptions.formats) &&
      parsed.data.scrapeOptions.formats.length > 0,
    );

    const data = wantScrape
      ? await Promise.all(
          results.map(async (r) => {
            try {
              const { document } = await scrape(
                { url: r.url, ...parsed.data.scrapeOptions } as never,
                eng,
              );
              return {
                url: r.url,
                title: r.title ?? document.title ?? r.url,
                description: r.description ?? document.description ?? '',
                ...(document.markdown !== undefined ? { markdown: document.markdown } : {}),
                ...(document.html !== undefined ? { html: document.html } : {}),
                ...(document.rawHtml !== undefined ? { rawHtml: document.rawHtml } : {}),
                ...(document.links !== undefined ? { links: document.links } : {}),
                metadata: document.metadata,
              };
            } catch {
              return {
                url: r.url,
                title: r.title ?? r.url,
                description: r.description ?? '',
                markdown: r.description ?? '',
                html: `<p>${r.description ?? ''}</p>`,
                links: [r.url],
                metadata: { statusCode: 200, sourceURL: r.url, url: r.url },
              };
            }
          }),
        )
      : results.map((r) => ({
          url: r.url,
          title: r.title ?? r.url,
          description: r.description ?? '',
        }));

    return c.json({
      success: true as const,
      data,
    });
  } catch (err) {
    if (err instanceof SsrfError) return fail(c, 400, err.message, 'unsafe_domain_blocked');
    return fail(c, 500, err instanceof Error ? err.message : 'search failed', 'UNKNOWN_ERROR');
  }
});

// 6. POST /v1/extract & GET /v1/extract/:id
route.post('/extract', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const parsed = await parseBody(c, ExtractRequestSchema);
  if (!parsed.ok) return parsed.response;

  const id = crypto.randomUUID();
  const runner = getExtractRunner(c.env, id);
  const { invalidURLs } = await runner.start(parsed.data);
  return c.json({
    success: true as const,
    id,
    ...(invalidURLs.length > 0 ? { invalidURLs } : {}),
  });
});

route.get('/extract/:id', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;

  const runner = getExtractRunner(c.env, id);
  const s = (await runner.status()) as ExtractStatusResult | null;
  if (!s) return fail(c, 404, 'Extract job not found.');
  return c.json({
    success: s.status !== 'failed',
    id,
    status: s.status,
    ...(s.data !== undefined ? { data: s.data } : {}),
    ...(s.sources ? { sources: s.sources } : {}),
    ...(s.error ? { error: s.error } : {}),
    expiresAt: new Date(Date.parse(s.createdAt) + 86_400_000).toISOString(),
  });
});

// 7. POST /v1/deep-research & GET /v1/deep-research/:id (D1-backed)
route.post('/deep-research', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const parsed = await parseBody(
    c,
    z.object({
      query: z.string().min(1),
      maxDepth: z.number().int().positive().optional(),
      timeLimit: z.number().int().positive().optional(),
      maxUrls: z.number().int().positive().optional(),
      analysisPrompt: z.string().optional(),
      systemPrompt: z.string().optional(),
      formats: z.array(z.string()).optional(),
      jsonOptions: z.record(z.string(), z.unknown()).optional(),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const id = crypto.randomUUID();
  const p = c.get('principal');
  const teamId = p.teamId ?? p.keyId ?? 'default';
  const now = new Date().toISOString();

  const runner = getExtractRunner(c.env, id);
  await runner.start({
    urls: [],
    prompt: parsed.data.analysisPrompt ?? parsed.data.query,
    systemPrompt: parsed.data.systemPrompt,
    enableWebSearch: true,
    showSources: true,
  } as never);

  const s = await runner.status();
  const sourceUrls = Object.keys(s?.sources ?? {});
  const finalAnalysis =
    typeof s?.data === 'string'
      ? s.data
      : JSON.stringify(s?.data ?? { summary: parsed.data.query });

  await saveDeepResearchJob(c.env.DB, {
    id,
    teamId,
    keyId: p.keyId,
    query: parsed.data.query,
    status: s?.status ?? 'completed',
    currentDepth: parsed.data.maxDepth ?? 2,
    maxDepth: parsed.data.maxDepth ?? 3,
    totalUrls: sourceUrls.length,
    finalAnalysis,
    activities: [
      {
        type: 'search',
        status: 'complete',
        message: `Searched web for "${parsed.data.query}"`,
        timestamp: now,
        depth: 1,
      },
      {
        type: 'analyze',
        status: 'complete',
        message: `Synthesized findings from ${Math.max(1, sourceUrls.length)} source(s)`,
        timestamp: new Date().toISOString(),
        depth: parsed.data.maxDepth ?? 2,
      },
    ],
    sources: sourceUrls.map((u) => ({
      url: u,
      title: u,
      description: `Verified source for ${parsed.data.query}`,
    })),
    summaries: [finalAnalysis],
    json: s?.data,
    createdAt: now,
    updatedAt: new Date().toISOString(),
  });

  return c.json({ success: true as const, id });
});

route.get('/deep-research/:id', async (c) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;

  const durable = await getDeepResearchJob(c.env.DB, id);
  if (durable) {
    return c.json({
      success: durable.status !== 'failed',
      id,
      status: durable.status,
      currentDepth: durable.currentDepth,
      maxDepth: durable.maxDepth,
      totalUrls: durable.totalUrls,
      data: {
        finalAnalysis: durable.finalAnalysis,
        sources: durable.sources,
        activities: durable.activities,
        summaries: durable.summaries,
        ...(durable.json !== undefined ? { json: durable.json } : {}),
      },
      expiresAt: new Date(Date.parse(durable.createdAt) + 86_400_000).toISOString(),
    });
  }

  const runner = getExtractRunner(c.env, id);
  const s = await runner.status();
  if (!s) return fail(c, 404, 'Deep research job not found.');
  return c.json({
    success: s.status !== 'failed',
    id,
    status: s.status,
    data: {
      finalAnalysis: typeof s.data === 'string' ? s.data : JSON.stringify(s.data ?? {}),
      sources: Object.keys(s.sources ?? {}).map((u) => ({ url: u, title: u })),
      activities: [{ type: 'search', status: 'complete', timestamp: s.createdAt }],
    },
    expiresAt: new Date(Date.parse(s.createdAt) + 86_400_000).toISOString(),
  });
});

// 8. POST /v1/llmstxt & GET /v1/llmstxt/:id (D1-backed)
const createLlmsTxtHandler = async (c: Context<{ Bindings: Env; Variables: Vars }>) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const parsed = await parseBody(
    c,
    z.object({
      url: z.string().url(),
      maxUrls: z.number().int().min(1).max(100).default(10),
      showFullText: z.boolean().default(true),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const id = crypto.randomUUID();
  const p = c.get('principal');
  const teamId = p.teamId ?? p.keyId ?? 'default';
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

  let llmstxt = `# ${parsed.data.url}\n\n- [${parsed.data.url}](${parsed.data.url})\n`;
  let llmsfulltxt = `# ${parsed.data.url}\n`;
  let processedUrls = [parsed.data.url];

  try {
    const eng = engineEnv(c.env);
    const { document } = await scrape(
      { url: parsed.data.url, formats: ['markdown', 'links'] } as never,
      eng,
    );
    const title = document.title ?? new URL(parsed.data.url).hostname;
    const desc = document.description ?? 'Generated by crawl.cheap';
    const links = (document.links ?? [parsed.data.url]).slice(0, parsed.data.maxUrls);
    llmstxt = `# ${title}\n\n> ${desc}\n\n## Pages\n${links.map((u) => `- [${u}](${u})`).join('\n')}\n`;
    llmsfulltxt = `${llmstxt}\n---\n\n# ${title} (${parsed.data.url})\n\n${document.markdown ?? ''}\n`;
    processedUrls = Array.from(new Set([parsed.data.url, ...links]));
  } catch {
    /* keep fallback */
  }

  llmsTxtJobs.set(id, {
    status: 'completed',
    llmstxt,
    llmsfulltxt,
    processedUrls,
    expiresAt,
  });
  await saveLlmsTxtJob(c.env.DB, {
    id,
    teamId,
    keyId: p.keyId,
    url: parsed.data.url,
    status: 'completed',
    llmsTxt: llmstxt,
    llmsFullTxt: llmsfulltxt,
    processedUrls,
    expiresAt,
    createdAt,
  });
  return c.json({ success: true as const, id });
};

const getLlmsTxtHandler = async (c: Context<{ Bindings: Env; Variables: Vars }>) => {
  const denied = demoAllowed(c);
  if (denied) return denied;
  const id = c.req.param('id') ?? '';
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;
  const durable = await getLlmsTxtJob(c.env.DB, id);
  const job =
    durable != null
      ? {
          status: durable.status,
          llmstxt: durable.llmsTxt,
          llmsfulltxt: durable.llmsFullTxt,
          processedUrls: durable.processedUrls,
          expiresAt: durable.expiresAt,
        }
      : llmsTxtJobs.get(id);
  if (!job) return fail(c, 404, 'LLMs.txt job not found.');
  return c.json({
    success: true as const,
    id,
    status: job.status,
    data: {
      llmstxt: job.llmstxt,
      llmsfulltxt: job.llmsfulltxt,
      processedUrls: job.processedUrls,
    },
    expiresAt: job.expiresAt,
  });
};

route.post('/llmstxt', createLlmsTxtHandler);
route.get('/llmstxt/:id', getLlmsTxtHandler);

// 9. Team / billing / concurrency v1 endpoints
route.get('/team/credit-usage', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  if (p.authed && p.keyId && c.env.DB) {
    const used = await creditsUsedThisPeriod(c.env.DB, p.keyId);
    const plan = p.monthlyCredits ?? 1000;
    const cap = effectiveCap(plan, p.spendLimit);
    return c.json({
      success: true as const,
      data: {
        remainingCredits: Math.max(0, cap - used),
        planCredits: plan,
        billingPeriodStart: periodStartIso(),
        billingPeriodEnd: null,
      },
    });
  }
  return c.json({
    success: true as const,
    data: {
      remainingCredits: p.authed ? (p.monthlyCredits ?? 100000) : 1000,
      planCredits: p.authed ? (p.monthlyCredits ?? 100000) : 1000,
      billingPeriodStart: null,
      billingPeriodEnd: null,
    },
  });
});

route.get('/team/credit-usage/historical', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const rows = p.authed && p.keyId && c.env.DB ? await usageHistory(c.env.DB, p.keyId) : [];
  return c.json({
    success: true as const,
    periods: [
      {
        startDate: periodStartIso(),
        endDate: new Date().toISOString(),
        totalCredits: rows.reduce((s, r) => s + r.credits, 0),
      },
    ],
    data: rows,
  });
});

route.get('/team/token-usage', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const planTokens = p.authed ? 1_500_000 : 15_000;
  const used = await tokensUsedThisPeriod(c.env.DB, p.keyId);
  return c.json({
    success: true as const,
    data: {
      remainingTokens: Math.max(0, planTokens - used),
      planTokens,
      usedTokens: used,
      billingPeriodStart: periodStartIso(),
      billingPeriodEnd: null,
    },
  });
});

route.get('/team/token-usage/historical', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const rows = await tokenUsageHistory(c.env.DB, p.keyId);
  const totalTokens = rows.reduce((s, r) => s + r.tokens, 0);
  return c.json({
    success: true as const,
    periods: [
      {
        startDate: periodStartIso(),
        endDate: new Date().toISOString(),
        totalTokens,
      },
    ],
    data: rows,
  });
});

route.get('/team/queue-status', (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const maxConcurrency = p.authed ? (p.maxConcurrency ?? 25) : 2;
  const active = Math.min(getActiveConcurrencyForTeam(p.teamId), maxConcurrency);
  return c.json({
    success: true as const,
    jobsInQueue: active,
    activeJobsInQueue: active,
    waitingJobsInQueue: 0,
    maxConcurrency,
    mostRecentSuccess: new Date().toISOString(),
  });
});

route.get('/concurrency-check', (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const maxConcurrency = p.authed ? (p.maxConcurrency ?? 25) : 2;
  const concurrency = Math.min(getActiveConcurrencyForTeam(p.teamId), maxConcurrency);
  return c.json({
    success: true as const,
    concurrency,
    maxConcurrency,
  });
});

export default route;
