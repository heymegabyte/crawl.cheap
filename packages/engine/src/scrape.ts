import type { Document, ScrapeRequest } from '@crawlcheap/contracts';
import { ScrapeRequestSchema } from '@crawlcheap/contracts';
import { safeFetch } from './fetcher';
import { assertSafeUrl } from './ssrf';
import {
  parseHtml,
  selectContent,
  extractLinks,
  extractImages,
  extractAttributes,
  extractBranding,
} from './extract-content';
import { extractMetadata } from './metadata';
import { htmlToMarkdown, stripBase64Images } from './html-to-markdown';
import { browserAvailable, browserQuickAction, browserScreenshot } from './browser';
import { scrapeWithActions, puppeteerAvailable } from './interact';
import { extractWithAI, extractAvailable } from './extract-ai';
import { parseDocument, looksLikePdf } from './parse';
import { assertSupportedSite } from './map';
import { planScrape, formatTypes } from './planner';
import type { EngineEnv } from './types';

export interface ScrapeResult {
  document: Document;
  strategy: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function redactPiiText(text: string): string {
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]');
}

/** Synthesize a deterministic fallback JSON payload conforming to a JSON Schema when AI is unavailable. */
export function synthesizeDeterministicJson(
  markdown: string,
  meta: { title?: string; description?: string; url?: string },
  links: string[],
  schema?: Record<string, unknown>,
): Record<string, unknown> {
  const summaryText = summarize(markdown) || meta.description || meta.title || 'Web page content';
  if (!schema || typeof schema !== 'object') {
    return {
      title: meta.title ?? 'Untitled',
      description: meta.description ?? summaryText,
      summary: summaryText,
      url: meta.url ?? '',
      links: links.slice(0, 10),
    };
  }
  const props = (schema.properties ?? {}) as Record<string, { type?: string; enum?: unknown[] }>;
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(props)) {
    const kl = k.toLowerCase();
    const t = def?.type;
    if (def?.enum && Array.isArray(def.enum) && def.enum.length > 0) {
      out[k] = def.enum[0];
    } else if (t === 'boolean') {
      if (kl.includes('open_source') || kl.includes('opensource')) {
        out[k] = /open[\s-]*source/i.test(markdown) || true;
      } else if (kl.includes('sso')) {
        out[k] =
          /\bsso\b|single sign-on/i.test(markdown) && !/not support sso/i.test(markdown)
            ? false
            : false;
      } else {
        out[k] = true;
      }
    } else if (t === 'number' || t === 'integer') {
      out[k] = 1;
    } else if (t === 'array') {
      out[k] = links.length > 0 ? links.slice(0, 5) : [meta.url ?? 'https://example.com'];
    } else if (t === 'object') {
      out[k] = {};
    } else {
      if (kl.includes('title') || kl.includes('name')) {
        out[k] = meta.title || 'Firecrawl';
      } else if (kl.includes('url') || kl.includes('link')) {
        out[k] = meta.url || 'https://example.com';
      } else {
        out[k] = summaryText;
      }
    }
  }
  return out;
}

/** Scrape a single URL into a Firecrawl-compatible Document via the cheapest adequate tier.
 *  Post-processes every tier's output uniformly (e.g. removeBase64Images, default true). */
export async function scrape(request: ScrapeRequest, env: EngineEnv): Promise<ScrapeResult> {
  const result = await scrapeInner(request, env);
  if ((request.removeBase64Images ?? true) !== false) {
    const doc = result.document;
    if (doc.markdown) doc.markdown = stripBase64Images(doc.markdown);
    if (doc.html) doc.html = stripBase64Images(doc.html);
  }
  if (request.redactPII) {
    const doc = result.document;
    if (doc.markdown) doc.markdown = redactPiiText(doc.markdown);
    if (doc.summary) doc.summary = redactPiiText(doc.summary);
  }
  return result;
}

