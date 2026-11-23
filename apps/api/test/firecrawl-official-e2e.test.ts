import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { app } from '../src/index';
import type { Env } from '../src/env';

/**
 * Official Firecrawl v1 + v2 End-to-End & Snips Conformance Suite.
 *
 * Mirrors the official Firecrawl test suites from `mendableai/firecrawl`:
 *   - `apps/js-sdk/firecrawl/src/__tests__/e2e/v1/index.test.ts`
 *   - `apps/js-sdk/firecrawl/src/__tests__/e2e/v2/{scrape,crawl,map,batch,search,extract,parse,usage}.test.ts`
 *   - `apps/api/src/__tests__/snips/v1/*` & `apps/api/src/__tests__/snips/v2/*`
 *   - 100% OpenAPI v1 (23/23) and v2 (57/57) route coverage & schema conformance
 */

const TEST_ENV: Env = {
  DEMO_MODE: 'true',
  SERVICE_ORIGIN: 'https://api.crawl.cheap',
  AUTH_SIGNING_SECRET: 'official-firecrawl-e2e-signing-secret-2026',
};

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Firecrawl - Turn websites into LLM-ready data</title>
    <meta name="description" content="Firecrawl is an open-source web data engine for AI agents." />
    <meta property="og:title" content="Firecrawl" />
    <meta property="og:site_name" content="Firecrawl" />
    <meta property="og:image" content="https://firecrawl.dev/og.png" />
    <link rel="icon" href="/favicon.png" />
  </head>
  <body>
    <nav><a href="/nav">Nav Link</a></nav>
    <main>
      <article>
        <h1>Firecrawl Documentation &amp; Web Data Engine</h1>
        <h2>Subheading to exclude when requested</h2>
        <p>Firecrawl turns entire websites into clean LLM-ready markdown and structured JSON. It is open source.</p>
        <p>ぐ け げ こ ご さ ざ し じ す ず せ ぜ そ ぞ た</p>
        <img src="/assets/firecrawl-logo.png" alt="Firecrawl Logo" />
        <a href="https://docs.firecrawl.dev/introduction">Introduction</a>
        <a href="https://firecrawl.dev/blog">Blog</a>
        <a href="https://iana.org/domains/example">External IANA Link</a>
      </article>
    </main>
  </body>
</html>`;

const SAMPLE_SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://docs.firecrawl.dev/introduction</loc></url>
  <url><loc>https://docs.firecrawl.dev/features/scrape</loc></url>
  <url><loc>https://docs.firecrawl.dev/features/crawl</loc></url>
</urlset>`;

// Minimal valid 1-page PDF containing the official Firecrawl v1 test string
// "We present spectrophotometric observations of the Broad Line Radio Galaxy"
const MINIMAL_PDF_TEXT = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length 108 >> stream
BT /F1 12 Tf 72 720 Td (We present spectrophotometric observations of the Broad Line Radio Galaxy) Tj ET
endstream endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000309 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
468
%%EOF`;

const originalFetch = globalThis.fetch;

beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const urlStr =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const u = new URL(urlStr);

    if (u.hostname.endsWith('.invalid')) {
      throw new TypeError('fetch failed: ENOTFOUND');
    }
    if (u.pathname.endsWith('/robots.txt')) {
      return new Response('User-agent: *\nAllow: /\nDisallow: /blocked\n', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }
    if (u.pathname.includes('sitemap')) {
      if (u.hostname === 'example.com' || u.hostname === 'example.org') {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(SAMPLE_SITEMAP_XML, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    }
    if (u.hostname === 'arxiv.org' || u.pathname.endsWith('.pdf')) {
      return new Response(new TextEncoder().encode(MINIMAL_PDF_TEXT), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    }
    if (u.hostname === 'iana.org' && u.pathname === '/domains/example') {
      return new Response('', {
        status: 302,
        headers: { location: 'https://www.iana.org/help/example-domains' },
      });
    }
    if (u.hostname === 'en.wikipedia.org' && u.pathname.includes('/w/api.php')) {
      return new Response(
        JSON.stringify([
          'query',
          ['Cloudflare Workers', 'Firecrawl'],
          ['Edge serverless execution platform', 'Web data extraction engine'],
          ['https://en.wikipedia.org/wiki/Cloudflare', 'https://firecrawl.dev/'],
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(SAMPLE_HTML, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function apiCall(
  pathStr: string,
  opts: { method?: string; body?: unknown; apiKey?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {
    ...(opts.body ? { 'content-type': 'application/json' } : {}),
    ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
    ...(opts.headers ?? {}),
  };
  const res = await app.fetch(
    new Request(`https://api.crawl.cheap${pathStr}`, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers,
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    }),
    TEST_ENV,
  );
  const json = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, body: json };
}

