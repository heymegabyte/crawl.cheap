import { describe, it, expect } from 'vitest';
import { ScrapeRequestSchema, ScrapeResponseSchema, DocumentSchema } from '../src';

/**
 * Regression tests for the v2 OpenAPI delta pinned 2026-10-27
 * (sha256 49afc368…, upstream adds the `attributes` format + parser-object changes).
 * Each case mirrors a documented upstream request/response shape.
 */
describe('v2 2026-10-27 delta: attributes format', () => {
  it('accepts the attributes object descriptor with required selectors', () => {
    const parsed = ScrapeRequestSchema.parse({
      url: 'https://example.com',
      formats: [
        { type: 'attributes', selectors: [{ selector: 'a.cta', attribute: 'href' }] },
        'markdown',
      ],
    });
    expect(parsed.formats).toHaveLength(2);
    expect(parsed.formats?.[0]).toEqual({
      type: 'attributes',
      selectors: [{ selector: 'a.cta', attribute: 'href' }],
    });
  });

  it('rejects an attributes descriptor with no selectors (required upstream)', () => {
    const r = ScrapeRequestSchema.safeParse({
      url: 'https://example.com',
      formats: [{ type: 'attributes' }],
    });
    expect(r.success).toBe(false);
  });

  it('returns attributes rows on the document', () => {
    const doc = DocumentSchema.parse({
      metadata: { statusCode: 200 },
      attributes: [{ selector: 'a.cta', attribute: 'href', values: ['/pricing', '/docs'] }],
    });
    expect(doc.attributes?.[0].values).toEqual(['/pricing', '/docs']);
  });

  it('accepts the upstream response shape for attributes (data.attributes array)', () => {
    const res = ScrapeResponseSchema.parse({
      success: true,
      data: {
        metadata: { statusCode: 200 },
        attributes: [{ selector: 'img', attribute: 'alt', values: ['Logo'] }],
      },
    });
    expect(res.data.attributes).toHaveLength(1);
  });
});

describe('v2 2026-10-27 delta: parsers + nullability wrap-up', () => {
  it('accepts parser name shorthands and full parser objects', () => {
    const base = { url: 'https://example.com' };
    for (const parsers of [
      ['pdf'],
      ['image'],
      [{ type: 'pdf' }],
      [{ type: 'pdf', mode: 'ocr', maxPages: 5, pages: true, blocks: true, pageMarkers: true }],
      [{ type: 'image' }],
    ]) {
      const r = ScrapeRequestSchema.safeParse({ ...base, parsers });
      expect(r.success, JSON.stringify(parsers)).toBe(true);
    }
  });

  it('accepts waitFor up to the documented 60000ms maximum', () => {
    expect(ScrapeRequestSchema.safeParse({ url: 'https://e.com', waitFor: 60000 }).success).toBe(
      true,
    );
    expect(ScrapeRequestSchema.safeParse({ url: 'https://e.com', waitFor: 60001 }).success).toBe(
      false,
    );
  });

  it('accepts metadata.language as string, string array, or null', () => {
    for (const language of ['en', ['en', 'de'], null]) {
      const r = DocumentSchema.safeParse({ metadata: { statusCode: 200, language } });
      expect(r.success, JSON.stringify(language)).toBe(true);
    }
  });
});