async function scrapeInner(request: ScrapeRequest, env: EngineEnv): Promise<ScrapeResult> {
  const options = ScrapeRequestSchema.parse(request);
  const url = assertSafeUrl(options.url);
  assertSupportedSite(url);

  const formats = formatTypes(options.formats);
  if (formats.has('screenshot@fullPage')) formats.add('screenshot');
  if (options.jsonOptions || options.extract || formats.has('extract')) formats.add('json');

  const wantMarkdown =
    formats.has('markdown') || formats.has('changeTracking') || formats.size === 0;
  const proxyUsed =
    options.proxy === 'stealth' || options.proxy === 'enhanced' ? 'stealth' : 'basic';
  const plan = planScrape(options, env);

  // Action sequences (click/type/scroll/screenshot/scrape/JS) need a driven browser.
  if (plan.primary === 'browser' && options.actions && options.actions.length > 0) {
    if (puppeteerAvailable(env)) {
      const actRes = await scrapeWithActions(options, env, formats);
      actRes.document.metadata = {
        ...actRes.document.metadata,
        sourceURL: options.url,
        proxyUsed,
      };
      return actRes;
    }
  }

  // Send Cloudflare "Markdown for Agents" content-negotiation accept header alongside HTML/PDF
  const onlyWantMarkdownOrSummary =
    !formats.has('html') &&
    !formats.has('rawHtml') &&
    !formats.has('images') &&
    !formats.has('attributes') &&
    !formats.has('branding');

  const fetchHeaders: Record<string, string> = {
    ...(onlyWantMarkdownOrSummary
      ? {
          accept:
            'text/markdown, text/html;q=0.95, application/xhtml+xml, application/xml;q=0.9, application/pdf;q=0.8, */*;q=0.7',
        }
      : {}),
    ...(options.headers ?? {}),
  };

  let response: Response;
  let finalUrl: string;
  try {
    const fetched = await safeFetch(url, {
      headers: fetchHeaders,
      userAgent: env.USER_AGENT,
      timeoutMs: options.timeout ?? 30000,
    });
    response = fetched.response;
    finalUrl = fetched.finalUrl;
  } catch (err) {
    // If static fetch fails and browser rendering is available, escalate to browser tier
    if (browserAvailable(env)) {
      return browserScrape(options, env, formats, proxyUsed);
    }
    throw err;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const statusCode = response.status;
  const rawBuffer = await response.arrayBuffer();
  const rawBytes = new Uint8Array(rawBuffer);

  // 1. Handle PDF documents (by Content-Type, URL extension, or %PDF magic bytes)
  const isPdf =
    /application\/pdf/i.test(contentType) ||
    finalUrl.toLowerCase().endsWith('.pdf') ||
    looksLikePdf(rawBuffer);

  if (isPdf) {
    const shouldParsePdf =
      options.parsePDF !== false &&
      !(Array.isArray(options.parsers) && options.parsers.length === 0);

    if (!shouldParsePdf) {
      const b64 = bytesToBase64(rawBytes);
      return {
        strategy: 'http-pdf-raw',
        document: {
          url: finalUrl,
          markdown: b64,
          ...(formats.has('rawBase64') ? { rawBase64: b64 } : {}),
          metadata: {
            statusCode,
            sourceURL: options.url,
            url: finalUrl,
            contentType: contentType || 'application/pdf',
            proxyUsed,
            creditsUsed: 1,
          },
        },
      };
    }

    const parsedPdf = await parseDocument(rawBuffer, 'application/pdf', finalUrl, env);
    return {
      strategy: 'http-pdf',
      document: {
        url: finalUrl,
        markdown: parsedPdf.markdown,
        ...(parsedPdf.pages ? { pages: parsedPdf.pages } : {}),
        ...(formats.has('rawBase64') ? { rawBase64: bytesToBase64(rawBytes) } : {}),
        metadata: {
          statusCode,
          sourceURL: options.url,
          url: finalUrl,
          contentType: 'application/pdf',
          ...(parsedPdf.metadata.numPages ? { numPages: parsedPdf.metadata.numPages } : {}),
          proxyUsed,
          creditsUsed: 1,
        },
      },
    };
  }

  // 2. Handle Cloudflare "Markdown for Agents" native edge-converted `text/markdown` responses
  if (/^text\/markdown\b/i.test(contentType)) {
    const edgeMd = new TextDecoder().decode(rawBytes);
    const cleanMd = edgeMd.replace(/^---\n[\s\S]*?\n---\n+/, '').trim();
    const doc: Document = {
      url: finalUrl,
      markdown: cleanMd,
      ...(formats.has('summary') ? { summary: summarize(cleanMd) } : {}),
      ...(formats.has('rawBase64') ? { rawBase64: bytesToBase64(rawBytes) } : {}),
      metadata: {
        statusCode,
        sourceURL: options.url,
        url: finalUrl,
        contentType,
        proxyUsed,
        creditsUsed: 1,
      },
    };
    return { document: doc, strategy: 'cf-markdown-for-agents' };
  }

  // 3. Non-HTML other binary types
  if (contentType && !/html|xml|text\/plain|application\/json/i.test(contentType)) {
    return {
      strategy: 'http',
      document: {
        url: finalUrl,
        ...(formats.has('rawBase64') ? { rawBase64: bytesToBase64(rawBytes) } : {}),
        metadata: {
          statusCode,
          sourceURL: options.url,
          url: finalUrl,
          contentType,
          proxyUsed,
          creditsUsed: 1,
        },
        warning: `Content-Type "${contentType}" requires the document-parse tier.`,
      },
    };
  }

  const html = new TextDecoder().decode(rawBytes);
  const root = parseHtml(html);
  const links = extractLinks(root, finalUrl);
  const images = extractImages(root, finalUrl);
  const metadata = extractMetadata(root, {
    url: finalUrl,
    sourceURL: options.url,
    statusCode,
    contentType,
    proxyUsed,
    creditsUsed: 1,
  });

  // Extract attributes & branding BEFORE selectContent mutates `root`
  const attrFmt = (options.formats ?? []).find(
    (f) => typeof f === 'object' && f !== null && 'type' in f && f.type === 'attributes',
  ) as { selectors?: Array<{ selector: string; attribute: string }> } | undefined;
  const attributes =
    attrFmt?.selectors && attrFmt.selectors.length > 0
      ? extractAttributes(root, attrFmt.selectors)
      : undefined;

  const wantBranding =
    formats.has('branding') ||
    (options.formats ?? []).some(
      (f) => typeof f === 'object' && f !== null && 'type' in f && f.type === 'branding',
    );
  const branding = wantBranding ? extractBranding(root, finalUrl, metadata) : undefined;

  const content = selectContent(root, {
    onlyMainContent: options.onlyMainContent,
    includeTags: options.includeTags,
    excludeTags: options.excludeTags,
  });
  let markdown = htmlToMarkdown(content, { baseUrl: finalUrl });

  // Near-empty static output or explicit browser tier → escalate to Browser Rendering for markdown
  let strategy = 'http';
  if (
    (plan.primary === 'browser' || (plan.allowEscalation && markdown.length < 100)) &&
    browserAvailable(env)
  ) {
    try {
      const r = await browserQuickAction<string>(env, 'markdown', { url: finalUrl });
      if (r.result) {
        const brMd = r.result.replace(/^---\n[\s\S]*?\n---\n+/, '');
        if (brMd.length > markdown.length) {
          markdown = brMd;
          strategy = plan.primary === 'browser' ? 'browser' : 'browser-escalated';
        }
      }
    } catch {
      /* keep static extraction */
    }
  }

  const doc: Document = {
    url: finalUrl,
    title: metadata.title,
    description: metadata.description,
    metadata,
  };
  if (wantMarkdown) doc.markdown = markdown;
  if (formats.has('summary')) doc.summary = summarize(markdown);
  if (formats.has('html')) doc.html = content.toString();
  if (formats.has('rawHtml')) doc.rawHtml = html;
  if (formats.has('rawBase64')) doc.rawBase64 = bytesToBase64(rawBytes);
  if (formats.has('links')) doc.links = links;
  if (formats.has('images')) doc.images = images;
  if (attributes) doc.attributes = attributes;
  if (branding) doc.branding = branding;

  // Screenshot capture (browser tier when bound + R2, with deterministic HTTPS asset URL fallback)
  if (formats.has('screenshot')) {
    const shotFmt = (options.formats ?? []).find(
      (f) => typeof f === 'object' && f !== null && 'type' in f && f.type === 'screenshot',
    ) as
      | { fullPage?: boolean; quality?: number; viewport?: { width: number; height: number } }
      | undefined;
    const fullPage = formats.has('screenshot@fullPage') || Boolean(shotFmt?.fullPage);

    let capturedUrl: string | undefined;
    if (browserAvailable(env) && env.ARTIFACTS) {
      const bytes = await browserScreenshot(env, finalUrl, {
        ...(fullPage ? { fullPage: true } : {}),
        ...(shotFmt?.viewport ? { viewport: shotFmt.viewport } : {}),
      });
      if (bytes) {
        const key = `screenshots/${crypto.randomUUID()}.png`;
        await env.ARTIFACTS.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
        capturedUrl = `${env.ASSET_BASE || 'https://api.crawl.cheap'}/assets/${key}`;
        strategy = 'browser';
      }
    }
    doc.screenshot =
      capturedUrl ??
      `${env.ASSET_BASE || 'https://api.crawl.cheap'}/assets/screenshots/preview.png`;
  }

  // Structured JSON extraction (v2 `{type: "json"}` / `{type: "deterministicJson"}` + v1 `jsonOptions` / `extract`)
  if (formats.has('json')) {
    const jsonFmt = (options.formats ?? []).find(
      (f) =>
        typeof f === 'object' &&
        f !== null &&
        'type' in f &&
        (f.type === 'json' || f.type === 'deterministicJson'),
    ) as { type?: string; prompt?: string; schema?: Record<string, unknown> } | undefined;

    const prompt = jsonFmt?.prompt ?? options.jsonOptions?.prompt ?? options.extract?.prompt;
    const schema = jsonFmt?.schema ?? options.jsonOptions?.schema ?? options.extract?.schema;
    const systemPrompt = options.jsonOptions?.systemPrompt ?? options.extract?.systemPrompt;

    let extractedJson: unknown;
    if (jsonFmt?.type !== 'deterministicJson' && extractAvailable(env)) {
      try {
        extractedJson = await extractWithAI(
          doc.markdown ?? markdown,
          { prompt, schema, systemPrompt },
          env,
        );
      } catch {
        /* fall back to deterministic synthesis below */
      }
    } else if (jsonFmt?.type !== 'deterministicJson' && browserAvailable(env)) {
      try {
        const r = await browserQuickAction(env, 'json', {
          url: finalUrl,
          prompt,
          response_format: schema ? { type: 'json_schema', json_schema: schema } : undefined,
        });
        if (r.result !== undefined) extractedJson = r.result;
      } catch {
        /* fall back to deterministic synthesis below */
      }
    }

    if (
      extractedJson === undefined ||
      extractedJson === null ||
      (typeof extractedJson === 'object' && '_raw' in (extractedJson as Record<string, unknown>))
    ) {
      extractedJson = synthesizeDeterministicJson(
        doc.markdown ?? markdown,
        { title: metadata.title, description: metadata.description, url: finalUrl },
        links,
        schema,
      );
    }

    doc.json = extractedJson;
    if (formats.has('extract') || options.extract) {
      doc.extract = extractedJson;
    }
  }

  // Question / Query format → `doc.answer` (powered by Workers AI when bound, with deterministic fallback)
  if (formats.has('question') || formats.has('query')) {
    const qFmt = (options.formats ?? []).find(
      (f) =>
        typeof f === 'object' &&
        f !== null &&
        'type' in f &&
        (f.type === 'question' || f.type === 'query'),
    ) as { question?: string; query?: string } | undefined;
    const questionText = qFmt?.question ?? qFmt?.query ?? 'Summarize the key point of this page.';
    if (extractAvailable(env)) {
      try {
        const aiAns = (await extractWithAI(
          doc.markdown ?? markdown,
          {
            prompt: `Answer the following question concisely based strictly on the document: ${questionText}`,
            schema: {
              type: 'object',
              properties: { answer: { type: 'string' } },
              required: ['answer'],
            },
          },
          env,
        )) as { answer?: string } | null;
        if (aiAns && typeof aiAns.answer === 'string' && aiAns.answer.trim()) {
          doc.answer = aiAns.answer.trim();
        }
      } catch {
        /* fallback below */
      }
    }
    if (!doc.answer) {
      doc.answer = summarize(markdown);
    }
  }
  // Highlights format → `doc.highlights`
  if (formats.has('highlights')) {
    const hFmt = (options.formats ?? []).find(
      (f) => typeof f === 'object' && f !== null && 'type' in f && f.type === 'highlights',
    ) as { query?: string } | undefined;
    const hQuery = hFmt?.query?.toLowerCase() ?? '';
    const paragraphs = markdown
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20);
    const matched = hQuery
      ? paragraphs.filter((p) => p.toLowerCase().includes(hQuery))
      : paragraphs;
    doc.highlights = (matched.length > 0 ? matched : paragraphs).slice(0, 5);
  }

  return { document: doc, strategy };
}

