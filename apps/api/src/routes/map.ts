import { Hono } from 'hono';
import { MapRequestSchema } from '@crawlcheap/contracts';
import { mapSiteWithMeta, SsrfError, UnsupportedSiteError } from '@crawlcheap/engine';
import { engineEnv, type Env } from '../env';
import { fail, parseBody } from '../lib/respond';
import { requireAuth, type Vars } from '../lib/auth';
import { allowDemo } from '../lib/ratelimit';
import { assertThreatPolicyAllowed, ThreatBlockedError } from '../lib/durable-state';

const route = new Hono<{ Bindings: Env; Variables: Vars }>();

route.post('/map', async (c) => {
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

  const parsed = await parseBody(c, MapRequestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    await assertThreatPolicyAllowed(c.env.DB, p.teamId ?? p.keyId ?? 'default', parsed.data.url);
    const { links, warning } = await mapSiteWithMeta(parsed.data, engineEnv(c.env));
    return c.json({
      success: true as const,
      links,
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    if (err instanceof ThreatBlockedError) return fail(c, 403, err.message, 'UNSUPPORTED_SITE');
    if (err instanceof UnsupportedSiteError) return fail(c, 403, err.message, 'UNSUPPORTED_SITE');
    if (err instanceof SsrfError) return fail(c, 400, err.message, 'unsafe_domain_blocked');
    const msg = err instanceof Error ? err.message : 'Unknown map error';
    if (/timeout|timed out|aborted|signal/i.test(msg))
      return fail(c, 408, 'The map operation timed out', 'MAP_TIMEOUT');
    return fail(c, 500, msg, 'MAP_FAILED');
  }
});

export default route;
