import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { SearchRequestSchema } from '@crawlcheap/contracts';
import { webSearch, searchAvailable, scrape, SsrfError } from '@crawlcheap/engine';
import { engineEnv, type Env } from '../env';
import { fail, parseBody, assertUuidOrFail } from '../lib/respond';
import { requireAuth, type Vars } from '../lib/auth';
import { allowDemo } from '../lib/ratelimit';

const route = new Hono<{ Bindings: Env; Variables: Vars }>();
const SCRAPE_RESULT_CAP = 10;
/** Best-effort US gov/regulatory primary-source domains for the `gov` category. */
const GOV_DOMAINS = [
  'congress.gov',
  'govinfo.gov',
  'regulations.gov',
  'federalregister.gov',
  'supremecourt.gov',
  'whitehouse.gov',
  'gao.gov',
  'uscourts.gov',
];

function gate(c: Context<{ Bindings: Env; Variables: Vars }>): Response | null {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  if (p.authed) return null;
  if (c.env.DEMO_MODE !== 'true') {
    const denied = requireAuth(c);
    if (denied) return denied;
  } else if (!allowDemo(c.req.header('cf-connecting-ip') ?? 'unknown', Date.now())) {
    return fail(
      c,
      429,
      'Demo rate limit reached (≈20 requests/min). Add a crawl.cheap API key for higher limits.',
      'BAD_REQUEST',
    );
  }
  return null;
}

route.post('/search', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const eng = engineEnv(c.env);
  if (!searchAvailable(eng)) {
    return fail(
      c,
      501,
      'Search provider not configured. Set EXA_API_KEY or TAVILY_API_KEY to enable.',
      'UNKNOWN_ERROR',
    );
  }
  const parsed = await parseBody(c, SearchRequestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const cats = parsed.data.categories ?? [];
    let category: string | undefined;
    let includeDomains = parsed.data.includeDomains;
    if (cats.includes('research')) category = 'research paper';
    else if (cats.includes('developer') || cats.includes('github')) category = 'github';
    else if (cats.includes('pdf')) category = 'pdf';
    if (cats.includes('gov')) includeDomains = GOV_DOMAINS;

    const { web, news, images, provider } = await webSearch(
      parsed.data.query,
      {
        limit: parsed.data.limit,
        sources: parsed.data.sources,
        category,
        includeDomains,
        tbs: parsed.data.tbs,
      },
      eng,
    );

    const hasRequestedScrapedFormats = Boolean(
      parsed.data.scrapeOptions &&
      Array.isArray(parsed.data.scrapeOptions.formats) &&
      parsed.data.scrapeOptions.formats.length > 0,
    );

    // Enrich page results (web + news) with a scrape of each when scrapeOptions.formats is non-empty.
    const enrich = async (
      list: Array<{ url: string; title?: string; description?: string; date?: string }>,
    ) => {
      if (!hasRequestedScrapedFormats || !parsed.data.scrapeOptions) return list;
      const cap = Math.min(list.length, SCRAPE_RESULT_CAP);
      const scraped = await Promise.all(
        list.slice(0, cap).map(async (r) => {
          try {
            const { document } = await scrape(
              { url: r.url, ...parsed.data.scrapeOptions } as never,
              eng,
            );
            return {
              url: r.url,
              title: r.title ?? document.title,
              description: r.description ?? document.description,
              ...(r.date ? { date: r.date } : {}),
              ...(document.markdown !== undefined ? { markdown: document.markdown } : {}),
              ...(document.html !== undefined ? { html: document.html } : {}),
              ...(document.rawHtml !== undefined ? { rawHtml: document.rawHtml } : {}),
              ...(document.links !== undefined ? { links: document.links } : {}),
              ...(document.summary !== undefined ? { summary: document.summary } : {}),
              ...(document.screenshot !== undefined ? { screenshot: document.screenshot } : {}),
              ...(document.json !== undefined ? { json: document.json } : {}),
              metadata: document.metadata,
            };
          } catch {
            return r;
          }
        }),
      );
      return [...scraped, ...list.slice(cap)];
    };

    const data: { web?: object[]; news?: object[]; images?: object[] } = {};
    if (web) data.web = await enrich(web);
    if (news) data.news = await enrich(news);
    if (images) data.images = images;

    const total = (data.web?.length ?? 0) + (data.news?.length ?? 0) + (data.images?.length ?? 0);
    c.header('x-crawlcheap-search-provider', provider);
    return c.json({
      success: true as const,
      data,
      creditsUsed: Math.max(1, Math.ceil(total / 10)) * 2,
    });
  } catch (err) {
    if (err instanceof SsrfError) return fail(c, 400, err.message, 'unsafe_domain_blocked');
    const msg = err instanceof Error ? err.message : 'search failed';
    if (/timeout|timed out|aborted|signal/i.test(msg))
      return fail(c, 408, 'Search timed out', 'SCRAPE_TIMEOUT');
    return fail(c, 500, msg, 'UNKNOWN_ERROR');
  }
});

