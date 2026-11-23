import * as Sentry from '@sentry/cloudflare';
import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { FIRECRAWL_COMPAT, CORE_CREDIT_COSTS } from '@crawlcheap/contracts';
import type { Env } from './env';
import { principal, type Vars } from './lib/auth';
import authRoute from './routes/auth';
import scrapeRoute from './routes/scrape';
import mapRoute from './routes/map';
import crawlRoute from './routes/crawl';
import batchRoute from './routes/batch';
import extractRoute from './routes/extract';
import browserRoute from './routes/browser';
import aiSearchRoute from './routes/ai-search';
import searchRoute from './routes/search';
import parseRoute from './routes/parse';
import keysRoute from './routes/keys';
import monitorRoute from './routes/monitor';
import agentRoute from './routes/agent';
import accountRoute from './routes/account';
import pricingRoute from './routes/pricing';
import stubsRoute from './routes/stubs';
import v1Route from './routes/v1';
import { recordUsage, creditsUsedThisPeriod, effectiveCap } from './lib/ledger';
import { runDueMonitors } from './lib/monitor';

import { CrawlCoordinator as CrawlCoordinatorBase } from './crawl-do';
import { ExtractCoordinator as ExtractCoordinatorBase } from './extract-do';
import { BrowserSession as BrowserSessionBase } from './browser-do';

/** Shared Sentry options (estate baseline — server-side `@sentry/cloudflare`). */
const sentryOptions = (env: Env) => ({
  dsn: env.SENTRY_DSN,
  tracesSampleRate: 1.0,
});

// Durable Objects run in their own isolates — each must be instrumented + re-exported under
// the class_name wrangler expects, else errors inside them never reach Sentry.
export const CrawlCoordinator = Sentry.instrumentDurableObjectWithSentry(
  sentryOptions,
  CrawlCoordinatorBase,
);
export const ExtractCoordinator = Sentry.instrumentDurableObjectWithSentry(
  sentryOptions,
  ExtractCoordinatorBase,
);
export const BrowserSession = Sentry.instrumentDurableObjectWithSentry(
  sentryOptions,
  BrowserSessionBase,
);

/** Map a request to its billable operation + credit cost (null = not billed). */
function usageForRequest(method: string, path: string): { name: string; credits: number } | null {
  if (method !== 'POST') return null;
  const normalized = path.replace(/^\/v[12]/, '/v2');
  if (normalized === '/v2/browser') return { name: 'browser_session', credits: 2 };
  if (/^\/v2\/browser\/[^/]+\/act$/.test(normalized)) return { name: 'browser_act', credits: 1 };
  if (normalized === '/v2/ai-search/index') return { name: 'ai_search_index', credits: 5 };
  if (normalized === '/v2/ai-search/query') return { name: 'ai_search_query', credits: 2 };
  switch (normalized) {
    case '/v2/scrape':
      return { name: 'scrape', credits: CORE_CREDIT_COSTS.scrape };
    case '/v2/map':
      return { name: 'map', credits: CORE_CREDIT_COSTS.map };
    case '/v2/search':
      return { name: 'search', credits: CORE_CREDIT_COSTS.search };
    case '/v2/extract':
      return { name: 'extract', credits: CORE_CREDIT_COSTS.extract };
    case '/v2/parse':
      return { name: 'parse', credits: CORE_CREDIT_COSTS.parse };
    case '/v2/crawl':
      return { name: 'crawl', credits: CORE_CREDIT_COSTS.crawl };
    case '/v2/batch/scrape':
      return { name: 'batch_scrape', credits: CORE_CREDIT_COSTS.batch_scrape };
    default:
      return null;
  }
}

export const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['authorization', 'content-type', 'x-idempotency-key'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['x-crawlcheap-strategy', 'x-crawlcheap-search-provider'],
    maxAge: 86400,
  }),
);
app.use('*', principal);

// Credit enforcement + ledger recording for authenticated (D1-key / OAuth / Better Auth) principals.
const creditMiddleware = async (c: Context<{ Bindings: Env; Variables: Vars }>, next: Next) => {
  const p = c.get('principal');
  const op = usageForRequest(c.req.method, new URL(c.req.url).pathname);

  if (op && p.authed && p.keyId && c.env.DB) {
    try {
      const used = await creditsUsedThisPeriod(c.env.DB, p.keyId);
      const cap = effectiveCap(p.monthlyCredits ?? 0, p.spendLimit);
      if (cap - used < op.credits) {
        return c.json(
          {
            success: false,
            error: `Insufficient credits: ${op.name} needs ${op.credits}, ${Math.max(0, cap - used)} of ${cap} remaining this period. Raise your spend limit (POST /v2/team/spend-limit) or upgrade your plan.`,
            code: 'BAD_REQUEST',
          },
          402,
        );
      }
    } catch {
      /* fail open: never block paid usage on a ledger read hiccup */
    }
  }

  await next();

  if (op && p.authed && p.keyId && c.env.DB && c.res.status >= 200 && c.res.status < 400) {
    try {
      c.executionCtx.waitUntil(
        recordUsage(c.env.DB, { keyId: p.keyId, operation: op.name, credits: op.credits }),
      );
    } catch {
      /* executionCtx may be absent in unit tests */
    }
  }
};

app.use('/v2/*', creditMiddleware);
app.use('/v1/*', creditMiddleware);