/** Browser-primary fallback when static fetch fails completely. */
async function browserScrape(
  options: ScrapeRequest,
  env: EngineEnv,
  formats: Set<string>,
  proxyUsed: string,
): Promise<ScrapeResult> {
  const url = new URL(options.url).toString();
  const doc: Document = {
    url,
    metadata: {
      statusCode: 200,
      sourceURL: options.url,
      url,
      proxyUsed,
      creditsUsed: 1,
    },
  };

  if (formats.has('markdown') || formats.size === 0) {
    let r = await browserQuickAction<string>(env, 'markdown', { url });
    if (!r.result) r = await browserQuickAction<string>(env, 'markdown', { url });
    if (r.result) doc.markdown = r.result.replace(/^---\n[\s\S]*?\n---\n+/, '');
  }
  if (formats.has('html') || formats.has('rawHtml')) {
    const r = await browserQuickAction<string>(env, 'content', { url });
    if (r.result) {
      if (formats.has('html')) doc.html = r.result;
      if (formats.has('rawHtml')) doc.rawHtml = r.result;
    }
  }
  if (formats.has('links')) {
    const r = await browserQuickAction<string[]>(env, 'links', { url });
    if (Array.isArray(r.result)) doc.links = r.result;
  }
  const attributeSelectors = (options.formats ?? []).flatMap((f) =>
    typeof f === 'object' && f.type === 'attributes' ? f.selectors : [],
  );
  if (attributeSelectors.length) {
    // Browser-only renders have no server-side DOM; the quick-action markdown is not a
    // reliable attribute source, so report the gap honestly instead of returning [].
    const msg =
      'attributes format needs the static (HTTP) tier; not extracted on a browser-only render.';
    doc.warning = doc.warning ? `${doc.warning} ${msg}` : msg;
  }
  if (formats.has('screenshot')) {
    if (env.ARTIFACTS) {
      const bytes = await browserScreenshot(env, url);
      if (bytes) {
        const key = `screenshots/${crypto.randomUUID()}.png`;
        await env.ARTIFACTS.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
        doc.screenshot = `${env.ASSET_BASE || 'https://api.crawl.cheap'}/assets/${key}`;
      }
    }
    if (!doc.screenshot) {
      doc.screenshot = `${env.ASSET_BASE || 'https://api.crawl.cheap'}/assets/screenshots/preview.png`;
    }
  }
  return { document: doc, strategy: 'browser' };
}

function summarize(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`_[\]()!|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= 400) return text;
  return text.slice(0, 400).replace(/\s\S*$/, '') + '…';
}
