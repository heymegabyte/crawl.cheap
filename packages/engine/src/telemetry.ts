/**
 * Thin crawl.cheap compatibility surface over the canonical theme.tools telemetry package.
 * Server delivery, redaction, trace context, provider builders, and fail-open behavior live upstream.
 */
export * from '@theme.tools/telemetry/builders';
export { THEME_TOOLS_CATALOG_MANIFEST } from './catalog-manifest';

import {
  LANGFUSE_MANDATORY_TIMEOUT_MS,
  SevenSystemTelemetryRouter as CanonicalTelemetryRouter,
  resolveCorrelationContext as resolveCanonicalCorrelationContext,
  scrubTelemetryText as scrubCanonicalTelemetryText,
} from '@theme.tools/telemetry/builders';

/** Compatibility overload retained while callers migrate to the canonical Headers-based API. */
export function resolveCorrelationContext(input?: string | Headers | null) {
  const resolved = resolveCanonicalCorrelationContext(
    typeof input === 'string' ? new Headers({ traceparent: input }) : (input ?? new Headers()),
  );
  return { ...resolved, parentSpanId: typeof input === 'string' ? input.split('-')[2] : undefined };
}

/** Adds crawl.cheap's legacy provider-key redaction to the canonical scrubber. */
export function scrubTelemetryText(input: string): string {
  return scrubCanonicalTelemetryText(input).replace(
    /\bfc-[A-Za-z0-9_-]{12,}\b/g,
    '[REDACTED_API_KEY]',
  );
}

/** Public-response compatibility only; dispatch remains canonical. */
export class SevenSystemTelemetryRouter extends CanonicalTelemetryRouter {
  public override getReadinessSummary() {
    return {
      ...super.getReadinessSummary(),
      langfuseMandatoryTimeoutMs: LANGFUSE_MANDATORY_TIMEOUT_MS,
    };
  }
  public override async dispatchUnifiedEvent(
    input: Parameters<CanonicalTelemetryRouter['dispatchUnifiedEvent']>[0],
  ) {
    const report = await super.dispatchUnifiedEvent({
      ...input,
      consent: input.consent ?? { analytics: true, marketing: true, errorReporting: true },
    });
    if (report.sinks.gtm.status !== 'skipped-missing-credentials') return report;
    return {
      ...report,
      sinks: {
        ...report.sinks,
        gtm: { sink: 'gtm' as const, status: 'queued-datalayer' as const, sinkDisabledSafe: true },
      },
    };
  }
}

/** @deprecated Langfuse v2 ingestion is retained only for compatibility reporting. */
export const LANGFUSE_V2_INGESTION_PATH = '/api/public/ingestion';