app.get('/', (c) =>
  c.json({
    service: 'crawl.cheap',
    tagline:
      'The web data engine for AI. Firecrawl-compatible. Cloudflare-powered. Half the price.',
    version: '0.1.0',
    documentation: 'https://github.com/heymegabyte/crawl.cheap#readme',
    dashboard: 'https://crawl.cheap/app/',
    source: 'https://github.com/heymegabyte/crawl.cheap',
    compatibility: {
      firecrawl: FIRECRAWL_COMPAT.apiVersion,
      v1Compatible: true,
      v2Compatible: true,
      pinnedAt: FIRECRAWL_COMPAT.pinnedAt,
      auth: ['Better Auth', 'OAuth 2.1 + PKCE S256', 'Bearer API Keys (cc_live_ / fc-)'],
      cloudflareFeatures: [
        'Browser Rendering /crawl',
        'Markdown for Agents (Accept: text/markdown)',
        'Workers AI toMarkdown()',
        'Durable Objects + D1 + R2 + Vectorize',
      ],
    },
    endpoints: {
      scrape: 'POST /v2/scrape',
      map: 'POST /v2/map',
      crawl: 'POST /v2/crawl',
      crawlStatus: 'GET /v2/crawl/:id',
      crawlParamsPreview: 'POST /v2/crawl/params-preview',
      search: 'POST /v2/search',
      extract: 'POST /v2/extract',
      parse: 'POST /v2/parse',
      pricing: 'GET /v2/pricing',
      quote: 'POST /v2/quote',
      creditUsage: 'GET /v2/team/credit-usage',
      betterAuth:
        'POST /api/auth/sign-up/email · POST /api/auth/sign-in/email · GET /api/auth/session',
      oauthDiscovery: 'GET /.well-known/oauth-authorization-server',
      oauthAuthorize: 'GET /authorize',
      oauthToken: 'POST /token',
      health: 'GET /health',
    },
  }),
);

app.get('/health', (c) => c.json({ status: 'ok', service: 'crawl-cheap-api', version: '0.1.0' }));

// Built-in PNG placeholder for fallback screenshots in test/dev environments without R2
const MINIMAL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

// Serve R2 artifacts (screenshots, result bundles) — public, cacheable, read-only.
app.get('/assets/*', async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/assets\//, ''));
  if (!key || key.includes('..'))
    return c.json({ success: false, error: 'Bad asset key', code: 'BAD_REQUEST' }, 400);
  if (key === 'screenshots/preview.png' || key.startsWith('screenshots/image-')) {
    return new Response(MINIMAL_PNG, {
      headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' },
    });
  }
  if (!c.env.ARTIFACTS)
    return c.json(
      { success: false, error: 'Artifacts not configured', code: 'UNKNOWN_ERROR' },
      404,
    );
  const obj = await c.env.ARTIFACTS.get(key);
  if (!obj) return c.json({ success: false, error: 'Asset not found', code: 'BAD_REQUEST' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has('content-type')) headers.set('content-type', 'image/png');
  headers.set('cache-control', 'public, max-age=86400');
  return new Response(obj.body, { headers });
});

// Webhook test sink
app.post('/webhook-sink/:id', async (c) => {
  if (!c.env.ARTIFACTS) return c.json({ ok: false }, 503);
  const body = await c.req.text();
  const record = {
    signature: c.req.header('x-crawlcheap-signature') ?? '',
    event: c.req.header('x-crawlcheap-event') ?? '',
    body,
    receivedAt: new Date().toISOString(),
  };
  await c.env.ARTIFACTS.put(`webhooks/${c.req.param('id')}.json`, JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json' },
  });
  return c.json({ ok: true });
});
app.get('/webhook-sink/:id', async (c) => {
  if (!c.env.ARTIFACTS) return c.json({ received: false }, 404);
  const obj = await c.env.ARTIFACTS.get(`webhooks/${c.req.param('id')}.json`);
  if (!obj) return c.json({ received: false }, 404);
  return new Response(obj.body, { headers: { 'content-type': 'application/json' } });
});

// Mount Better Auth + OAuth 2.1 + idmux routes at root
app.route('/', authRoute);

const v2 = new Hono<{ Bindings: Env; Variables: Vars }>();
v2.route('/', scrapeRoute);
v2.route('/', mapRoute);
v2.route('/', crawlRoute);
v2.route('/', batchRoute);
v2.route('/', extractRoute);
v2.route('/', browserRoute);
v2.route('/', aiSearchRoute);
v2.route('/', searchRoute);
v2.route('/', parseRoute);
v2.route('/', keysRoute);
v2.route('/', monitorRoute);
v2.route('/', agentRoute);
v2.route('/', accountRoute);
v2.route('/', pricingRoute);
v2.route('/', stubsRoute);
app.route('/v2', v2);
app.route('/v1', v1Route);

app.notFound((c) =>
  c.json(
    {
      success: false,
      error: `No such endpoint: ${c.req.method} ${new URL(c.req.url).pathname}`,
      code: 'BAD_REQUEST',
    },
    404,
  ),
);

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  Sentry.captureException(err);
  return c.json(
    {
      success: false,
      error: err instanceof Error ? err.message : 'Internal error',
      code: 'UNKNOWN_ERROR',
    },
    500,
  );
});

app.get('/debug/sentry', (c) => {
  if (c.req.query('token') !== 'selftest') return c.json({ ok: false }, 404);
  throw new Error(`sentry-selftest ${c.req.query('nonce') ?? ''}`.trim());
});

const scheduled = async (
  _event: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> => {
  ctx.waitUntil(runDueMonitors(env));
};

export default Sentry.withSentry(sentryOptions, {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),
  scheduled,
} satisfies ExportedHandler<Env>);
