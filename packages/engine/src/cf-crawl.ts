import type { CrawlRequest, Document } from '@crawlcheap/contracts';
import { extractWithAI, extractAvailable } from './extract-ai';
import type { EngineEnv } from './types';

/**
 * Cloudflare Browser Rendering / Browser Run `/crawl` API integration.
 *
 * Leverages Cloudflare's native asynchronous `/accounts/{account_id}/browser-rendering/crawl`
 * engine (and binding when available), which supports:
 *   - `render: true` (headless Chromium JS execution) vs `render: false` (fast static Workers fetch)
 *   - `source: 'all' | 'sitemaps' | 'links'`
 *   - `formats: ['markdown', 'html', 'json']` + `jsonOptions` (powered by Workers AI)
 *   - `maxAge` (Cloudflare R2 cache reuse) & `modifiedSince` (incremental crawling)
 *   - `options: { includeSubdomains, includeExternalLinks, includePatterns, excludePatterns }`
 *   - Cursor-based pagination + per-URL record statuses (`queued`, `completed`, `disallowed`, `skipped`, `errored`, `cancelled`)
 */

export interface CloudflareCrawlRecord {
  url: string;
  status: 'queued' | 'running' | 'completed' | 'disallowed' | 'skipped' | 'errored' | 'cancelled';
  html?: string;
  markdown?: string;
  json?: unknown;
  metadata?: {
    title?: string;
    status?: number;
    url?: string;
    contentType?: string;
    [key: string]: unknown;
  };
  error?: string;
}

export interface CloudflareCrawlStatusPayload {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'errored' | 'cancelled';
  browserSecondsUsed?: number;
  total?: number;
  finished?: number;
  cursor?: string | null;
  records?: CloudflareCrawlRecord[];
}

export interface CloudflareCrawlNormalizedStatus {
  status: 'scraping' | 'completed' | 'failed' | 'cancelled';
  total: number;
  completed: number;
  cursor: string | null;
  documents: Document[];
  errors: Array<{ id: string; timestamp: string; url: string; error: string }>;
  robotsBlocked: string[];
  browserSecondsUsed: number;
}

export interface CloudflareCrawlRequestPayload {
  url: string;
  limit: number;
  maxDepth?: number;
  depth?: number;
  source: 'all' | 'sitemaps' | 'links';
  render: boolean;
  formats: Array<'markdown' | 'html' | 'json'>;
  jsonOptions?: {
    prompt?: string;
    response_format?: { type: 'json_schema'; json_schema: Record<string, unknown> };
  };
  maxAge?: number;
  modifiedSince?: number;
  options: {
    includeSubdomains: boolean;
    includeExternalLinks: boolean;
    includePatterns?: string[];
    excludePatterns?: string[];
  };
  extraHTTPHeaders?: Record<string, string>;
  userAgent?: string;
}

/** True when Cloudflare's Browser Rendering `/crawl` REST API or binding is available. */
export function cloudflareCrawlAvailable(env: EngineEnv): boolean {
  return Boolean(env.BROWSER?.crawl || (env.CF_ACCOUNT_ID && env.CF_BROWSER_TOKEN));
}

/**
 * Translate a Firecrawl-compatible CrawlRequest into Cloudflare's native `/browser-rendering/crawl`
 * payload, preserving all scope, discovery, rendering, incremental, and Workers-AI extraction options.
 */