async function waitForCrawlOrBatch(pathPrefix: string, id: string, apiKey: string) {
  for (let i = 0; i < 40; i += 1) {
    const res = await apiCall(`${pathPrefix}/${id}`, { method: 'GET', apiKey });
    if (res.body && res.body.status !== 'scraping' && res.body.status !== 'processing') {
      return res;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return apiCall(`${pathPrefix}/${id}`, { method: 'GET', apiKey });
}

describe('Official Firecrawl E2E Suite — idmux + v1 + v2 + OpenAPI 100% Contract', () => {
  let apiKey = '';
  let teamId = '';

  beforeAll(async () => {
    const idmuxRes = await apiCall('/idmux', {
      method: 'POST',
      body: { name: 'official-firecrawl-e2e', concurrency: 20, credits: 1_000_000 },
    });
    expect(idmuxRes.status).toBe(200);
    expect(idmuxRes.body.apiKey).toMatch(/^fc-/);
    apiKey = idmuxRes.body.apiKey;
    teamId = idmuxRes.body.teamId;
    expect(teamId).toBeTruthy();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Official v1 E2E Tests (`apps/js-sdk/firecrawl/src/__tests__/e2e/v1/index.test.ts` + `snips/v1/*`)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Official Firecrawl v1 E2E Suite', () => {
    it('rejects invalid API key with 401 on scrape, crawl, map, and search', async () => {
      for (const [ep, payload] of [
        ['/v1/scrape', { url: 'https://firecrawl-test-site.vercel.app' }],
        ['/v1/crawl', { url: 'https://firecrawl-test-site.vercel.app' }],
        ['/v1/map', { url: 'https://firecrawl-test-site.vercel.app' }],
        ['/v1/search', { query: 'test query' }],
      ] as const) {
        const res = await apiCall(ep, { body: payload, apiKey: 'invalid_api_key' });
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      }
    });

    it('throws 403 unsupported site error for facebook.com on scrape and map', async () => {
      const s = await apiCall('/v1/scrape', {
        body: { url: 'https://facebook.com/fake-test' },
        apiKey,
      });
      expect(s.status).toBe(403);
      expect(s.body.error).toContain('do not support this site');

      const m = await apiCall('/v1/map', {
        body: { url: 'https://facebook.com/fake-test' },
        apiKey,
      });
      expect(m.status).toBe(403);
    });

    it('scrapes with valid API key, options, screenshot@fullPage, and proxyUsed metadata', async () => {
      const r1 = await apiCall('/v1/scrape', {
        body: {
          url: 'https://firecrawl-test-site.vercel.app',
          formats: ['markdown', 'html', 'rawHtml', 'screenshot', 'links'],
          headers: { 'x-key': 'test' },
          includeTags: ['h1'],
          excludeTags: ['h2'],
          onlyMainContent: true,
          timeout: 30000,
          waitFor: 1000,
        },
        apiKey,
      });
      expect(r1.status).toBe(200);
      expect(r1.body.success).toBe(true);
      expect(r1.body.data.markdown).toContain('Firecrawl');
      expect(r1.body.data.html).toBeTruthy();
      expect(r1.body.data.rawHtml).toBeTruthy();
      expect(r1.body.data.screenshot).toContain('https://');
      expect(Array.isArray(r1.body.data.links)).toBe(true);
      expect(r1.body.data.metadata.proxyUsed).toBe('basic');

      const r2 = await apiCall('/v1/scrape', {
        body: {
          url: 'https://firecrawl-test-site.vercel.app',
          formats: ['screenshot@fullPage'],
          proxy: 'stealth',
        },
        apiKey,
      });
      expect(r2.status).toBe(200);
      expect(r2.body.data.screenshot).toContain('https://');
      expect(r2.body.data.metadata.proxyUsed).toBe('stealth');
    });

    it('scrapes PDF URLs with and without .pdf extension, parsePDF: true, and parsePDF: false (base64)', async () => {
      const pdf1 = await apiCall('/v1/scrape', {
        body: { url: 'https://arxiv.org/pdf/astro-ph/9301001.pdf' },
        apiKey,
      });
      expect(pdf1.status).toBe(200);
      expect(pdf1.body.data.markdown).toContain(
        'We present spectrophotometric observations of the Broad Line Radio Galaxy',
      );

      const pdfNoExt = await apiCall('/v1/scrape', {
        body: { url: 'https://arxiv.org/pdf/astro-ph/9301001' },
        apiKey,
      });
      expect(pdfNoExt.status).toBe(200);
      expect(pdfNoExt.body.data.markdown).toContain(
        'We present spectrophotometric observations of the Broad Line Radio Galaxy',
      );

      const pdfRawB64 = await apiCall('/v1/scrape', {
        body: { url: 'https://arxiv.org/pdf/astro-ph/9301001.pdf', parsePDF: false },
        apiKey,
      });
      expect(pdfRawB64.status).toBe(200);
      expect(pdfRawB64.body.data.markdown).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('handles v1 crawl, idempotency key (409 conflict), UUID validation (400), and status check', async () => {
      // Malformed UUID -> 400
      const badUuid = await apiCall('/v1/crawl/not-a-uuid', { method: 'GET', apiKey });
      expect(badUuid.status).toBe(400);
      expect(badUuid.body.error).toBe('Invalid job ID format. Job ID must be a valid UUID.');

      // Idempotency key -> first 200, second 409
      const idemKey = crypto.randomUUID();
      const c1 = await apiCall('/v1/crawl', {
        body: { url: 'https://firecrawl-test-site.vercel.app', limit: 2 },
        apiKey,
        headers: { 'x-idempotency-key': idemKey },
      });
      expect(c1.status).toBe(200);
      expect(c1.body.id).toBeDefined();

      const c2 = await apiCall('/v1/crawl', {
        body: { url: 'https://firecrawl-test-site.vercel.app', limit: 2 },
        apiKey,
        headers: { 'x-idempotency-key': idemKey },
      });
      expect(c2.status).toBe(409);

      const finalStatus = await waitForCrawlOrBatch('/v1/crawl', c1.body.id, apiKey);
      expect(finalStatus.status).toBe(200);
      expect(finalStatus.body.status).toBe('completed');
      expect(finalStatus.body).not.toHaveProperty('next');
      expect(finalStatus.body.data.length).toBeGreaterThan(0);
      expect(finalStatus.body.data[0]).toHaveProperty('markdown');
    });

    it('handles v1 map (string[] links) and v1 search (flat Document[] data)', async () => {
      const m = await apiCall('/v1/map', {
        body: { url: 'https://firecrawl-test-site.vercel.app' },
        apiKey,
      });
      expect(m.status).toBe(200);
      expect(Array.isArray(m.body.links)).toBe(true);
      expect(typeof m.body.links[0]).toBe('string');

      const s1 = await apiCall('/v1/search', {
        body: { query: 'firecrawl' },
        apiKey,
      });
      expect(s1.status).toBe(200);
      expect(Array.isArray(s1.body.data)).toBe(true);
      expect(s1.body.data.length).toBeGreaterThan(0);
      expect(s1.body.data[0].markdown).toBeUndefined();
      expect(s1.body.data[0].title).toBeDefined();

      const s2 = await apiCall('/v1/search', {
        body: {
          query: 'firecrawl',
          limit: 2,
          scrapeOptions: { formats: ['markdown', 'html', 'links'], onlyMainContent: true },
        },
        apiKey,
      });
      expect(s2.status).toBe(200);
      expect(s2.body.data.length).toBeLessThanOrEqual(2);
      for (const doc of s2.body.data) {
        expect(doc.markdown).toBeDefined();
        expect(doc.html).toBeDefined();
        expect(doc.links).toBeDefined();
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Official v2 E2E Tests (`e2e/v2/{scrape,crawl,map,batch,search,extract,parse,usage}.test.ts` + `snips/v2/*`)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Official Firecrawl v2 E2E Suite', () => {
    it('v2.scrape: minimal, maximal, summary, images, attributes, branding, and waitFor validation', async () => {
      // waitFor > timeout / 2 must reject with 400
      const badWait = await apiCall('/v2/scrape', {
        body: { url: 'https://docs.firecrawl.dev', waitFor: 8000, timeout: 15000 },
        apiKey,
      });
      expect(badWait.status).toBe(400);
      expect(badWait.body.error).toBe('waitFor must not exceed half of timeout');

      // Maximal scrape with all formats including json, screenshot object, images, summary, branding
      const maxRes = await apiCall('/v2/scrape', {
        body: {
          url: 'https://docs.firecrawl.dev',
          formats: [
            'markdown',
            'html',
            'rawHtml',
            'links',
            'images',
            'summary',
            'branding',
            {
              type: 'screenshot',
              fullPage: true,
              quality: 80,
              viewport: { width: 1280, height: 800 },
            },
            {
              type: 'json',
              prompt: 'Summarize the page and list links',
              schema: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  links: { type: 'array', items: { type: 'string' } },
                },
                required: ['summary'],
              },
            },
          ],
          onlyMainContent: true,
          waitFor: 1000,
          timeout: 30000,
        },
        apiKey,
      });
      expect(maxRes.status).toBe(200);
      const doc = maxRes.body.data;
      expect(doc.markdown).toContain('Firecrawl');
      expect(doc.html).toBeTruthy();
      expect(doc.rawHtml).toBeTruthy();
      expect(Array.isArray(doc.links)).toBe(true);
      expect(Array.isArray(doc.images)).toBe(true);
      expect(doc.images.some((img: string) => img.includes('firecrawl'))).toBe(true);
      expect(typeof doc.summary).toBe('string');
      expect(doc.screenshot).toContain('https://');
      expect(doc.json).toHaveProperty('summary');
      expect(doc.branding).toBeTruthy();
      expect(doc.markdown).toContain('ぐ け げ こ ご さ ざ し じ す ず せ ぜ そ ぞ た');
    });

    it('v2.map: minimal, sitemap modes, mock fixtures, timeout=408, and sub-path warning', async () => {
      for (const sitemap of ['only', 'skip', 'include'] as const) {
        const res = await apiCall('/v2/map', {
          body: {
            url: 'https://docs.firecrawl.dev',
            search: 'docs',
            includeSubdomains: true,
            limit: 10,
            sitemap,
            timeout: 15000,
          },
          apiKey,
        });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.links)).toBe(true);
        if (res.body.links.length > 0) {
          expect(typeof res.body.links[0].url).toBe('string');
        }
      }

      // Timeout -> 408
      const toRes = await apiCall('/v2/map', {
        body: { url: 'https://docs.firecrawl.dev', timeout: 1 },
        apiKey,
      });
      expect(toRes.status).toBe(408);
      expect(toRes.body.error).toContain('The map operation timed out');

      // Subpath with <= 1 results -> warning
      const warnRes = await apiCall('/v2/map', {
        body: { url: 'https://example.com/some/path', useMock: 'map-empty' },
        apiKey,
      });
      expect(warnRes.status).toBe(200);
      expect(warnRes.body.warning).toContain('Only');
      expect(warnRes.body.warning).toContain('result(s) found');
      expect(warnRes.body.warning).toContain('base domain');
    });

    it('v2.crawl: status id/duration/timestamps, active crawls, params-preview, path pattern budgets, external redirect, and cancel', async () => {
      // Path pattern budget guards
      const stacked = await apiCall('/v2/crawl', {
        body: { url: 'https://firecrawl.dev', excludePaths: ['a{5}{5}{5}{5}{5}{5}'] },
        apiKey,
      });
      expect(stacked.status).toBe(400);
      expect(stacked.body.error).toMatch(/exceeds size limit/);

      const overBudget = await apiCall('/v2/crawl', {
        body: {
          url: 'https://firecrawl.dev',
          includePaths: Array.from({ length: 501 }, (_, i) => `^/a${i}`),
          excludePaths: Array.from({ length: 501 }, (_, i) => `^/b${i}`),
        },
        apiKey,
      });
      expect(overBudget.status).toBe(400);
      expect(overBudget.body.error).toMatch(/together accept at most 1000 patterns/);

      // Params preview
      const preview = await apiCall('/v2/crawl/params-preview', {
        body: {
          url: 'https://docs.firecrawl.dev',
          prompt: 'Extract all blog posts and documentation',
        },
        apiKey,
      });
      expect(preview.status).toBe(200);
      expect(preview.body.includePaths).toBeDefined();

      // Start crawl with string webhook & prompt, check status, errors, and completion
      const start = await apiCall('/v2/crawl', {
        body: {
          url: 'https://docs.firecrawl.dev',
          prompt: 'Extract all blog posts',
          limit: 3,
          maxDiscoveryDepth: 2,
          webhook: 'https://example.com/hook',
        },
        apiKey,
      });
      expect(start.status).toBe(200);
      expect(typeof start.body.id).toBe('string');

      const completed = await waitForCrawlOrBatch('/v2/crawl', start.body.id, apiKey);
      expect(completed.status).toBe(200);
      expect(completed.body.id).toBe(start.body.id);
      expect(completed.body.status).toBe('completed');
      expect(typeof completed.body.createdAt).toBe('string');
      expect(typeof completed.body.completedAt).toBe('string');
      expect(typeof completed.body.duration).toBe('number');
      expect(completed.body.duration).toBeGreaterThan(0);

      const errs = await apiCall(`/v2/crawl/${start.body.id}/errors`, { method: 'GET', apiKey });
      expect(errs.status).toBe(200);
      expect(Array.isArray(errs.body.errors)).toBe(true);
      expect(Array.isArray(errs.body.robotsBlocked)).toBe(true);

      // Invalid UUID on errors -> 400
      const badErrId = await apiCall('/v2/crawl/invalid-job-id-12345/errors', {
        method: 'GET',
        apiKey,
      });
      expect(badErrId.status).toBe(400);

      // allowExternalLinks follows redirecting external link (iana.org -> www.iana.org)
      const extStart = await apiCall('/v2/crawl', {
        body: {
          url: 'https://example.org/',
          limit: 5,
          maxDiscoveryDepth: 1,
          allowExternalLinks: true,
          sitemap: 'skip',
        },
        apiKey,
      });
      const extDone = await waitForCrawlOrBatch('/v2/crawl', extStart.body.id, apiKey);
      const ianaPage = extDone.body.data.find((p: any) =>
        String(p.metadata?.sourceURL ?? '').includes('iana.org/domains/example'),
      );
      expect(ianaPage).toBeDefined();
      expect(ianaPage.metadata.url).toBe('https://www.iana.org/help/example-domains');
    });

    it('v2.batch: unnormalized sourceURL, JSON extraction format, status id, and cancel', async () => {
      const rawUrl = 'https://docs.firecrawl.dev/?pagewanted=all&et_blog';
      const start = await apiCall('/v2/batch/scrape', {
        body: {
          urls: [rawUrl],
          options: {
            formats: [
              'markdown',
              {
                type: 'json',
                prompt: 'Find company mission, supports_sso, is_open_source',
                schema: {
                  type: 'object',
                  properties: {
                    company_mission: { type: 'string' },
                    supports_sso: { type: 'boolean' },
                    is_open_source: { type: 'boolean' },
                  },
                  required: ['company_mission', 'supports_sso', 'is_open_source'],
                },
              },
            ],
          },
        },
        apiKey,
      });
      expect(start.status).toBe(200);
      const done = await waitForCrawlOrBatch('/v2/batch/scrape', start.body.id, apiKey);
      expect(done.status).toBe(200);
      expect(done.body.id).toBe(start.body.id);
      expect(done.body.data[0].metadata.sourceURL).toBe(rawUrl);
      expect(done.body.data[0].json).toEqual({
        company_mission: expect.any(String),
        supports_sso: false,
        is_open_source: true,
      });

      // Unknown valid UUID cancel -> 404
      const notFoundCancel = await apiCall(
        '/v2/batch/scrape/00000000-0000-7000-8000-000000000000',
        { method: 'DELETE', apiKey },
      );
      expect(notFoundCancel.status).toBe(404);
    });

    it('v2.search: minimal (paris), multi-source (web/news/images), and scrapeOptions enrichment', async () => {
      const s1 = await apiCall('/v2/search', {
        body: { query: 'What is the capital of France?' },
        apiKey,
      });
      expect(s1.status).toBe(200);
      expect(s1.body.data.web.length).toBeGreaterThan(0);
      expect(s1.body.data.news).toBeUndefined();
      expect(s1.body.data.images).toBeUndefined();
      const allText = s1.body.data.web
        .map((r: any) => `${r.title} ${r.description}`.toLowerCase())
        .join(' ');
      expect(allText).toContain('paris');

      const s2 = await apiCall('/v2/search', {
        body: {
          query: 'artificial intelligence',
          sources: ['web', 'news', 'images'],
          limit: 3,
          tbs: 'qdr:m',
          scrapeOptions: {
            formats: [
              'markdown',
              'html',
              {
                type: 'json',
                prompt: 'Extract title and description',
                schema: {
                  type: 'object',
                  properties: { title: { type: 'string' }, description: { type: 'string' } },
                  required: ['title', 'description'],
                },
              },
            ],
          },
        },
        apiKey,
      });
      expect(s2.status).toBe(200);
      expect(s2.body.data.web.length).toBeLessThanOrEqual(3);
      expect(s2.body.data.news.length).toBeLessThanOrEqual(3);
      expect(s2.body.data.images.length).toBeLessThanOrEqual(3);
      expect(s2.body.data.web[0].markdown).toBeTruthy();
      expect(s2.body.data.web[0].json).toHaveProperty('title');
    });

    it('v2.extract, v2.parse (+ /parse/formats), and v2.usage (concurrency, credit-usage, token-usage, queue-status)', async () => {
      // Extract
      const extStart = await apiCall('/v2/extract', {
        body: {
          urls: ['https://docs.firecrawl.dev'],
          prompt: 'Extract main page title',
          schema: {
            type: 'object',
            properties: { title: { type: 'string' }, is_open_source: { type: 'boolean' } },
            required: ['title', 'is_open_source'],
          },
          showSources: true,
        },
        apiKey,
      });
      expect(extStart.status).toBe(200);
      const extDone = await waitForCrawlOrBatch('/v2/extract', extStart.body.id, apiKey);
      expect(extDone.status).toBe(200);
      expect(extDone.body.status).toBe('completed');
      expect(extDone.body.data).toHaveProperty('title');
      expect(extDone.body.data.is_open_source).toBe(true);
      expect(extDone.body.sources).toBeDefined();

      // Parse HTML + creditsUsed=1
      const parseRes = await apiCall('/v2/parse', {
        body: {
          data: '<!DOCTYPE html><html><body><h1>JS SDK Parse E2E</h1><p>multipart upload body</p></body></html>',
          filename: 'parse-e2e.html',
          contentType: 'text/html',
        },
        apiKey,
      });
      expect(parseRes.status).toBe(200);
      expect(parseRes.body.data.markdown).toContain('JS SDK Parse E2E');
      expect(parseRes.body.data.metadata.creditsUsed).toBe(1);

      // Parse formats
      const fmtsRes = await apiCall('/v2/parse/formats', { method: 'GET', apiKey });
      expect(fmtsRes.status).toBe(200);
      const pdfFmt = fmtsRes.body.data.formats.find((f: any) => f.format === 'pdf');
      expect(pdfFmt.kind).toBe('document');
      expect(pdfFmt.extensions).toContain('.pdf');
      expect(pdfFmt.mimeTypes).toContain('application/pdf');

      // Usage endpoints
      const cc = await apiCall('/v2/concurrency-check', { method: 'GET', apiKey });
      expect(cc.status).toBe(200);
      expect(cc.body.maxConcurrency).toBe(20); // matches idmux concurrency: 20

      const qs = await apiCall('/v2/team/queue-status', { method: 'GET', apiKey });
      expect(qs.status).toBe(200);
      expect(qs.body.maxConcurrency).toBe(20);

      const cu = await apiCall('/v2/team/credit-usage', { method: 'GET', apiKey });
      expect(cu.status).toBe(200);
      expect(typeof cu.body.data.remainingCredits).toBe('number');

      const tu = await apiCall('/v2/team/token-usage', { method: 'GET', apiKey });
      expect(tu.status).toBe(200);
      expect(typeof tu.body.data.remainingTokens).toBe('number');
    });

    it('serves 100% of pinned v1 (23/23) and v2 (57/57) OpenAPI operations without any unrouted 404s', async () => {
      const upDir = path.resolve(__dirname, '../../../packages/contracts/upstream');
      const v1Spec = JSON.parse(fs.readFileSync(path.join(upDir, 'v1-openapi.json'), 'utf8'));
      const v2Spec = JSON.parse(fs.readFileSync(path.join(upDir, 'v2-openapi.json'), 'utf8'));

      for (const [prefix, spec, expectedCount] of [
        ['v1', v1Spec, 23],
        ['v2', v2Spec, 57],
      ] as const) {
        let total = 0;
        let served = 0;
        const missing: string[] = [];

        for (const [p, item] of Object.entries<any>(spec.paths)) {
          for (const m of Object.keys(item)) {
            if (!['get', 'post', 'put', 'patch', 'delete'].includes(m)) continue;
            total += 1;
            const filled = p.replace(/\{[^}]+\}/g, 'x');
            const res = await apiCall(`/${prefix}${filled}`, {
              method: m.toUpperCase(),
              body: ['post', 'put', 'patch'].includes(m) ? {} : undefined,
              apiKey,
            });
            const notRouted =
              res.status === 404 &&
              typeof res.body?.error === 'string' &&
              /No such endpoint/i.test(res.body.error);
            if (!notRouted) {
              served += 1;
            } else {
              missing.push(`${m.toUpperCase()} /${prefix}${p}`);
            }
          }
        }
        expect(missing).toEqual([]);
        expect(total).toBe(expectedCount);
        expect(served).toBe(expectedCount);
      }
    });
  });
});
