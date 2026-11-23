/**
 * @crawlcheap/engine — the Cloudflare-native web-data engine. Cheapest-adequate-tier
 * execution planner over a free static-HTTP path (SSRF-guarded fetch → readability
 * extraction → HTML→Markdown) with escalation to the Browser Rendering tier.
 */
export { scrape, synthesizeDeterministicJson, type ScrapeResult } from './scrape';
export {
  mapSite,
  mapSiteWithMeta,
  assertSupportedSite,
  UnsupportedSiteError,
  type MapSiteResult,
} from './map';
export {
  cloudflareCrawlAvailable,
  buildCloudflareCrawlPayload,
  startCloudflareCrawl,
  getCloudflareCrawlStatus,
  normalizeCloudflareCrawlResult,
  cancelCloudflareCrawl,
  deriveCrawlParamsFromPrompt,
  type CloudflareCrawlRecord,
  type CloudflareCrawlStatusPayload,
  type CloudflareCrawlNormalizedStatus,
  type CloudflareCrawlRequestPayload,
  type CrawlParamsPreviewResult,
} from './cf-crawl';
export { planScrape, formatTypes, type ScrapePlan, type Tier } from './planner';
export { discoverSitemapUrls } from './sitemap';
export { fetchRobots, isAllowed } from './robots';
export {
  safeFetch,
  tryFetchText,
  DEFAULT_USER_AGENT,
  type FetchResult,
  type FetchOptions,
} from './fetcher';
export {
  assertSafeUrl,
  resolveAndAssertSafe,
  SsrfError,
  isPrivateIpv4,
  isPrivateIpv6,
  parseIpv4,
} from './ssrf';
export { htmlToMarkdown, stripBase64Images, type MarkdownContext } from './html-to-markdown';
export {
  parseHtml,
  selectContent,
  extractLinks,
  extractImages,
  extractAttributes,
  extractBranding,
} from './extract-content';
export { extractMetadata } from './metadata';
export { browserAvailable, browserQuickAction } from './browser';
export {
  scrapeWithActions,
  applyActions,
  captureDocument,
  puppeteerAvailable,
  ActionError,
  type ActionsOutput,
  type CaptureOptions,
} from './interact';
export { extractWithAI, extractAvailable, type ExtractOptions } from './extract-ai';
export {
  webSearch,
  searchAvailable,
  searchProviderName,
  type NormalizedResult,
  type ImageResult,
  type SearchSources,
} from './search';
export { parseDocument, looksLikePdf, type ParseResult } from './parse';
export type { EngineEnv, BrowserQuickAction, WorkersAiBinding } from './types';
export {
  LANGFUSE_MANDATORY_TIMEOUT_MS,
  LANGFUSE_STRIKE_THRESHOLD,
  LANGFUSE_COOLDOWN_MS,
  LANGFUSE_V4_OTLP_TRACES_PATH,
  LANGFUSE_V2_INGESTION_PATH,
  LANGFUSE_LEGACY_INGESTION_SUNSET_ISO,
  newTraceId,
  newSpanId,
  formatTraceparent,
  parseW3cTraceparentHeader,
  resolveCorrelationContext,
  scrubTelemetryText,
  scrubTelemetryPayload,
  formatFailOpenJsonlSpoolEntry,
  appendTelemetrySpoolEntry,
  getTelemetrySpoolEntries,
  clearTelemetrySpool,
  LangfuseSafeClient,
  getLangfuseSafeClient,
  parseSentryDsn,
  buildSentryEnvelopeV7,
  buildPostHogBatchPayload,
  Ga4PageviewDeduplicator,
  buildGa4MeasurementProtocolPayload,
  buildGtmConsentModeV2State,
  buildGtmDataLayerEvent,
  auditLangfuseCompatibilityMatrix,
  runPromptfooSyntheticEvalSuite,
  SevenSystemTelemetryRouter,
  THEME_TOOLS_CATALOG_MANIFEST,
  type W3cTraceparent,
  type TelemetrySpoolEntry,
  type LangfuseTraceEvent,
  type LangfuseSafeConfig,
  type LangfuseBreakerStatus,
  type ParsedSentryDsn,
  type SentryEnvelopeBuildInput,
  type SentryEnvelopeV7Artifact,
  type PostHogBatchEventInput,
  type TelemetryConsentPreferences,
  type GtmConsentModeV2State,
  type LangfuseCompatibilityMatrixReport,
  type PromptfooSyntheticSuiteReport,
  type TelemetrySinkDispatchOutcome,
  type SevenSystemRouterConfig,
  type UnifiedTelemetryEventInput,
  type UnifiedTelemetryDispatchReport,
} from './telemetry';
