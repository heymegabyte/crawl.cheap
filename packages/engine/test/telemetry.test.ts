import { describe, expect, it, beforeEach } from 'vitest';
import {
  auditLangfuseCompatibilityMatrix,
  buildGa4MeasurementProtocolPayload,
  buildGtmConsentModeV2State,
  buildGtmDataLayerEvent,
  buildPostHogBatchPayload,
  buildSentryEnvelopeV7,
  clearTelemetrySpool,
  extractWithAI,
  formatFailOpenJsonlSpoolEntry,
  formatTraceparent,
  Ga4PageviewDeduplicator,
  getTelemetrySpoolEntries,
  LANGFUSE_MANDATORY_TIMEOUT_MS,
  LangfuseSafeClient,
  parseSentryDsn,
  parseW3cTraceparentHeader,
  resolveCorrelationContext,
  redactPiiText,
  runPromptfooSyntheticEvalSuite,
  scrubTelemetryPayload,
  scrubTelemetryText,
  SevenSystemTelemetryRouter,
  THEME_TOOLS_CATALOG_MANIFEST,
} from '../src/index';

describe('@theme.tools/telemetry 7-Rail Observability & Langfuse Safe (2500ms)', () => {
  beforeEach(() => {
    clearTelemetrySpool();
  });

  it('generates and parses W3C traceparent headers accurately', () => {
    const tp = formatTraceparent('4bf92f3577b34da6a3ce929d0e0e4736', '00f067aa0ba902b7', true);
    expect(tp).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
    const parsed = parseW3cTraceparentHeader(tp);
    expect(parsed).not.toBeNull();
    expect(parsed?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(parsed?.parentId).toBe('00f067aa0ba902b7');
    expect(parsed?.isSampled).toBe(true);

    const corr = resolveCorrelationContext(tp);
    expect(corr.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(corr.parentSpanId).toBe('00f067aa0ba902b7');
    expect(corr.spanId).toHaveLength(16);
  });

  it('recursively scrubs API keys, Bearer tokens, emails, and sensitive fields', () => {
    const raw = 'Auth: Bearer cc_live_1234567890abcdef and fc-abcdef1234567890 for dev@crawl.cheap';
    const scrubbed = scrubTelemetryText(raw);
    expect(scrubbed).not.toContain('cc_live_1234567890abcdef');
    expect(scrubbed).not.toContain('fc-abcdef1234567890');
    expect(scrubbed).not.toContain('dev@crawl.cheap');
    expect(scrubbed).toContain('[REDACTED');

    const obj = scrubTelemetryPayload({
      apiKey: 'cc_live_secret123456',
      nested: { authorization: 'Bearer secret_token_12345', safe: 'ok' },
    }) as Record<string, unknown>;
    expect(obj.apiKey).toBe('[REDACTED]');
    expect((obj.nested as Record<string, unknown>).authorization).toBe('[REDACTED]');
    expect((obj.nested as Record<string, unknown>).safe).toBe('ok');
  });

  it('enforces 2500ms timeout, 3-strike circuit breaker, and fail-open spool on LangfuseSafeClient', async () => {
    expect(LANGFUSE_MANDATORY_TIMEOUT_MS).toBe(2500);
    let callCount = 0;
    const failingFetch: typeof globalThis.fetch = async () => {
      callCount += 1;
      return new Response('Upstream error', { status: 503 });
    };

    const client = new LangfuseSafeClient({
      publicKey: 'pk-lf-test123456',
      secretKey: 'sk-lf-test123456',
      baseUrl: 'https://cloud.langfuse.com',
      fetchImpl: failingFetch,
    });

    // Strike 1
    const r1 = await client.traceSafe({ name: 'test.gen.1', model: 'llama-3.1' });
    expect(r1.delivered).toBe(false);
    expect(r1.spooled).toBe(true);
    expect(client.getStatus().circuitOpen).toBe(false);

    // Strike 2
    await client.traceSafe({ name: 'test.gen.2', model: 'llama-3.1' });
    expect(client.getStatus().circuitOpen).toBe(false);

    // Strike 3 -> Opens circuit breaker!
    await client.traceSafe({ name: 'test.gen.3', model: 'llama-3.1' });
    expect(client.getStatus().circuitOpen).toBe(true);
    expect(callCount).toBe(3);

    // Strike 4 -> Short-circuits immediately without calling fetch!
    const r4 = await client.traceSafe({ name: 'test.gen.4', model: 'llama-3.1' });
    expect(r4.status).toBe('spooled-circuit-open');
    expect(callCount).toBe(3);
    expect(getTelemetrySpoolEntries().length).toBe(4);
  });

  it('automatically traces extractWithAI calls to Langfuse fail-open spool', async () => {
    const res = await extractWithAI(
      '# Pricing\nPlan costs $9.50/month',
      { prompt: 'Extract plan price' },
      {
        AI: {
          run: async () => ({ response: '{"price": 9.5}' }),
        },
      },
    );
    expect(res).toEqual({ price: 9.5 });
    const spooled = getTelemetrySpoolEntries();
    expect(spooled.some((e) => e.name === 'workers_ai.extract')).toBe(true);
  });

  it('builds Sentry Envelope v7, PostHog batch, GA4 Measurement Protocol, and GTM Consent Mode v2', () => {
    const dsn = 'https://publickey123@o1.ingest.sentry.io/45678';
    const parsedDsn = parseSentryDsn(dsn);
    expect(parsedDsn?.projectId).toBe('45678');

    const env7 = buildSentryEnvelopeV7({
      dsn,
      error: new Error('Test edge failure with dev@crawl.cheap'),
    });
    expect(env7.contentType).toBe('application/x-sentry-envelope');
    expect(env7.serializedEnvelope).toContain('[REDACTED_EMAIL]');

    const ph = buildPostHogBatchPayload('phc_testkey', [
      {
        event: 'api_scrape',
        distinctId: 'user_1',
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        properties: { url: 'https://example.com' },
      },
    ]);
    expect(ph.endpointPath).toBe('/batch/');
    expect(ph.body.batch[0]?.properties).toMatchObject({
      $lib: '@theme.tools/telemetry',
      $trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
    });

    const dedupe = new Ga4PageviewDeduplicator();
    expect(dedupe.shouldEmitPageview('sess1', '/blog/')).toBe(true);
    expect(dedupe.shouldEmitPageview('sess1', '/blog')).toBe(false);

    const ga4 = buildGa4MeasurementProtocolPayload({
      clientId: 'cid_1',
      eventName: 'page_view',
      sessionId: 'sess1',
      canonicalPath: '/blog',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    });
    expect(ga4.events[0]?.name).toBe('page_view');

    const gtm = buildGtmDataLayerEvent({
      containerId: 'GTM-TEST123',
      eventName: 'page_view',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      consent: { analytics: true, marketing: false },
    });
    expect(gtm.event).toBe('tt_governed_navigation');
    expect(buildGtmConsentModeV2State({ analytics: true, marketing: false })).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      security_storage: 'granted',
    });

    const spoolLine = formatFailOpenJsonlSpoolEntry({
      tenantId: 'crawl.cheap',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      name: 'scrape',
      timestampMs: Date.now(),
      durationMs: 22,
      status: 'ok',
      attributes: { apiKey: 'secret', status: 200 },
    });
    expect(spoolLine).toContain('"[REDACTED]"');
  });

  it('dispatches unified events across all 7 rails and exposes @theme.tools/catalog manifest', async () => {
    const router = new SevenSystemTelemetryRouter({
      serviceName: 'crawl-cheap-test',
      environment: 'test',
    });
    const readiness = router.getReadinessSummary();
    expect(readiness.langfuseMandatoryTimeoutMs).toBe(2500);
    expect(readiness.sinks.cloudflare).toBe('configured');
    expect(readiness.sinks.promptfoo).toBe('ready-synthetic-local');
    expect(auditLangfuseCompatibilityMatrix().allConfiguredSupported).toBe(true);
    expect(runPromptfooSyntheticEvalSuite().passed).toBe(true);

    const report = await router.dispatchUnifiedEvent({
      eventName: 'ui_playground_run',
      sessionId: 'sess_123',
      distinctId: 'user_123',
      canonicalPath: '/app/',
      genAiSpan: {
        name: 'playground.scrape',
        model: '@cf/meta/llama-3.1-8b-instruct',
        durationMs: 42,
      },
    });
    expect(report.correlation.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(report.sinks.cloudflare.status).toBe('recorded-local');
    expect(report.sinks.gtm.status).toBe('queued-datalayer');
    expect(report.sinks.promptfoo.status).toBe('ready-synthetic-local');

    expect(THEME_TOOLS_CATALOG_MANIFEST.boundPackages).toContain('@theme.tools/telemetry');
    expect(THEME_TOOLS_CATALOG_MANIFEST.boundPackages).toContain('@theme.tools/blog');
    expect(THEME_TOOLS_CATALOG_MANIFEST.boundPackages).toContain('@theme.tools/ui');
    expect(THEME_TOOLS_CATALOG_MANIFEST.boundPackages).toContain('@theme.tools/catalog');
    expect(THEME_TOOLS_CATALOG_MANIFEST.boundPackages).toContain('@theme.tools/integrations');
    expect(THEME_TOOLS_CATALOG_MANIFEST.boundPackages).toHaveLength(28);
    expect(THEME_TOOLS_CATALOG_MANIFEST.observabilityRails).toHaveLength(7);

    const piiSample =
      'Contact alice@crawl.cheap or 415-555-0199 with key fc-1234567890abcdefghij at 192.168.1.42';
    expect(redactPiiText(piiSample, true)).toContain('[REDACTED_EMAIL]');
    expect(redactPiiText(piiSample, true)).toContain('[REDACTED_PHONE]');
    expect(redactPiiText(piiSample, true)).toContain('[REDACTED_SECRET]');
    expect(redactPiiText(piiSample, { replaceStyle: 'mask', entities: ['EMAIL'] })).toContain(
      '************',
    );
  });
});