export function buildCloudflareCrawlPayload(
  req: CrawlRequest,
  env: EngineEnv,
): CloudflareCrawlRequestPayload {
  const effectiveSitemap = req.ignoreSitemap ? 'skip' : (req.sitemap ?? 'include');
  const source: 'all' | 'sitemaps' | 'links' =
    req.source ??
    (effectiveSitemap === 'only' ? 'sitemaps' : effectiveSitemap === 'skip' ? 'links' : 'all');

  const so = req.scrapeOptions;
  const rawFormats = so?.formats ?? ['markdown'];
  const cfFormats = new Set<'markdown' | 'html' | 'json'>();
  let jsonPrompt: string | undefined;
  let jsonSchema: Record<string, unknown> | undefined;

  for (const f of rawFormats) {
    if (f === 'markdown' || f === 'summary' || f === 'links') cfFormats.add('markdown');
    else if (f === 'html' || f === 'rawHtml') cfFormats.add('html');
    else if (f === 'json' || f === 'extract') {
      cfFormats.add('json');
      jsonPrompt = so?.jsonOptions?.prompt ?? so?.extract?.prompt;
      jsonSchema = so?.jsonOptions?.schema ?? so?.extract?.schema;
    } else if (typeof f === 'object' && f !== null && 'type' in f) {
      if (f.type === 'json' || f.type === 'deterministicJson') {
        cfFormats.add('json');
        jsonPrompt = f.prompt;
        jsonSchema = f.schema;
      }
    }
  }
  if (cfFormats.size === 0) cfFormats.add('markdown');

  // Decide between Cloudflare's headless browser mode (`render: true`) and fast static Workers fetch (`render: false`).
  const needsJsRender =
    req.render !== undefined
      ? req.render
      : Boolean(
          (so?.waitFor ?? 0) > 0 ||
          (so?.actions && so.actions.length > 0) ||
          so?.mobile ||
          so?.proxy === 'stealth' ||
          so?.proxy === 'enhanced',
        );

  const depth = req.maxDiscoveryDepth ?? req.maxDepth;
  const maxAgeSec =
    req.maxAge !== undefined
      ? Math.min(Math.max(req.maxAge, 0), 604800)
      : so?.maxAge !== undefined
        ? Math.min(Math.max(Math.floor(so.maxAge / 1000), 0), 604800)
        : undefined;

  const modifiedSinceSec =
    req.modifiedSince !== undefined
      ? req.modifiedSince > 1e11
        ? Math.floor(req.modifiedSince / 1000)
        : req.modifiedSince
      : undefined;

  const payload: CloudflareCrawlRequestPayload = {
    url: req.url,
    limit: Math.min(Math.max(req.limit ?? 100, 1), 10000),
    ...(depth !== undefined ? { maxDepth: depth, depth } : {}),
    source,
    render: needsJsRender,
    formats: [...cfFormats],
    ...(cfFormats.has('json') && (jsonPrompt || jsonSchema)
      ? {
          jsonOptions: {
            ...(jsonPrompt ? { prompt: jsonPrompt } : {}),
            ...(jsonSchema
              ? { response_format: { type: 'json_schema', json_schema: jsonSchema } }
              : {}),
          },
        }
      : {}),
    ...(maxAgeSec !== undefined ? { maxAge: maxAgeSec } : {}),
    ...(modifiedSinceSec !== undefined ? { modifiedSince: modifiedSinceSec } : {}),
    options: {
      includeSubdomains: Boolean(req.allowSubdomains),
      includeExternalLinks: Boolean(req.allowExternalLinks),
      ...(req.includePaths && req.includePaths.length > 0
        ? { includePatterns: req.includePaths }
        : {}),
      ...(req.excludePaths && req.excludePaths.length > 0
        ? { excludePatterns: req.excludePaths }
        : {}),
    },
    ...(so?.headers ? { extraHTTPHeaders: so.headers } : {}),
    ...(req.robotsUserAgent || env.USER_AGENT
      ? { userAgent: req.robotsUserAgent ?? env.USER_AGENT }
      : {}),
  };

  return payload;
}

/**
 * Initiate an asynchronous crawl job on Cloudflare's Browser Rendering `/crawl` endpoint.
 */
export async function startCloudflareCrawl(
  req: CrawlRequest,
  env: EngineEnv,
): Promise<{ cfJobId: string; status: string; payload: CloudflareCrawlRequestPayload }> {
  const payload = buildCloudflareCrawlPayload(req, env);

  if (env.BROWSER?.crawl) {
    const res = await env.BROWSER.crawl(payload as unknown as Record<string, unknown>);
    const body = (await res.json()) as {
      success?: boolean;
      result?: { id?: string; status?: string };
      errors?: Array<{ message?: string }>;
    };
    if (!res.ok || !body.result?.id) {
      throw new Error(
        body.errors?.[0]?.message ?? `Cloudflare /crawl binding returned ${res.status}`,
      );
    }
    return { cfJobId: body.result.id, status: body.result.status ?? 'running', payload };
  }

  if (env.CF_ACCOUNT_ID && env.CF_BROWSER_TOKEN) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/crawl`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.CF_BROWSER_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      },
    );
    const body = (await res.json()) as {
      success?: boolean;
      result?: { id?: string; status?: string };
      errors?: Array<{ message?: string }>;
    };
    if (!res.ok || !body.result?.id) {
      throw new Error(
        body.errors?.[0]?.message ?? `Cloudflare /browser-rendering/crawl returned ${res.status}`,
      );
    }
    return { cfJobId: body.result.id, status: body.result.status ?? 'running', payload };
  }

  throw new Error('Cloudflare Browser Rendering /crawl is not configured on this deployment');
}

/**
 * Poll a Cloudflare Browser Rendering `/crawl/{job_id}` job and normalize its records into
 * Firecrawl-compatible Documents, errors, and robotsBlocked arrays.
 */
export async function getCloudflareCrawlStatus(
  cfJobId: string,
  env: EngineEnv,
  opts: { cursor?: string; limit?: number; status?: string } = {},
): Promise<CloudflareCrawlNormalizedStatus> {
  if (!env.CF_ACCOUNT_ID || !env.CF_BROWSER_TOKEN) {
    throw new Error('Cloudflare Browser Rendering REST credentials are required to poll /crawl');
  }
  const params = new URLSearchParams();
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString() ? `?${params.toString()}` : '';

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/crawl/${encodeURIComponent(cfJobId)}${qs}`,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${env.CF_BROWSER_TOKEN}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  const body = (await res.json()) as {
    success?: boolean;
    result?: CloudflareCrawlStatusPayload;
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok || !body.result) {
    throw new Error(body.errors?.[0]?.message ?? `Cloudflare /crawl status failed (${res.status})`);
  }

  return normalizeCloudflareCrawlResult(body.result);
}

