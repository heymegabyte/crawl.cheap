import { Hono } from 'hono';
import type { Context } from 'hono';
import { BatchScrapeRequestSchema } from '@crawlcheap/contracts';
import type { Env } from '../env';
import { markActiveCrawlFinished, registerActiveCrawl, type CrawlStatusResult } from '../crawl-do';
import { fail, parseBody, assertUuidOrFail } from '../lib/respond';
import { requireAuth, type Vars } from '../lib/auth';
import { allowDemo } from '../lib/ratelimit';
import { getCrawlRunner } from '../lib/local-jobs';
import { assertThreatPolicyAllowed, ThreatBlockedError } from '../lib/durable-state';

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

route.post('/batch/scrape', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const parsed = await parseBody(c, BatchScrapeRequestSchema);
  if (!parsed.ok) return parsed.response;

  const malformed = parsed.data.urls.filter((u) => {
    try {
      const x = new URL(u);
      return x.protocol !== 'http:' && x.protocol !== 'https:';
    } catch {
      return true;
    }
  });
  if (parsed.data.ignoreInvalidURLs === false && malformed.length > 0) {
    return fail(c, 400, `Invalid URLs: ${malformed.join(', ')}`, 'BAD_REQUEST');
  }

  const p = c.get('principal');
  const teamId = p.teamId ?? p.keyId ?? 'demo-team';
  try {
    for (const u of parsed.data.urls) {
      await assertThreatPolicyAllowed(c.env.DB, teamId, u);
    }
  } catch (err) {
    if (err instanceof ThreatBlockedError) return fail(c, 403, err.message, 'UNSUPPORTED_SITE');
    throw err;
  }

  const id = crypto.randomUUID();
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
    url: `${origin(c)}/v2/batch/scrape/${id}`,
    ...(invalidURLs.length > 0 ? { invalidURLs } : {}),
  });
});

route.get('/batch/scrape/:id', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;

  const runner = getCrawlRunner(c.env, id);

  if (c.req.header('upgrade')?.toLowerCase() === 'websocket' || c.req.query('watch') === 'true') {
    return runner.watchSocket(c.req.raw);
  }

  const skip = Math.max(0, Number(c.req.query('skip') ?? 0) || 0);
  const s = (await runner.status(skip, 10)) as CrawlStatusResult | null;
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
    next: s.nextOffset != null ? `${origin(c)}/v2/batch/scrape/${id}?skip=${s.nextOffset}` : null,
    data: s.data,
  });
});

route.delete('/batch/scrape/:id', async (c) => {
  const denied = gate(c);
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
  const denied = gate(c);
  if (denied) return denied;
  const id = c.req.param('id');
  const invalid = assertUuidOrFail(c, id);
  if (invalid) return invalid;

  const runner = getCrawlRunner(c.env, id);
  const errs = await runner.getErrors();
  if (!errs) return fail(c, 404, 'Batch scrape job not found.');
  return c.json(errs);
});

export default route;