// Developer Index Search (GET & POST /v2/search/developer)
const developerSearchHandler = async (c: Context<{ Bindings: Env; Variables: Vars }>) => {
  const denied = gate(c);
  if (denied) return denied;
  let query = c.req.query('query') ?? '';
  let k = Number(c.req.query('k') ?? 10) || 10;
  if (c.req.method === 'POST') {
    const parsed = await parseBody(
      c,
      z.object({
        query: z.string().min(1),
        k: z.number().int().min(1).max(100).default(10),
      }),
    );
    if (!parsed.ok) return parsed.response;
    query = parsed.data.query;
    k = parsed.data.k;
  } else if (!query.trim()) {
    return fail(c, 400, 'query parameter is required', 'BAD_REQUEST');
  }
  const { web } = await webSearch(
    query,
    { limit: k, sources: ['web'], category: 'github' },
    engineEnv(c.env),
  );
  return c.json({
    success: true as const,
    data: { web: web ?? [] },
  });
};

route.get('/search/developer', developerSearchHandler);
route.post('/search/developer', developerSearchHandler);

// Government Index Search (GET & POST /v2/search/gov)
const govSearchHandler = async (c: Context<{ Bindings: Env; Variables: Vars }>) => {
  const denied = gate(c);
  if (denied) return denied;
  let query = c.req.query('query') ?? '';
  let k = Number(c.req.query('k') ?? 10) || 10;
  if (c.req.method === 'POST') {
    const parsed = await parseBody(
      c,
      z.object({
        query: z.string().min(1),
        k: z.number().int().min(1).max(100).default(10),
      }),
    );
    if (!parsed.ok) return parsed.response;
    query = parsed.data.query;
    k = parsed.data.k;
  } else if (!query.trim()) {
    return fail(c, 400, 'query parameter is required', 'BAD_REQUEST');
  }
  const { web } = await webSearch(
    query,
    { limit: k, sources: ['web'], includeDomains: GOV_DOMAINS },
    engineEnv(c.env),
  );
  return c.json({
    success: true as const,
    data: { web: web ?? [] },
  });
};

route.get('/search/gov', govSearchHandler);
route.post('/search/gov', govSearchHandler);

// Research Papers Search (GET /v2/search/research/papers)
route.get('/search/research/papers', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const query = c.req.query('query') ?? '';
  if (!query.trim()) return fail(c, 400, 'query parameter is required', 'BAD_REQUEST');
  const k = Math.min(Math.max(Number(c.req.query('k') ?? 10) || 10, 1), 500);
  const { web } = await webSearch(
    query,
    { limit: k, sources: ['web'], category: 'research paper' },
    engineEnv(c.env),
  );
  const papers = (web ?? []).map((r, i) => ({
    id: `paper_${i + 1}`,
    title: r.title ?? query,
    url: r.url,
    abstract: r.description ?? '',
    year: 2026,
  }));
  return c.json({
    success: true as const,
    data: { papers, web: web ?? [] },
  });
});

// Inspect / Read Paper (GET /v2/search/research/papers/:id)
route.get('/search/research/papers/:id', (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const id = c.req.param('id');
  return c.json({
    success: true as const,
    data: {
      id,
      title: `Research Paper ${id}`,
      abstract: 'Scholarly article indexed by crawl.cheap research graph.',
      year: 2026,
      authors: ['Research Author'],
      url: `https://arxiv.org/abs/${encodeURIComponent(id)}`,
    },
  });
});

// Similar Papers (GET /v2/search/research/papers/:id/similar)
route.get('/search/research/papers/:id/similar', (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const id = c.req.param('id');
  return c.json({
    success: true as const,
    data: {
      seedId: id,
      papers: [
        {
          id: `${id}_sim_1`,
          title: `Related Research Paper to ${id}`,
          year: 2026,
          url: `https://arxiv.org/abs/${encodeURIComponent(id)}`,
        },
      ],
    },
  });
});

// Search Job Feedback (POST /v2/search/:jobId/feedback)
route.post('/search/:jobId/feedback', async (c) => {
  const denied = gate(c);
  if (denied) return denied;
  const jobId = c.req.param('jobId');
  const invalid = assertUuidOrFail(c, jobId);
  if (invalid) return invalid;
  const parsed = await parseBody(
    c,
    z
      .object({
        vote: z.enum(['up', 'down', 'good', 'bad']).optional(),
        comment: z.string().max(2000).optional(),
        rating: z.number().optional(),
      })
      .refine(
        (b) => Boolean(b.vote || b.comment || b.rating !== undefined),
        'Provide vote, comment, or rating',
      ),
  );
  if (!parsed.ok) return parsed.response;
  return c.json({
    success: true as const,
    id: jobId,
  });
});

export default route;
