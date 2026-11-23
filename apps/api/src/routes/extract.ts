import { Hono } from 'hono';
import type { Context } from 'hono';
import { ExtractRequestSchema } from '@crawlcheap/contracts';
import type { Env } from '../env';
import type { ExtractStatusResult } from '../extract-do';
import { fail, parseBody, assertUuidOrFail } from '../lib/respond';
import { requireAuth, type Vars } from '../lib/auth';
import { allowDemo } from '../lib/ratelimit';
import { getExtractRunner } from '../lib/local-jobs';

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

route.post('/extract', async (c) => {
  const denied = gate(c);
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
  const denied = gate(c);
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

export default route;
