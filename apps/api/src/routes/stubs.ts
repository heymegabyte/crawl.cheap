import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { extractAvailable, extractWithAI, getLangfuseSafeClient } from '@crawlcheap/engine';
import { engineEnv, type Env } from '../env';
import { requireAuth, type Vars } from '../lib/auth';
import { parseBody } from '../lib/respond';
import { saveJobFeedback, searchJobFeedback } from '../lib/durable-state';

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

/** Indexed Documentation Corpus for RAG `/v2/support/docs-search` & `/v2/support/ask`. */
export const DOCS_CORPUS = [
  {
    id: 'scrape-v2',
    title: 'POST /v2/scrape & /v1/scrape — Single-URL Extraction & Formats',
    url: 'https://github.com/heymegabyte/crawl.cheap/blob/main/docs/firecrawl-compatibility.md#rest-api-coverage',
    tags: [
      'scrape',
      'markdown',
      'html',
      'rawhtml',
      'json',
      'screenshot',
      'branding',
      'attributes',
      'question',
      'highlights',
      'actions',
      'changetracking',
    ],
    snippet:
      'Scrape any URL into markdown, html, rawHtml, links, images, summary, branding, attributes, question, highlights, screenshot@fullPage, or structured JSON ({type:"json", prompt, schema}). Supports Cloudflare "Markdown for Agents" (Accept: text/markdown), PDF parsing (parsePDF: true/false), R2 maxAge cache, and Puppeteer browser actions.',
  },
  {
    id: 'crawl-v2',
    title: 'POST /v2/crawl & /v1/crawl — Cloudflare /crawl, Durable Objects & WebSocket Watcher',
    url: 'https://github.com/heymegabyte/crawl.cheap/blob/main/docs/COMPATIBILITY_MATRIX.md',
    tags: [
      'crawl',
      'websocket',
      'watcher',
      'webhook',
      'params-preview',
      'includepaths',
      'excludepaths',
      'idempotency',
    ],
    snippet:
      'Asynchronous multi-page crawling powered by Cloudflare Browser Rendering /crawl REST API and CrawlCoordinator Durable Objects. Supports natural-language prompt parameter preview (POST /v2/crawl/params-preview), Hibernatable WebSocket watcher (Upgrade: websocket emitting catchup/document/done), x-idempotency-key deduplication, and signed lifecycle webhooks (crawl.started, crawl.page, crawl.completed, crawl.failed).',
  },
  {
    id: 'map-search',
    title: 'POST /v2/map & POST /v2/search — Site Discovery & Multi-Source Web/News/Image Search',
    url: 'https://github.com/heymegabyte/crawl.cheap/blob/main/docs/product-surface-inventory.md',
    tags: ['map', 'sitemap', 'search', 'web', 'news', 'images', 'exa', 'tavily', 'tbs'],
    snippet:
      '/v2/map discovers site URLs via sitemaps and link extraction (returning Link objects in v2 and string[] in v1). /v2/search queries web, news, and images with tbs time filters, categories (github, research, pdf, developer, gov), and optional scrapeOptions enrichment.',
  },
  {
    id: 'parse-multi',
    title: 'POST /v2/parse & /v2/parse/formats — 10-Format Document Parsing & R2 Uploads',
    url: 'https://github.com/heymegabyte/crawl.cheap/blob/main/docs/firecrawl-compatibility.md',
    tags: [
      'parse',
      'pdf',
      'docx',
      'xlsx',
      'pptx',
      'odt',
      'ods',
      'csv',
      'rtf',
      'image',
      'upload',
      'tomarkdown',
    ],
    snippet:
      'Convert PDF, DOCX, XLSX, PPTX, ODT, ODS, CSV, RTF, HTML, TXT, and images to clean Markdown using Cloudflare Workers AI env.AI.toMarkdown() and unpdf. Supports multipart uploads, presigned R2 uploads (POST /v2/parse/upload-url + PUT /v2/parse/upload/:id), or direct URLs.',
  },
  {
    id: 'better-auth-oauth21',
    title: 'Better Auth & OAuth 2.1 Cloudflare-Native Authorization Server',
    url: 'https://github.com/heymegabyte/crawl.cheap#readme',
    tags: [
      'oauth',
      'better-auth',
      'pkce',
      's256',
      'dcr',
      'register',
      'authorize',
      'token',
      'revoke',
      'introspect',
      'api-key',
      'fc-',
      'cc_live_',
    ],
    snippet:
      'Full OAuth 2.1 Authorization Server (RFC 9728 Protected Resource Metadata, RFC 8414 AS Metadata, RFC 7591 Dynamic Client Registration /register, RFC 7636 PKCE S256 /authorize & /token, refresh token rotation, /revoke, /introspect) and Better Auth email/password + GitHub OAuth + organization tenant guard + fc- and cc_live_ API keys.',
  },
  {
    id: 'browser-copilot',
    title: 'POST /v2/browser & /v2/interact — Persistent Browser Sessions & AI Co-Pilot',
    url: 'https://github.com/heymegabyte/crawl.cheap#readme',
    tags: [
      'browser',
      'interact',
      'copilot',
      'puppeteer',
      'session',
      'execute',
      'actions',
      'liveview',
    ],
    snippet:
      'Launch persistent Cloudflare Browser Rendering tabs backed by BrowserSession Durable Objects. Drive sessions via explicit DOM actions, JavaScript code execution (/v2/interact/:id/execute), or plain-English AI Co-Pilot prompts (POST /v2/interact/:id with { prompt }).',
  },
  {
    id: 'agent-deep-research',
    title: 'POST /v2/agent, /v1/deep-research & /v1/llmstxt — Autonomous Multi-Turn Research',
    url: 'https://github.com/heymegabyte/crawl.cheap/blob/main/docs/product-surface-inventory.md',
    tags: ['agent', 'deep-research', 'llmstxt', 'trace', 'snapshots', 'thread', 'citations'],
    snippet:
      'Multi-turn autonomous web research agent with D1-persisted threadId/threadTurn context, step-by-step execution traces (/v2/agent/:id/trace), output snapshots (/v2/agent/:id/snapshots/:snapshotId), and automatic llms.txt + llms-full.txt generation.',
  },
  {
    id: 'mcp-30-tools',
    title: 'Remote MCP Server (https://mcp.crawl.cheap) — All 30 Firecrawl Tools',
    url: 'https://github.com/heymegabyte/crawl.cheap/blob/main/docs/product-surface-inventory.md#mcp-surface',
    tags: [
      'mcp',
      'tools',
      'claude',
      'cursor',
      'profile',
      'search',
      'keyless',
      'monitor',
      'semantic-scholar',
    ],
    snippet:
      'Stateless Streamable-HTTP MCP server serving all 30 pinned firecrawl_* tools across three profiles: /v2/mcp (full 30 registered / 28 listable), /v2/mcp-search (9-tool search profile), and /v2/mcp-keyless (3-tool keyless profile) with RFC 9728 OAuth 2.1 discovery.',
  },
  {
    id: 'pricing-billing',
    title: 'GET /v2/pricing, POST /v2/quote & Team Credit/Token Ledgers',
    url: 'https://github.com/heymegabyte/crawl.cheap/blob/main/docs/unit-economics.md',
    tags: ['pricing', 'quote', 'credits', 'tokens', 'spend-limit', 'threat-protection', 'ledger'],
    snippet:
      'Exactly 50% of Firecrawl month-to-month plan prices ($9.50 Hobby, $49.50 Standard, $199.50 Growth, $374.50 Scale) with real-time D1 credit and Workers AI token ledgers, user-configurable hard spend ceilings (402), and enforced team threat-protection policies.',
  },
] as const;

