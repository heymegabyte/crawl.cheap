import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildCloudflareCrawlPayload,
  normalizeCloudflareCrawlResult,
  startCloudflareCrawl,
  getCloudflareCrawlStatus,
  cancelCloudflareCrawl,
  deriveCrawlParamsFromPrompt,
  parseHtml,
  extractImages,
  extractAttributes,
  extractBranding,
} from '../src/index';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Cloudflare Browser Rendering /crawl integration', () => {
  it('maps Firecrawl CrawlRequest to Cloudflare /browser-rendering/crawl payload (static vs browser render)', () => {
    const staticPayload = buildCloudflareCrawlPayload(
      {
        url: 'https://docs.example.com/guide',
        limit: 50,
        maxDiscoveryDepth: 3,
        sitemap: 'only',
        allowSubdomains: true,
        allowExternalLinks: false,
        includePaths: ['/guide/*'],
        excludePaths: ['/guide/legacy/*'],
        modifiedSince: 1704067200,
        maxAge: 3600,
        scrapeOptions: {
          formats: [
            'markdown',
            'html',
            {
              type: 'json',
              prompt: 'Extract title',
              schema: { type: 'object', properties: { title: { type: 'string' } } },
            },
          ],
          headers: { 'x-custom': '1' },
        },
      },
      { USER_AGENT: 'crawlcheap-test/1.0' },
    );

    expect(staticPayload.url).toBe('https://docs.example.com/guide');
    expect(staticPayload.limit).toBe(50);
    expect(staticPayload.maxDepth).toBe(3);
    expect(staticPayload.depth).toBe(3);
    expect(staticPayload.source).toBe('sitemaps');
    expect(staticPayload.render).toBe(false);
    expect(staticPayload.formats).toEqual(['markdown', 'html', 'json']);
    expect(staticPayload.jsonOptions).toEqual({
      prompt: 'Extract title',
      response_format: {
        type: 'json_schema',
        json_schema: { type: 'object', properties: { title: { type: 'string' } } },
      },
    });
    expect(staticPayload.maxAge).toBe(3600);
    expect(staticPayload.modifiedSince).toBe(1704067200);
    expect(staticPayload.options).toEqual({
      includeSubdomains: true,
      includeExternalLinks: false,
      includePatterns: ['/guide/*'],
      excludePatterns: ['/guide/legacy/*'],
    });
    expect(staticPayload.extraHTTPHeaders).toEqual({ 'x-custom': '1' });
    expect(staticPayload.userAgent).toBe('crawlcheap-test/1.0');

    // Escalates render=true when waitFor or mobile or stealth proxy is requested
    const renderedPayload = buildCloudflareCrawlPayload(
      {
        url: 'https://spa.example.com',
        ignoreSitemap: true,
        scrapeOptions: { waitFor: 1500, mobile: true },
      },
      {},
    );
    expect(renderedPayload.render).toBe(true);
    expect(renderedPayload.source).toBe('links');
  });

  it('normalizes Cloudflare /crawl records (completed, disallowed -> robotsBlocked, errored -> errors)', () => {
    const normalized = normalizeCloudflareCrawlResult({
      id: 'cf_crawl_123',
      status: 'completed',
      browserSecondsUsed: 4.2,
      total: 3,
      finished: 1,
      cursor: null,
      records: [
        {
          url: 'https://example.com/',
          status: 'completed',
          markdown: '---\ntitle: Example\n---\n\n# Example Domain\nHello world',
          html: '<h1>Example Domain</h1>',
          json: { title: 'Example Domain' },
          metadata: { title: 'Example Domain', status: 200 },
        },
        {
          url: 'https://example.com/private',
          status: 'disallowed',
        },
        {
          url: 'https://example.com/broken',
          status: 'errored',
          error: 'HTTP 502 Bad Gateway',
          metadata: { status: 502 },
        },
      ],
    });

    expect(normalized.status).toBe('completed');
    expect(normalized.completed).toBe(1);
    expect(normalized.total).toBe(3);
    expect(normalized.documents).toHaveLength(1);
    expect(normalized.documents[0]?.markdown).toBe('# Example Domain\nHello world');
    expect(normalized.documents[0]?.json).toEqual({ title: 'Example Domain' });
    expect(normalized.robotsBlocked).toEqual(['https://example.com/private']);
    expect(normalized.errors).toHaveLength(1);
    expect(normalized.errors[0]?.url).toBe('https://example.com/broken');
  });

  it('executes startCloudflareCrawl, getCloudflareCrawlStatus, and cancelCloudflareCrawl via REST API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const u = String(input);
      const method = init?.method ?? 'GET';
      if (u.endsWith('/browser-rendering/crawl') && method === 'POST') {
        return new Response(
          JSON.stringify({ success: true, result: { id: 'cf_job_99', status: 'running' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (u.includes('/browser-rendering/crawl/cf_job_99') && method === 'GET') {
        return new Response(
          JSON.stringify({
            success: true,
            result: {
              id: 'cf_job_99',
              status: 'completed',
              total: 1,
              finished: 1,
              records: [
                {
                  url: 'https://example.com/',
                  status: 'completed',
                  markdown: '# Example',
                  metadata: { title: 'Example', status: 200 },
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (u.includes('/browser-rendering/crawl/cf_job_99') && method === 'DELETE') {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const env = { CF_ACCOUNT_ID: 'acc_123', CF_BROWSER_TOKEN: 'tok_456' };
    const started = await startCloudflareCrawl({ url: 'https://example.com', limit: 5 }, env);
    expect(started.cfJobId).toBe('cf_job_99');

    const status = await getCloudflareCrawlStatus('cf_job_99', env);
    expect(status.status).toBe('completed');
    expect(status.documents).toHaveLength(1);
    expect(status.documents[0]?.markdown).toBe('# Example');

    const cancelled = await cancelCloudflareCrawl('cf_job_99', env);
    expect(cancelled).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('derives crawl parameters from natural-language prompt', async () => {
    const preview = await deriveCrawlParamsFromPrompt(
      'https://docs.firecrawl.dev',
      'Extract all blog posts and documentation, exclude admin, include subdomains, depth 2',
      {},
    );
    expect(preview.includePaths).toEqual(['/blog.*', '/docs.*']);
    expect(preview.excludePaths).toEqual(['/admin.*', '/login.*']);
    expect(preview.allowSubdomains).toBe(true);
    expect(preview.maxDiscoveryDepth).toBe(2);
  });

  it('extracts images, attributes, and branding from HTML', () => {
    const html = `<!doctype html>
      <html>
        <head>
          <title>Firecrawl Docs</title>
          <meta property="og:site_name" content="Firecrawl" />
          <meta property="og:image" content="https://firecrawl.dev/og-banner.png" />
          <meta name="theme-color" content="#FF8A3D" />
          <link rel="icon" href="/favicon.ico" />
        </head>
        <body>
          <img class="brand-logo" src="/assets/firecrawl-logo.svg" alt="Firecrawl Logo" />
          <img src="https://cdn.firecrawl.dev/hero.webp" srcset="/img/small.png 1x, /img/large.png 2x" />
          <a href="/docs" data-track="nav-docs">Docs</a>
        </body>
      </html>`;
    const root = parseHtml(html);
    const images = extractImages(root, 'https://firecrawl.dev');
    expect(images).toContain('https://firecrawl.dev/assets/firecrawl-logo.svg');
    expect(images).toContain('https://cdn.firecrawl.dev/hero.webp');
    expect(images).toContain('https://firecrawl.dev/img/small.png');
    expect(images).toContain('https://firecrawl.dev/img/large.png');
    expect(images).toContain('https://firecrawl.dev/og-banner.png');
    expect(images).toContain('https://firecrawl.dev/favicon.ico');

    const attrs = extractAttributes(root, [{ selector: 'a', attribute: 'data-track' }]);
    expect(attrs).toEqual([{ selector: 'a', attribute: 'data-track', values: ['nav-docs'] }]);

    const branding = extractBranding(root, 'https://firecrawl.dev', {
      title: 'Firecrawl Docs',
      ogSiteName: 'Firecrawl',
      favicon: 'https://firecrawl.dev/favicon.ico',
    });
    expect(branding.brandName).toBe('Firecrawl');
    expect(branding.logo).toBe('https://firecrawl.dev/assets/firecrawl-logo.svg');
  });
});
