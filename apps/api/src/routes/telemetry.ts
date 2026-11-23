import { Hono } from 'hono';
import { z } from 'zod';
import {
  getLangfuseSafeClient,
  getTelemetrySpoolEntries,
  resolveCorrelationContext,
  SevenSystemTelemetryRouter,
  THEME_TOOLS_CATALOG_MANIFEST,
} from '@crawlcheap/engine';
import type { Env } from '../env';
import type { Vars } from '../lib/auth';
import { parseBody } from '../lib/respond';

const route = new Hono<{ Bindings: Env; Variables: Vars }>();

export function createTelemetryRouter(env: Env): SevenSystemTelemetryRouter {
  return new SevenSystemTelemetryRouter({
    serviceName: 'crawl-cheap-api',
    environment: env.SENTRY_ENVIRONMENT ?? 'production',
    posthogHost: env.POSTHOG_HOST,
    posthogApiKey: env.POSTHOG_API_KEY,
    sentryDsn: env.SENTRY_DSN,
    ga4MeasurementId: env.GA_MEASUREMENT_ID,
    ga4ApiSecret: env.GA_API_SECRET,
    gtmContainerId: env.GTM_CONTAINER_ID,
    langfuseBaseUrl: env.LANGFUSE_HOST ?? env.LANGFUSE_BASEURL,
    langfusePublicKey: env.LANGFUSE_PUBLIC_KEY,
    langfuseSecretKey: env.LANGFUSE_SECRET_KEY,
  });
}

// GET /v2/telemetry/status — 7-Rail Observability & Langfuse Safe (2500ms) Status
route.get('/telemetry/status', async (c) => {
  const router = createTelemetryRouter(c.env);
  const readiness = router.getReadinessSummary();
  const lf = getLangfuseSafeClient({
    publicKey: c.env.LANGFUSE_PUBLIC_KEY,
    secretKey: c.env.LANGFUSE_SECRET_KEY,
    baseUrl: c.env.LANGFUSE_HOST ?? c.env.LANGFUSE_BASEURL,
    serviceName: 'crawl-cheap-api',
    environment: c.env.SENTRY_ENVIRONMENT ?? 'production',
  });
  const spool = getTelemetrySpoolEntries();

  return c.json({
    success: true as const,
    service: 'crawl-cheap-api',
    readiness,
    langfuseBreaker: lf.getStatus(),
    spool: {
      count: spool.length,
      recent: spool.slice(-10),
    },
    catalog: {
      siteId: THEME_TOOLS_CATALOG_MANIFEST.siteId,
      themeId: THEME_TOOLS_CATALOG_MANIFEST.theme.id,
      boundPackagesCount: THEME_TOOLS_CATALOG_MANIFEST.boundPackages.length,
      blogComponentTypesCount: THEME_TOOLS_CATALOG_MANIFEST.blogComponentTypes.length,
      observabilityRails: THEME_TOOLS_CATALOG_MANIFEST.observabilityRails,
    },
  });
});

const TelemetryEventSchema = z.object({
  eventName: z.string().min(1).max(120),
  sessionId: z.string().min(1).max(128).default('anon_session'),
  distinctId: z.string().min(1).max(128).default('anon_user'),
  canonicalPath: z.string().max(1024).optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  consent: z
    .object({
      analytics: z.boolean().default(true),
      marketing: z.boolean().default(false),
      errorReporting: z.boolean().default(true),
    })
    .optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  error: z.unknown().optional(),
  genAiSpan: z
    .object({
      name: z.string().min(1),
      model: z.string().optional(),
      input: z.unknown().optional(),
      output: z.unknown().optional(),
      durationMs: z.number().optional(),
      promptTokens: z.number().optional(),
      completionTokens: z.number().optional(),
      totalTokens: z.number().optional(),
    })
    .optional(),
});

// POST /v2/telemetry/events — Unified 7-Rail Telemetry Ingestion (Cloudflare, PostHog, Sentry, GA4, GTM, Langfuse, Promptfoo)
route.post('/telemetry/events', async (c) => {
  const parsed = await parseBody(c, TelemetryEventSchema);
  if (!parsed.ok) return parsed.response;

  const corr = resolveCorrelationContext(c.req.header('traceparent'));
  const router = createTelemetryRouter(c.env);
  const report = await router.dispatchUnifiedEvent({
    eventName: parsed.data.eventName,
    sessionId: parsed.data.sessionId,
    distinctId: parsed.data.distinctId,
    canonicalPath: parsed.data.canonicalPath,
    traceId: parsed.data.traceId ?? corr.traceId,
    spanId: parsed.data.spanId ?? corr.spanId,
    consent: parsed.data.consent ?? { analytics: true, marketing: false, errorReporting: true },
    properties: parsed.data.properties,
    error: parsed.data.error,
    genAiSpan: parsed.data.genAiSpan,
  });

  c.header('traceparent', report.correlation.traceparent);
  c.header('x-trace-id', report.correlation.traceId);
  return c.json({
    success: true as const,
    report,
  });
});

// GET /v2/catalog — Canonical @theme.tools/catalog Manifest & Bound Libraries
route.get('/catalog', (c) => {
  return c.json({
    success: true as const,
    catalog: THEME_TOOLS_CATALOG_MANIFEST,
  });
});

export default route;
