import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrape } from '../src/scrape';
import { safeFetch } from '../src/fetcher';

afterEach(() => vi.unstubAllGlobals());
describe('TLS option transport characterization (not certificate verification)', () => {
  for (const option of [undefined, false]) {
    it(`HTTP scrape option ${option} uses standard fetch with manual redirects`, async () => {
      const transport = vi
        .fn()
        .mockResolvedValue(
          new Response(
            '<html><body><p>Some content for a deterministic transport boundary test.</p></body></html>',
            { headers: { 'content-type': 'text/html' } },
          ),
        );
      vi.stubGlobal('fetch', transport);
      await scrape(
        {
          url: 'https://example.com',
          ...(option === undefined ? {} : { skipTlsVerification: option }),
        },
        {},
      );
      const init = transport.mock.calls[0][1];
      expect(init.redirect).toBe('manual');
      expect(Object.keys(init).sort()).toEqual(['headers', 'method', 'redirect', 'signal']);
    });
    it(`browser option ${option} sends no certificate bypass instruction`, async () => {
      const quickAction = vi
        .fn()
        .mockResolvedValue(Response.json({ success: true, result: 'Rendered content' }));
      await scrape(
        {
          url: 'https://example.com',
          waitFor: 1,
          ...(option === undefined ? {} : { skipTlsVerification: option }),
        },
        { BROWSER: { quickAction } },
      );
      expect(quickAction).toHaveBeenCalled();
      for (const call of quickAction.mock.calls)
        expect(call[1]).toEqual({ url: 'https://example.com/' });
    });
  }
  it('preserves redirect SSRF rejection before fetching the private target', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }),
      );
    vi.stubGlobal('fetch', transport);
    await expect(safeFetch('https://example.com')).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
