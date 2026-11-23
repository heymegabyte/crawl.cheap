import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { CrawlRequestSchema } from '@crawlcheap/contracts';
import { SsrfError, UnsupportedSiteError, deriveCrawlParamsFromPrompt } from '@crawlcheap/engine';
import { engineEnv, type Env } from '../env';
import {
  activeCrawlsRegistry,
  markActiveCrawlFinished,
  registerActiveCrawl,
  seenIdempotencyKeys,
  type CrawlStatusResult,
} from '../crawl-do';
import { fail, parseBody, assertUuidOrFail } from '../lib/respond';
import { requireAuth, type Vars } from '../lib/auth';
import { allowDemo } from '../lib/ratelimit';
import { getCrawlRunner } from '../lib/local-jobs';
import {
  assertThreatPolicyAllowed,
  claimIdempotencyKey,
  ThreatBlockedError,
} from '../lib/durable-state';

const route = new Hono<{ Bindings: Env; Variables: Vars }>();

function gate(c: Context<{ Bindings: Env; Variables: Vars }>): Response | null {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  if (p.authed) return null;
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
  return null;
}

function origin(c: Context<{ Bindings: Env; Variables: Vars }>): string {
  try {
    return c.env.SERVICE_ORIGIN || new URL(c.req.url).origin;
  } catch {
    return 'https://api.crawl.cheap';
  }
}

route.post('/crawl', async (c) => {
  const denied = gate(c);
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
  return c.json({ success: true as const, id, url: `${origin(c)}/v2/crawl/${id}` });
});

// POST /v2/crawl/params-preview — derive crawl parameters from natural-language prompt
route.post('/crawl/params-preview', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const parsed = await parseBody(
    c,
    z.object({
      url: z.string().url(),
      prompt: z.string().min(1).max(10000),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const preview = await deriveCrawlParamsFromPrompt(
    parsed.data.url,
    parsed.data.prompt,
    engineEnv(c.env),
  );
  return c.json({
    success: true as const,
    data: preview,
    ...preview,
  });
});

// Active / ongoing crawls enumeration (registered before /crawl/:id so "active"/"ongoing" are not captured as :id)
const activeCrawlsHandler = async (c: Context<{ Bindings: Env; Variables: Vars }>) => {
  const denied = gate(c);
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

  return c.json({
    success: true as const,
    crawls,
  });
};

route.get('/crawl/active', activeCrawlsHandler);
route.get('/crawl/ongoing', activeCrawlsHandler);

route.get('/crawl/:id', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;

  const runner = getCrawlRunner(c.env, id);

  // Hibernatable WebSocket Watcher support for official Firecrawl `client.watcher(jobId)` / `crawlUrlAndWatch`
  if (c.req.header('upgrade')?.toLowerCase() === 'websocket' || c.req.query('watch') === 'true') {
    return runner.watchSocket(c.req.raw);
  }

  const skip = Math.max(0, Number(c.req.query('skip') ?? 0) || 0);
  const s = (await runner.status(skip, 10)) as CrawlStatusResult | null;
  if (!s) return fail(c, 404, 'Crawl job not found.');
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
    ...(s.warning ? { warning: s.warning } : {}),
    next: s.nextOffset != null ? `${origin(c)}/v2/crawl/${id}?skip=${s.nextOffset}` : null,
    data: s.data,
  });
});

route.delete('/crawl/:id', async (c) => {
  const denied = gate(c);
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

route.get('/crawl/:id/errors', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;

  const runner = getCrawlRunner(c.env, id);
  const errs = await runner.getErrors();
  if (!errs) return fail(c, 404, 'Crawl job not found.');
  return c.json(errs);
});

export default route;