/**
 * Normalize a raw Cloudflare `/browser-rendering/crawl/{job_id}` result object into
 * Firecrawl's status, documents, errors, and robotsBlocked lists.
 */
export function normalizeCloudflareCrawlResult(
  result: CloudflareCrawlStatusPayload,
): CloudflareCrawlNormalizedStatus {
  const records = result.records ?? [];
  const documents: Document[] = [];
  const errors: Array<{ id: string; timestamp: string; url: string; error: string }> = [];
  const robotsBlocked: string[] = [];

  for (const rec of records) {
    if (rec.status === 'disallowed') {
      robotsBlocked.push(rec.url);
      continue;
    }
    if (rec.status === 'errored') {
      errors.push({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        url: rec.url,
        error: rec.error ?? `Crawl failed with status ${rec.metadata?.status ?? 'errored'}`,
      });
      continue;
    }
    if (rec.status === 'completed') {
      const statusCode = typeof rec.metadata?.status === 'number' ? rec.metadata.status : 200;
      const title = typeof rec.metadata?.title === 'string' ? rec.metadata.title : undefined;
      const cleanMarkdown = rec.markdown
        ? rec.markdown.replace(/^---\n[\s\S]*?\n---\n+/, '')
        : undefined;
      const doc: Document = {
        url: rec.url,
        ...(title ? { title } : {}),
        ...(cleanMarkdown !== undefined ? { markdown: cleanMarkdown } : {}),
        ...(rec.html !== undefined ? { html: rec.html } : {}),
        ...(rec.json !== undefined ? { json: rec.json } : {}),
        metadata: {
          statusCode,
          sourceURL: rec.url,
          url: rec.metadata?.url ? String(rec.metadata.url) : rec.url,
          ...(title ? { title } : {}),
          proxyUsed: 'basic',
        },
      };
      documents.push(doc);
    }
  }

  const cfStatus = result.status;
  const status: CloudflareCrawlNormalizedStatus['status'] =
    cfStatus === 'completed'
      ? 'completed'
      : cfStatus === 'cancelled'
        ? 'cancelled'
        : cfStatus === 'errored'
          ? 'failed'
          : 'scraping';

  const completed = result.finished ?? documents.length;
  const total = Math.max(result.total ?? records.length, completed);

  return {
    status,
    total,
    completed,
    cursor: result.cursor ?? null,
    documents,
    errors,
    robotsBlocked,
    browserSecondsUsed: result.browserSecondsUsed ?? 0,
  };
}

/**
 * Cancel an active Cloudflare Browser Rendering `/crawl/{job_id}` job.
 */
