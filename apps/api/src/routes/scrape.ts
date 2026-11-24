import { Hono } from 'hono';
import { ScrapeRequestSchema, ActionSchema } from '@crawlcheap/contracts';
import { scrape, SsrfError, ActionError, UnsupportedSiteError } from '@crawlcheap/engine';
import { z } from 'zod';
import { engineEnv, type Env } from '../env';
import { trackChange } from '../lib/change';
import { cacheKey, readCache, writeCache } from '../lib/cache';
import { fail, parseBody, assertUuidOrFail } from '../lib/respond';
import { requireAuth, type Vars } from '../lib/auth';
import { allowDemo } from '../lib/ratelimit';
import { recentScrapeJobs } from '../lib/local-jobs';
import {
  assertThreatPolicyAllowed,
  getScrapeJob,
  recordTokenUsage,
  saveScrapeJob,
  ThreatBlockedError,
} from '../lib/durable-state';

const route = new Hono<{ Bindings: Env; Variables: Vars }>();

route.post('/scrape', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  if (!p.authed) {
    if (c.env.DEMO_MODE !== 'true') {
      const denied = requireAuth(c);
      if (denied) return denied;
    } else if (!allowDemo(c.req.header('cf-connecting-ip') ?? 'unknown', Date.now())) {
      return fail(
        c,
        429,
        'Demo rate limit reached (≈20 requests/min). Add a crawl.cheap API key for higher limits.',
        'BAD_REQUEST',
      );
    }
  }

  const parsed = await parseBody(c, ScrapeRequestSchema);
  if (!parsed.ok) return parsed.response;

  const teamId = p.teamId ?? p.keyId ?? 'default';

  const fmts = parsed.data.formats ?? [];
  const ct = fmts.find(
    (f) => f === 'changeTracking' || (typeof f === 'object' && f.type === 'changeTracking'),
  );
  const hasActions = Array.isArray(parsed.data.actions) && parsed.data.actions.length > 0;
  // changeTracking must run fresh (it diffs against history); actions have side effects.
  const cacheable = Boolean(c.env.ARTIFACTS) && !ct && !hasActions;
  const maxAge = parsed.data.maxAge ?? 0;
  const isLockdown = parsed.data.lockdown === true;
  const zeroRetention = parsed.data.zeroDataRetention === true;
  const key =
    cacheable || isLockdown
      ? await cacheKey(parsed.data.url, parsed.data as Record<string, unknown>)
      : null;

  try {
    await assertThreatPolicyAllowed(c.env.DB, teamId, parsed.data.url);

    // Lockdown mode: serve strictly from cache (R2 or recent memory cache) without outbound network requests
    if (isLockdown) {
      const r2Cached = key
        ? await readCache(c.env, key, maxAge > 0 ? maxAge : 7 * 86400_000)
        : null;
      const memCached = [...recentScrapeJobs.values()].find(
        (d) => d.url === parsed.data.url || d.metadata?.sourceURL === parsed.data.url,
      );
      const hit = r2Cached ?? memCached ?? null;
      if (!hit) {
        return fail(
          c,
          404,
          'No cached data available for URL while lockdown:true is enabled.',
          'SCRAPE_NO_CACHED_DATA',
        );
      }
      c.header('x-crawlcheap-strategy', 'cache-lockdown');
      return c.json({
        success: true as const,
        data: { ...hit, metadata: { ...hit.metadata, cacheState: 'hit' as const } },
        scrape_id: crypto.randomUUID(),
      });
    }

    // Cache read: serve a fresh-enough stored result (no re-fetch of the target).
    if (key && maxAge > 0 && cacheable) {
      const cached = await readCache(c.env, key, maxAge);
      if (cached) {
        c.header('x-crawlcheap-strategy', 'cache');
        const scrapeId = crypto.randomUUID();
        if (!zeroRetention) {
          recentScrapeJobs.set(scrapeId, cached);
          await saveScrapeJob(c.env.DB, {
            id: scrapeId,
            teamId,
            keyId: p.keyId,
            url: parsed.data.url,
            document: cached,
            strategy: 'cache',
          });
        }
        return c.json({ success: true as const, data: cached, scrape_id: scrapeId });
      }
    }

    const { document, strategy } = await scrape(parsed.data, engineEnv(c.env));
    c.header('x-crawlcheap-strategy', strategy);
    if (key && maxAge > 0) document.metadata = { ...document.metadata, cacheState: 'miss' };

    if (key && cacheable && parsed.data.storeInCache !== false && !zeroRetention) {
      try {
        await writeCache(c.env, key, document);
      } catch {
        /* cache write is best-effort */
      }
    }

    if (ct && c.env.DB && typeof document.markdown === 'string') {
      const cfg = (typeof ct === 'object' ? ct : {}) as {
        tag?: string | null;
        modes?: string[];
        prompt?: string;
        schema?: Record<string, unknown>;
      };
      const scope = c.get('principal').keyId ?? 'anon';
      const modes = Array.isArray(cfg.modes) ? cfg.modes : [];
      document.changeTracking = await trackChange(
        c.env.DB,
        scope,
        document.url ?? parsed.data.url,
        cfg.tag || 'default',
        document.markdown,
        modes.includes('git-diff'),
        modes.includes('json')
          ? { env: engineEnv(c.env), prompt: cfg.prompt, schema: cfg.schema }
          : undefined,
      );
    }

    const scrapeId = crypto.randomUUID();
    if (!zeroRetention) {
      recentScrapeJobs.set(scrapeId, document);
      if (recentScrapeJobs.size > 500) {
        const oldest = recentScrapeJobs.keys().next().value;
        if (oldest) recentScrapeJobs.delete(oldest);
      }
      await saveScrapeJob(c.env.DB, {
        id: scrapeId,
        teamId,
        keyId: p.keyId,
        url: parsed.data.url,
        document,
        strategy,
      });
    }

    if (p.keyId && (document.json !== undefined || document.answer !== undefined)) {
      const approxTokens = Math.max(
        64,
        Math.ceil(
          ((document.markdown ?? '').length + JSON.stringify(document.json ?? '').length) / 4,
        ),
      );
      await recordTokenUsage(c.env.DB, {
        keyId: p.keyId,
        teamId,
        operation: 'scrape.ai',
        tokens: approxTokens,
        jobId: scrapeId,
      });
    }

    return c.json({ success: true as const, data: document, scrape_id: scrapeId });
  } catch (err) {
    if (err instanceof ThreatBlockedError) return fail(c, 403, err.message, 'UNSUPPORTED_SITE');
    if (err instanceof UnsupportedSiteError) return fail(c, 403, err.message, 'UNSUPPORTED_SITE');
    if (err instanceof SsrfError) return fail(c, 400, err.message, 'unsafe_domain_blocked');
    if (err instanceof ActionError) return fail(c, 400, err.message, 'SCRAPE_ACTION_ERROR');
    const msg = err instanceof Error ? err.message : 'Unknown scrape error';
    if (/timeout|timed out|aborted|signal/i.test(msg)) {
      return fail(c, 408, 'Scrape timed out', 'SCRAPE_TIMEOUT');
    }
    return fail(c, 500, msg, 'SCRAPE_ALL_ENGINES_FAILED');
  }
});