export function rankDocsCorpus(query: string, k = 5) {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length >= 2);
  const scored = DOCS_CORPUS.map((doc) => {
    const hay = `${doc.title} ${doc.snippet} ${doc.tags.join(' ')}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (doc.tags.some((tag) => tag.includes(t))) score += 3;
      if (doc.title.toLowerCase().includes(t)) score += 2;
      if (hay.includes(t)) score += 1;
    }
    return { doc, score: score || 1 };
  }).sort((a, b) => b.score - a.score);

  return scored.slice(0, k).map(({ doc, score }) => ({
    id: doc.id,
    title: doc.title,
    url: doc.url,
    snippet: doc.snippet,
    score,
  }));
}

// POST /v2/feedback — record job feedback in D1 (`job_feedback`)
route.post('/feedback', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const parsed = await parseBody(
    c,
    z
      .object({
        jobId: z.string().optional(),
        endpoint: z.string().optional(),
        vote: z.enum(['up', 'down', 'good', 'bad']).optional(),
        comment: z.string().max(2000).optional(),
        rating: z.number().optional(),
      })
      .refine(
        (b) => Boolean(b.jobId || b.endpoint || b.vote || b.comment || b.rating !== undefined),
        'Provide at least one feedback field (jobId, vote, rating, or comment)',
      ),
  );
  if (!parsed.ok) return parsed.response;
  const id = crypto.randomUUID();
  await saveJobFeedback(c.env.DB, {
    id,
    jobId: parsed.data.jobId,
    teamId: p.teamId ?? p.keyId ?? 'default',
    keyId: p.keyId,
    endpoint: parsed.data.endpoint,
    vote: parsed.data.vote,
    rating: parsed.data.rating,
    comment: parsed.data.comment,
    createdAt: new Date().toISOString(),
  });
  return c.json({
    success: true as const,
    id,
    jobId: parsed.data.jobId ?? id,
  });
});

// GET /v2/feedback — search or list prior feedback entries from D1
route.get('/feedback', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const q = c.req.query('query') ?? '';
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 20) || 20));
  const results = await searchJobFeedback(c.env.DB, p.teamId ?? p.keyId ?? 'default', q, limit);
  return c.json({
    success: true as const,
    feedback: results,
  });
});

// POST /v2/support/ask — RAG-backed AI support assistant for Firecrawl / crawl.cheap API questions
route.post('/support/ask', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const parsed = await parseBody(
    c,
    z
      .object({
        question: z.string().min(1).optional(),
        query: z.string().min(1).optional(),
        messages: z.array(z.unknown()).min(1).optional(),
      })
      .refine(
        (b) => Boolean(b.question || b.query || (b.messages && b.messages.length > 0)),
        'Provide question, query, or messages',
      ),
  );
  if (!parsed.ok) return parsed.response;
  const q = parsed.data.question ?? parsed.data.query ?? 'Firecrawl v2 API usage';
  const topDocs = rankDocsCorpus(q, 3);
  const contextText = topDocs
    .map((d) => `### ${d.title}\n${d.snippet}\nURL: ${d.url}`)
    .join('\n\n');

  let answer = '';
  const eng = engineEnv(c.env);
  if (extractAvailable(eng)) {
    try {
      const ai = (await extractWithAI(
        `Documentation Context:\n${contextText}\n\nUser Question: ${q}`,
        {
          prompt:
            'Answer the developer question clearly and accurately using the crawl.cheap / Firecrawl documentation context.',
          schema: {
            type: 'object',
            properties: { answer: { type: 'string' } },
            required: ['answer'],
          },
        },
        eng,
      )) as { answer?: string } | null;
      if (ai?.answer) answer = ai.answer.trim();
    } catch {
      /* fallback below */
    }
  }

  if (!answer) {
    answer = `Based on crawl.cheap's Firecrawl-compatible documentation for "${q}": ${topDocs[0]?.snippet ?? ''} Point any Firecrawl v1/v2 SDK or MCP client at https://api.crawl.cheap with a cc_live_ or fc- API key or OAuth 2.1 Bearer token.`;
  }

  const lf = getLangfuseSafeClient({
    publicKey: c.env.LANGFUSE_PUBLIC_KEY,
    secretKey: c.env.LANGFUSE_SECRET_KEY,
    baseUrl: c.env.LANGFUSE_HOST ?? c.env.LANGFUSE_BASEURL,
    serviceName: 'crawl-cheap-api',
    environment: c.env.SENTRY_ENVIRONMENT ?? 'production',
  });
  void lf.traceSafe({
    name: 'support.rag_ask',
    model: '@cf/meta/llama-3.1-8b-instruct',
    input: { question: q, citationIds: topDocs.map((d) => d.id) },
    output: { answerLength: answer.length },
  });

  return c.json({
    success: true as const,
    answer,
    citations: topDocs.map((d) => ({
      id: d.id,
      title: d.title,
      url: d.url,
      snippet: d.snippet,
    })),
  });
});

// POST /v2/support/docs-search — search indexed documentation corpus with relevance scores & citations
route.post('/support/docs-search', async (c) => {
  const p = c.get('principal');
  if (p.invalidCredentials) return requireAuth(c)!;
  const parsed = await parseBody(
    c,
    z.object({
      query: z.string().min(1),
      k: z.number().int().min(1).max(50).default(5),
    }),
  );
  if (!parsed.ok) return parsed.response;
  const results = rankDocsCorpus(parsed.data.query, parsed.data.k);
  return c.json({
    success: true as const,
    results,
  });
});

export default route;
