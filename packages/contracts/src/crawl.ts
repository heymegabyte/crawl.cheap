import { z } from 'zod';
import { DocumentSchema } from './common';
import { ScrapeOptionsSchema } from './scrape';
import { WebhookConfigSchema } from './webhook';

export const MAX_PATH_PATTERNS = 1000;
export const MAX_PATH_PATTERN_LENGTH = 2000;
export const MAX_TOTAL_PATH_PATTERNS = 1000;
export const MAX_TOTAL_PATH_PATTERN_CHARS = 100_000;

export const PathPatternsSchema = z
  .string()
  .max(
    MAX_PATH_PATTERN_LENGTH,
    `Each includePaths/excludePaths pattern must be at most ${MAX_PATH_PATTERN_LENGTH} characters.`,
  )
  .array()
  .max(
    MAX_PATH_PATTERNS,
    `includePaths and excludePaths each accept at most ${MAX_PATH_PATTERNS} patterns.`,
  );

function validateCrawlPatternSyntax(
  pattern: string,
  field: 'includePaths' | 'excludePaths',
): string | null {
  // Detect stacked/large counted repetitions that cause NFA state explosion (e.g. a{5}{5}{5} or a{10000})
  if (/\{\d+\}\s*\{\d+\}/.test(pattern)) {
    return `Invalid ${field} pattern ${JSON.stringify(pattern)}: compiled regex exceeds size limit. ${field} patterns use Rust regex (RE2-style) syntax.`;
  }
  const bigQuant = pattern.match(/\{(\d+)(?:,(\d*))?\}/);
  if (bigQuant && (Number(bigQuant[1]) > 1000 || (bigQuant[2] && Number(bigQuant[2]) > 1000))) {
    return `Invalid ${field} pattern ${JSON.stringify(pattern)}: compiled regex exceeds size limit. ${field} patterns use Rust regex (RE2-style) syntax.`;
  }
  try {
    new RegExp(pattern);
    return null;
  } catch (e) {
    return `Invalid ${field} pattern ${JSON.stringify(pattern)}: ${e instanceof Error ? e.message : 'syntax error'}.`;
  }
}

export const CrawlRequestSchema = z
  .object({
    url: z.string().url(),
    /** Natural-language crawl intent; the planner derives include/exclude paths. */
    prompt: z.string().max(10000).optional(),
    limit: z.number().int().positive().default(10000),
    maxDiscoveryDepth: z.number().int().nonnegative().optional(),
    /** Legacy v1 alias for maxDiscoveryDepth. */
    maxDepth: z.number().int().nonnegative().optional(),
    sitemap: z.enum(['include', 'only', 'skip']).default('include'),
    /** Legacy v1 alias for sitemap: 'skip'. */
    ignoreSitemap: z.boolean().optional(),
    includePaths: PathPatternsSchema.optional(),
    excludePaths: PathPatternsSchema.optional(),
    allowExternalLinks: z.boolean().default(false),
    allowSubdomains: z.boolean().default(false),
    crawlEntireDomain: z.boolean().optional(),
    /** Legacy v1 alias for crawlEntireDomain. */
    allowBackwardLinks: z.boolean().optional(),
    ignoreQueryParameters: z.boolean().default(false),
    regexOnFullURL: z.boolean().default(false),
    ignoreRobotsTxt: z.boolean().optional(),
    robotsUserAgent: z.string().optional(),
    delay: z.number().nonnegative().max(60).optional(),
    maxConcurrency: z.number().int().positive().optional(),
    webhook: WebhookConfigSchema.optional(),
    scrapeOptions: ScrapeOptionsSchema.optional(),
    zeroDataRetention: z.boolean().optional(),
    origin: z.string().optional(),
    integration: z.string().optional(),
    /** Cloudflare Browser Rendering /crawl native options: */
    /** Incremental crawl: Unix timestamp (seconds or ms) to skip pages unmodified since this time. */
    modifiedSince: z.number().int().nonnegative().optional(),
    /** Cloudflare R2 crawl cache maxAge in seconds (default 86400, max 604800). */
    maxAge: z.number().int().nonnegative().optional(),
    /** Cloudflare /crawl render mode: true = headless Chromium JS execution, false = fast static Workers fetch. */
    render: z.boolean().optional(),
    /** Cloudflare /crawl URL discovery source ('all' | 'sitemaps' | 'links'). */
    source: z.enum(['all', 'sitemaps', 'links']).optional(),
  })
  .superRefine((val, ctx) => {
    const inc = val.includePaths ?? [];
    const exc = val.excludePaths ?? [];
    if (
      inc.length <= MAX_PATH_PATTERNS &&
      exc.length <= MAX_PATH_PATTERNS &&
      inc.every((p) => p.length <= MAX_PATH_PATTERN_LENGTH) &&
      exc.every((p) => p.length <= MAX_PATH_PATTERN_LENGTH)
    ) {
      const total = inc.length + exc.length;
      if (total > MAX_TOTAL_PATH_PATTERNS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [],
          message: `includePaths and excludePaths together accept at most ${MAX_TOTAL_PATH_PATTERNS} patterns (got ${total}).`,
        });
        return;
      }
      const totalChars = [...inc, ...exc].reduce((s, p) => s + p.length, 0);
      if (totalChars > MAX_TOTAL_PATH_PATTERN_CHARS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [],
          message: `includePaths and excludePaths together accept at most ${MAX_TOTAL_PATH_PATTERN_CHARS} characters of patterns (got ${totalChars}).`,
        });
        return;
      }
      for (const p of inc) {
        const err = validateCrawlPatternSyntax(p, 'includePaths');
        if (err)
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['includePaths'], message: err });
      }
      for (const p of exc) {
        const err = validateCrawlPatternSyntax(p, 'excludePaths');
        if (err)
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['excludePaths'], message: err });
      }
    }
  });
export type CrawlRequest = z.input<typeof CrawlRequestSchema>;

export const CrawlStatusSchema = z.enum(['scraping', 'completed', 'failed', 'cancelled']);
export type CrawlStatus = z.infer<typeof CrawlStatusSchema>;

/** Response to POST /v2/crawl — the async job handle. */
export const CrawlJobResponseSchema = z.object({
  success: z.literal(true),
  id: z.string(),
  url: z.string(),
});
export type CrawlJobResponse = z.infer<typeof CrawlJobResponseSchema>;

/** Response to GET /v2/crawl/:id — status + a page of results. */
export const CrawlStatusResponseSchema = z.object({
  success: z.boolean().optional(),
  id: z.string().optional(),
  status: CrawlStatusSchema,
  total: z.number().int(),
  completed: z.number().int(),
  creditsUsed: z.number().optional(),
  expiresAt: z.string().optional(),
  createdAt: z.string().optional(),
  completedAt: z.string().optional(),
  duration: z.number().optional(),
  next: z.string().nullable().optional(),
  warning: z.string().optional(),
  data: z.array(DocumentSchema),
});
export type CrawlStatusResponse = z.infer<typeof CrawlStatusResponseSchema>;

/** Response to GET /v2/crawl/:id/errors. */
export const CrawlErrorsResponseSchema = z.object({
  errors: z.array(
    z.object({
      id: z.string(),
      timestamp: z.string().nullable().optional(),
      url: z.string(),
      error: z.string(),
    }),
  ),
  robotsBlocked: z.array(z.string()),
});
export type CrawlErrorsResponse = z.infer<typeof CrawlErrorsResponseSchema>;