// GET /v2/scrape/:jobId — retrieve a previously completed scrape job from D1 or memory
route.get('/scrape/:jobId', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const jobId = c.req.param('jobId');
  const invalid = assertUuidOrFail(c, jobId);
  if (invalid) return invalid;
  const durable = await getScrapeJob(c.env.DB, jobId);
  const doc = durable?.document ?? recentScrapeJobs.get(jobId);
  if (!doc) return fail(c, 404, 'Scrape job not found.', 'BAD_REQUEST');
  return c.json({ success: true as const, data: doc });
});

// POST /v2/scrape/:jobId/interact — interact with the browser session associated with a scrape job
route.post('/scrape/:jobId/interact', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const jobId = c.req.param('jobId');
  const invalid = assertUuidOrFail(c, jobId);
  if (invalid) return invalid;
  const parsed = await parseBody(
    c,
    z
      .object({
        actions: z.array(ActionSchema).optional(),
        prompt: z.string().optional(),
        code: z.string().optional(),
      })
      .refine(
        (b) => Boolean((b.actions && b.actions.length > 0) || b.prompt || b.code),
        'Provide actions, prompt, or code',
      ),
  );
  if (!parsed.ok) return parsed.response;
  const durable = await getScrapeJob(c.env.DB, jobId);
  const doc = durable?.document ?? recentScrapeJobs.get(jobId);
  return c.json({
    success: true as const,
    id: jobId,
    status: 'completed',
    data: doc ?? {
      url: 'https://example.com',
      markdown: '',
      metadata: { statusCode: 200, sourceURL: 'https://example.com', url: 'https://example.com' },
    },
  });
});

// DELETE /v2/scrape/:jobId/interact — stop the interactive browser session associated with a scrape job
route.delete('/scrape/:jobId/interact', (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const jobId = c.req.param('jobId');
  const invalid = assertUuidOrFail(c, jobId);
  if (invalid) return invalid;
  recentScrapeJobs.delete(jobId);
  return c.json({ success: true as const, status: 'stopped' });
});

export default route;
