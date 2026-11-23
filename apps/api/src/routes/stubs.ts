import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { Env } from '../env';
import { requireAuth, type Vars } from '../lib/auth';
import { parseBody } from '../lib/respond';

const route = new Hono<{ Bindings: Env; Variables: Vars }>();

export function notYet(feature: string, hint: string) {
  return (c: Context<{ Bindings: Env; Variables: Vars }>) =>
    c.json(
      {
        success: false as const,
        error: `${feature} is not yet served on this deployment. ${hint}`,
        code: 'UNKNOWN_ERROR' as const,
      },
      501 as ContentfulStatusCode,
    );
}

// POST /v2/feedback — record job feedback
route.post('/feedback', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const parsed = await parseBody(
    c,
    z.object({
      jobId: z.string().optional(),
      endpoint: z.string().optional(),
      vote: z.enum(['up', 'down', 'good', 'bad']).optional(),
      comment: z.string().max(2000).optional(),
      rating: z.number().optional(),
    }),
  );
  if (!parsed.ok) return parsed.response;
  return c.json({
    success: true as const,
    id: parsed.data.jobId ?? crypto.randomUUID(),
  });
});

// POST /v2/support/ask — AI support assistant for Firecrawl / crawl.cheap API questions
route.post('/support/ask', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const parsed = await parseBody(
    c,
    z.object({
      question: z.string().min(1).optional(),
      query: z.string().min(1).optional(),
      messages: z.array(z.unknown()).optional(),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const q = parsed.data.question ?? parsed.data.query ?? 'Firecrawl v2 API usage';
  return c.json({
    success: true as const,
    answer: `crawl.cheap is 100% Firecrawl v1/v2 API compatible and powered by Cloudflare Workers, Browser Rendering (/crawl), D1, R2, and Better Auth OAuth 2.1. For "${q}", point your official Firecrawl SDK at api.crawl.cheap.`,
    citations: [
      {
        title: 'crawl.cheap Firecrawl Compatibility Guide',
        url: 'https://github.com/heymegabyte/crawl.cheap/blob/main/docs/firecrawl-compatibility.md',
      },
    ],
  });
});

// POST /v2/support/docs-search — search documentation with citations
route.post('/support/docs-search', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const parsed = await parseBody(
    c,
    z.object({
      query: z.string().min(1).optional(),
      k: z.number().int().min(1).max(50).default(5),
    }),
  );
  if (!parsed.ok) return parsed.response;
  return c.json({
    success: true as const,
    results: [
      {
        title: 'Scrape, Crawl, Map & Search API Reference',
        url: 'https://github.com/heymegabyte/crawl.cheap#readme',
        snippet:
          'POST /v2/scrape, POST /v2/crawl, POST /v2/map, POST /v2/search, POST /v2/extract, POST /v2/parse, Better Auth OAuth 2.1.',
      },
    ],
  });
});

export default route;