export async function cancelCloudflareCrawl(cfJobId: string, env: EngineEnv): Promise<boolean> {
  if (!env.CF_ACCOUNT_ID || !env.CF_BROWSER_TOKEN) return false;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/crawl/${encodeURIComponent(cfJobId)}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${env.CF_BROWSER_TOKEN}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export interface CrawlParamsPreviewResult {
  url: string;
  includePaths?: string[];
  excludePaths?: string[];
  maxDiscoveryDepth?: number;
  sitemap?: 'include' | 'only' | 'skip';
  allowExternalLinks?: boolean;
  allowSubdomains?: boolean;
  crawlEntireDomain?: boolean;
  ignoreQueryParameters?: boolean;
  limit?: number;
}

/**
 * Derive crawl parameters (`includePaths`, `excludePaths`, `maxDiscoveryDepth`, `allowSubdomains`,
 * `allowExternalLinks`, `sitemap`) from a natural-language `prompt`.
 * Uses deterministic keyword rules first and enriches with Workers AI when available.
 */
export async function deriveCrawlParamsFromPrompt(
  url: string,
  prompt: string,
  env: EngineEnv,
): Promise<CrawlParamsPreviewResult> {
  const out: CrawlParamsPreviewResult = { url };
  const trimmed = (prompt ?? '').trim();
  if (!trimmed || trimmed.length > 5000) return out;

  const lower = trimmed.toLowerCase();
  const inc: string[] = [];
  const exc: string[] = [];

  if (/\bblog\b/.test(lower)) inc.push('/blog.*');
  if (/\bdocs?\b|\bdocumentation\b|\bguide\b/.test(lower)) inc.push('/docs.*');
  if (/\bapi\b|\breference\b/.test(lower)) inc.push('/api.*');
  if (/\bpricing\b/.test(lower)) inc.push('/pricing.*');
  if (/\bchangelog\b|\brelease/.test(lower)) inc.push('/changelog.*');

  if (/\b(?:exclude|skip|ignore|no|without)\s+(?:admin|login|auth)/i.test(lower)) {
    exc.push('/admin.*', '/login.*');
  }
  if (/\b(?:exclude|skip|ignore|no|without)\s+blog/i.test(lower)) {
    exc.push('/blog.*');
  }
  if (/\bsubdomain/i.test(lower) && !/\bno\s+subdomain|\bwithout\s+subdomain/i.test(lower)) {
    out.allowSubdomains = true;
  }
  if (/\bexternal\s+link/i.test(lower) && !/\bno\s+external|\bwithout\s+external/i.test(lower)) {
    out.allowExternalLinks = true;
  }
  const depthMatch = lower.match(/\bdepth\s*(?:of|=|:)?\s*(\d{1,2})\b/);
  if (depthMatch) out.maxDiscoveryDepth = Number(depthMatch[1]);

  if (inc.length > 0) out.includePaths = inc;
  if (exc.length > 0) out.excludePaths = exc;

  // If deterministic rules didn't find path patterns and Workers AI is available, ask Workers AI
  if (inc.length === 0 && exc.length === 0 && extractAvailable(env) && /[a-z]{3,}/i.test(trimmed)) {
    try {
      const aiRes = (await extractWithAI(
        `Target URL: ${url}\nUser Crawl Instruction: ${trimmed.slice(0, 1000)}`,
        {
          prompt:
            'Convert the user crawl instruction into Firecrawl crawl parameters (includePaths regex array, excludePaths regex array, maxDiscoveryDepth integer, allowSubdomains boolean, allowExternalLinks boolean). Only include fields explicitly implied by the instruction.',
          schema: {
            type: 'object',
            properties: {
              includePaths: { type: 'array', items: { type: 'string' } },
              excludePaths: { type: 'array', items: { type: 'string' } },
              maxDiscoveryDepth: { type: 'integer' },
              allowSubdomains: { type: 'boolean' },
              allowExternalLinks: { type: 'boolean' },
            },
          },
        },
        env,
      )) as Partial<CrawlParamsPreviewResult> | null;
      if (aiRes && typeof aiRes === 'object') {
        if (Array.isArray(aiRes.includePaths) && aiRes.includePaths.length > 0) {
          out.includePaths = aiRes.includePaths.filter((x): x is string => typeof x === 'string');
        }
        if (Array.isArray(aiRes.excludePaths) && aiRes.excludePaths.length > 0) {
          out.excludePaths = aiRes.excludePaths.filter((x): x is string => typeof x === 'string');
        }
        if (typeof aiRes.maxDiscoveryDepth === 'number' && aiRes.maxDiscoveryDepth >= 0) {
          out.maxDiscoveryDepth = aiRes.maxDiscoveryDepth;
        }
        if (typeof aiRes.allowSubdomains === 'boolean') out.allowSubdomains = aiRes.allowSubdomains;
        if (typeof aiRes.allowExternalLinks === 'boolean') {
          out.allowExternalLinks = aiRes.allowExternalLinks;
        }
      }
    } catch {
      /* fallback to deterministic result */
    }
  }

  return out;
}
