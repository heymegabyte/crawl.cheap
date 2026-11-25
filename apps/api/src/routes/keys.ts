import { Hono } from 'hono';
import { z } from 'zod';
import { type Env } from '../env';
import { createKey, rotateKeyById } from '../lib/keys';
import { fail, parseBody } from '../lib/respond';
import { requireAuth, type Vars } from '../lib/auth';
import { allowDemo } from '../lib/ratelimit';

const route = new Hono<{ Bindings: Env; Variables: Vars }>();

/**
 * Self-serve API-key issuance (free tier). Supports both native `cc_live_` keys
 * and Firecrawl-compatible `fc-` prefix keys when `prefix: "fc-"` is requested.
 */
route.post('/keys', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  if (!p.authed) {
    if (c.env.DEMO_MODE !== 'true') {
      const denied = requireAuth(c);
      if (denied) return denied;
    } else if (!allowDemo(c.req.header('cf-connecting-ip') ?? 'unknown', Date.now())) {
      return fail(c, 429, 'Demo rate limit reached (≈20 requests/min).', 'BAD_REQUEST');
    }
  }
  const parsed = await parseBody(
    c,
    z.object({
      name: z.string().max(100).optional(),
      plan: z.enum(['free']).default('free'),
      prefix: z.enum(['cc_live_', 'fc-']).default('cc_live_'),
    }),
  );
  if (!parsed.ok) return parsed.response;

  const created = await createKey(c.env.DB, {
    name: parsed.data.name,
    plan: parsed.data.plan,
    prefix: parsed.data.prefix,
  });
  return c.json({
    success: true as const,
    apiKey: created.key,
    keyId: created.id,
    teamId: created.teamId,
    plan: created.plan,
    monthlyCredits: created.monthlyCredits,
    note: 'Store this key now — it is shown only once. Send it as: Authorization: Bearer <key>',
  });
});

// POST /v2/keys/:id/rotate — Zero-downtime atomic API key rotation
route.post('/keys/:id/rotate', async (c) => {
  const keyId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { prefix?: 'cc_live_' | 'fc-' };
  const result = await rotateKeyById(
    c.env.DB,
    keyId,
    body.prefix === 'fc-' ? 'fc-' : body.prefix === 'cc_live_' ? 'cc_live_' : undefined,
  );
  return c.json({
    success: true as const,
    ...result,
  });
});

export default route;
