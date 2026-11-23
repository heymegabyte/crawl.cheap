import { scrape, mapSite, SsrfError } from '@crawlcheap/engine';
import { engineEnv, DEFAULT_API_BASE, type Env } from './env';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const CRAWL_TEXT_CAP = 12_000;

/** Call the REST API via the service binding (preferred) or public fetch (self-host
 *  fallback). Forwards the caller's Authorization header so authed tools hit the
 *  user's key + credit ledger. */
async function apiFetch(
  env: Env,
  path: string,
  init: RequestInit = {},
  auth?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (auth) headers.authorization = auth;
  const url = env.API
    ? `https://crawl-cheap-api.internal${path}`
    : `${env.API_BASE || DEFAULT_API_BASE}${path}`;
  const req = new Request(url, { ...init, headers });
  return env.API ? env.API.fetch(req) : fetch(req);
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Fetch from the Semantic Scholar graph API (free, no key — authorized research index).
 *  Retries on 429 (S2 rate-limits unauthenticated traffic to ~1 req/s). */
async function s2Fetch(url: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'crawlcheapbot/0.1 (+https://crawl.cheap/bot)',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429) {
      await sleepMs(1200 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`Semantic Scholar ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }
  throw new Error('Semantic Scholar rate limit (429) after retries');
}
const S2 = 'https://api.semanticscholar.org/graph/v1';

/** Start an agent job, poll to a terminal state, return the synthesized result. */
async function proxyAgent(
  env: Env,
  args: Record<string, unknown>,
  auth?: string,
): Promise<McpContent> {
  const res = await apiFetch(
    env,
    '/v2/agent',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) },
    auth,
  );
  const start = (await res.json()) as {
    id?: string;
    threadId?: string;
    threadTurn?: number;
    error?: string;
  };
  if (!res.ok || !start.id)
    return [{ type: 'text', text: `Agent failed: ${start.error ?? res.status}` }];
  let last: Record<string, unknown> = {};
  for (let i = 0; i < 20; i += 1) {
    const s = await apiFetch(env, `/v2/agent/${start.id}`, {}, auth);
    last = (await s.json()) as Record<string, unknown>;
    if (typeof last.status === 'string' && last.status !== 'processing') break;
    await sleepMs(500);
  }
  return [
    {
      type: 'text',
      text: JSON.stringify(
        {
          id: start.id,
          threadId: start.threadId,
          threadTurn: start.threadTurn,
          status: last.status,
          data: last.data,
          sources: last.sources,
        },
        null,
        2,
      ),
    },
  ];
}

/** Proxy a REST API action and return formatted JSON text. */
async function proxyRestJson(
  env: Env,
  method: string,
  path: string,
  body: unknown,
  auth?: string,
): Promise<McpContent> {
  const res = await apiFetch(
    env,
    path,
    body
      ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { method },
    auth,
  );
  const json = await res.json().catch(() => ({ status: res.status }));
  if (res.status === 401) {
    return [
      {
        type: 'text',
        text: 'Authentication required. Send Authorization: Bearer cc_live_… (or fc-… / OAuth 2.1 ccat_…) to this MCP server.',
      },
    ];
  }
  return [{ type: 'text', text: JSON.stringify(json, null, 2) }];
}

/** Category-scoped search via /v2/search (Exa category/domain scoping under the hood). */
async function proxySearch(
  env: Env,
  query: string,
  categories: string[],
  k: number,
  auth?: string,
): Promise<McpContent> {
  const res = await apiFetch(
    env,
    '/v2/search',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, limit: k, categories }),
    },
    auth,
  );
  const body = (await res.json()) as {
    success?: boolean;
    error?: string;
    data?: { web?: Array<Record<string, unknown>> };
  };
  if (!res.ok || body.success === false)
    return [{ type: 'text', text: `Search failed: ${body.error ?? res.status}` }];
  const web = body.data?.web ?? [];
  const text = web
    .map(
      (r, i) =>
        `${i + 1}. ${(r.title as string) ?? ''}\n${(r.url as string) ?? ''}\n${(r.description as string) ?? ''}`,
    )
    .join('\n\n');
  return [{ type: 'text', text: text || 'No results.' }];
}

export class NotImplemented extends Error {}

export type McpContent = Array<{ type: 'text'; text: string }>;
export type ToolProfile = 'full' | 'search' | 'keyless';

export interface McpTool {
  name: string;
  description: string;
  profiles: ToolProfile[];
  deprecated?: boolean;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, env: Env, auth?: string) => Promise<McpContent>;
}

const scrapeSchema = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'The URL to scrape.' },
    formats: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'markdown',
          'html',
          'rawHtml',
          'links',
          'images',
          'summary',
          'branding',
          'screenshot',
        ],
      },
      description: 'Output formats (default ["markdown"]).',
    },
    onlyMainContent: {
      type: 'boolean',
      description: 'Strip nav/footer/boilerplate (default true).',
    },
    includeTags: { type: 'array', items: { type: 'string' } },
    excludeTags: { type: 'array', items: { type: 'string' } },
    waitFor: { type: 'number' },
    maxAge: { type: 'number' },
  },
  required: ['url'],
};

/**
 * All 30 pinned `firecrawl_*` MCP tools (`firecrawl-mcp@3.28.2`):
 *   - 28 listable tools + 2 deprecated shims (`firecrawl_extract`, `firecrawl_research_search_github`)
 *   - Profiles:
 *       - `full`: 30 registered / 28 listed
 *       - `search`: 9 search/discovery tools
 *       - `keyless`: 3 keyless tools (`firecrawl_scrape`, `firecrawl_search`, `firecrawl_parse`)
 */
export const TOOLS: McpTool[] = [
  // 1. firecrawl_scrape
  {
    name: 'firecrawl_scrape',
    description:
      'Scrape one URL and return its content as markdown (default), HTML, rawHtml, links, images, branding, or a summary. Cloudflare-native static extraction; escalates to Browser Rendering only when needed.',
    profiles: ['full', 'search', 'keyless'],
    inputSchema: scrapeSchema,
    handler: async (args, env) => {
      const { document, strategy } = await scrape(args as never, engineEnv(env));
      const text =
        document.markdown ??
        (document.json !== undefined ? JSON.stringify(document.json, null, 2) : '') ??
        '';
      const header = `[crawl.cheap scrape · ${strategy} · ${document.metadata.statusCode}] ${document.url ?? ''}`;
      return [{ type: 'text', text: `${header}\n\n${text || JSON.stringify(document, null, 2)}` }];
    },
  },
  // 2. firecrawl_map
  {
    name: 'firecrawl_map',
    description:
      "Enumerate the URLs under a website via sitemaps + homepage link discovery, without fetching each page's content. Optional `search` ranks the results.",
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        search: { type: 'string' },
        sitemap: { type: 'string', enum: ['include', 'only', 'skip'] },
        includeSubdomains: { type: 'boolean' },
        ignoreQueryParameters: { type: 'boolean' },
        limit: { type: 'number' },
      },
      required: ['url'],
    },
    handler: async (args, env) => {
      const links = await mapSite(args as never, engineEnv(env));
      return [
        {
          type: 'text',
          text: `Found ${links.length} URLs:\n${links.map((l) => l.url).join('\n')}`,
        },
      ];
    },
  },
  // 3. firecrawl_search
  {
    name: 'firecrawl_search',
    description:
      'Search the web (web, news, images) and optionally scrape results. Returns ranked results.',
    profiles: ['full', 'search', 'keyless'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
        sources: { type: 'array', items: { type: 'string' } },
        tbs: { type: 'string' },
      },
      required: ['query'],
    },
    handler: async (args, env, auth) => {
      const res = await apiFetch(
        env,
        '/v2/search',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(args),
        },
        auth,
      );
      const body = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: {
          web?: Array<Record<string, unknown>>;
          news?: Array<Record<string, unknown>>;
          images?: Array<Record<string, unknown>>;
        };
      };
      if (!res.ok || body.success === false) {
        return [{ type: 'text', text: `Search failed: ${body.error ?? res.status}` }];
      }
      const section = (label: string, rows?: Array<Record<string, unknown>>) =>
        rows && rows.length
          ? `## ${label}\n` +
            rows
              .map((r, i) =>
                `${i + 1}. ${(r.title as string) ?? ''}\n${(r.url as string) ?? ''}\n${(r.description as string) ?? ''}`.trim(),
              )
              .join('\n\n')
          : '';
      const text = [
        section('Web', body.data?.web),
        section('News', body.data?.news),
        section('Images', body.data?.images),
      ]
        .filter(Boolean)
        .join('\n\n');
      return [{ type: 'text', text: text || 'No results.' }];
    },
  },
  // 4. firecrawl_find_tools
  {
    name: 'firecrawl_find_tools',
    description:
      'Discover which Firecrawl / crawl.cheap tools and data-provider endpoints best fit a given task or query.',
    profiles: ['full', 'search'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Task description or data provider query.' },
        k: { type: 'number', description: 'Max tools to recommend (default 5).' },
      },
      required: ['query'],
    },
    handler: async (args) => {
      const q = String(args.query ?? '').toLowerCase();
      const k = Math.min(28, Math.max(1, Number(args.k ?? 5) || 5));
      const catalog = TOOLS.filter((t) => !t.deprecated && t.name !== 'firecrawl_find_tools').map(
        (t) => {
          const hay = `${t.name} ${t.description}`.toLowerCase();
          const terms = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
          let score = 1;
          for (const term of terms) {
            if (t.name.toLowerCase().includes(term)) score += 4;
            if (hay.includes(term)) score += 2;
          }
          return {
            name: t.name,
            description: t.description,
            profiles: t.profiles,
            requiredArgs: (t.inputSchema.required as string[] | undefined) ?? [],
            score,
          };
        },
      );
      catalog.sort((a, b) => b.score - a.score);
      return [
        {
          type: 'text',
          text: JSON.stringify(
            {
              query: args.query,
              recommendedTools: catalog.slice(0, k),
            },
            null,
            2,
          ),
        },
      ];
    },
  },
  // 5. firecrawl_crawl
  {
    name: 'firecrawl_crawl',
    description:
      'Start a multi-page crawl of a website, poll it to a terminal state, and return the collected pages as markdown. Backed by Cloudflare Browser Rendering /crawl + CrawlCoordinator Durable Object.',
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        limit: { type: 'number', description: 'Max pages (default 100).' },
        prompt: { type: 'string', description: 'Natural-language crawl scope instructions.' },
        includePaths: { type: 'array', items: { type: 'string' } },
        excludePaths: { type: 'array', items: { type: 'string' } },
        maxDiscoveryDepth: { type: 'number' },
        allowSubdomains: { type: 'boolean' },
        sitemap: { type: 'string', enum: ['include', 'only', 'skip'] },
      },
      required: ['url'],
    },
    handler: async (args, env, auth) => {
      const base = env.API_BASE || DEFAULT_API_BASE;
      const res = await apiFetch(
        env,
        '/v2/crawl',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(args),
        },
        auth,
      );
      const start = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !start.id) {
        return [
          { type: 'text', text: `Crawl failed to start: ${start.error ?? JSON.stringify(start)}` },
        ];
      }
      const id = start.id;
      let last: Record<string, unknown> = {};
      for (let i = 0; i < 20; i += 1) {
        await sleep(500);
        const sres = await apiFetch(env, `/v2/crawl/${id}`, {}, auth);
        last = (await sres.json()) as Record<string, unknown>;
        if (typeof last.status === 'string' && last.status !== 'scraping') break;
      }
      const data = (last.data as Array<Record<string, unknown>>) ?? [];
      let body = data
        .map((d, i) => {
          const meta = (d.metadata as Record<string, unknown>) ?? {};
          return `### ${i + 1}. ${(meta.sourceURL as string) ?? (d.url as string) ?? ''}\n${(d.markdown as string) ?? ''}`;
        })
        .join('\n\n---\n\n');
      if (body.length > CRAWL_TEXT_CAP)
        body = `${body.slice(0, CRAWL_TEXT_CAP)}\n\n…[truncated — fetch more via firecrawl_check_crawl_status]`;
      const summary = `Crawl ${id} · status=${last.status} · completed=${last.completed}/${last.total} · credits=${last.creditsUsed}\nStatus URL: ${base}/v2/crawl/${id}`;
      return [{ type: 'text', text: `${summary}\n\n${body}` }];
    },
  },
  // 6. firecrawl_check_crawl_status
  {
    name: 'firecrawl_check_crawl_status',
    description: 'Retrieve the status + collected pages of an existing crawl ID.',
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, skip: { type: 'number' } },
      required: ['id'],
    },
    handler: async (args, env, auth) => {
      const id = String(args.id ?? '');
      const skip = Number(args.skip ?? 0) || 0;
      const res = await apiFetch(
        env,
        `/v2/crawl/${encodeURIComponent(id)}${skip ? `?skip=${skip}` : ''}`,
        {},
        auth,
      );
      if (res.status === 404) return [{ type: 'text', text: `Crawl job not found: ${id}` }];
      const s = (await res.json()) as Record<string, unknown>;
      const data = (s.data as unknown[]) ?? [];
      return [
        {
          type: 'text',
          text: JSON.stringify(
            {
              id: s.id ?? id,
              status: s.status,
              completed: s.completed,
              total: s.total,
              creditsUsed: s.creditsUsed,
              next: s.next,
              pagesInThisPage: data.length,
              data,
            },
            null,
            2,
          ),
        },
      ];
    },
  },
  // 7. firecrawl_extract (deprecated shim, hidden from default list, callable via tools/call)
  {
    name: 'firecrawl_extract',
    description:
      'Structured AI data extraction across one or more URLs using a prompt and optional JSON Schema.',
    profiles: ['full'],
    deprecated: true,
    inputSchema: {
      type: 'object',
      properties: {
        urls: { type: 'array', items: { type: 'string' } },
        prompt: { type: 'string' },
        schema: { type: 'object' },
        enableWebSearch: { type: 'boolean' },
      },
      required: ['urls'],
    },
    handler: async (args, env, auth) => {
      const res = await apiFetch(
        env,
        '/v2/extract',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(args),
        },
        auth,
      );
      const start = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !start.id) {
        return [{ type: 'text', text: `Extract failed: ${start.error ?? res.status}` }];
      }
      const s = await apiFetch(env, `/v2/extract/${start.id}`, {}, auth);
      const json = await s.json();
      return [{ type: 'text', text: JSON.stringify(json, null, 2) }];
    },
  },
  // 8. firecrawl_agent
  {
    name: 'firecrawl_agent',
    description:
      'Autonomous web research. Given a prompt (and optional JSON schema or threadId), discover sources via search, scrape them, and return a synthesized structured answer with its sources.',
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        urls: { type: 'array', items: { type: 'string' } },
        schema: { type: 'object' },
        threadId: { type: 'string' },
      },
      required: ['prompt'],
    },
    handler: (a, e, auth) => proxyAgent(e, a, auth),
  },
  // 9. firecrawl_agent_status
  {
    name: 'firecrawl_agent_status',
    description: 'Poll an autonomous web agent run status and execution trace by ID.',
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Agent job UUID.' },
        includeTrace: { type: 'boolean' },
      },
      required: ['id'],
    },
    handler: async (a, e, auth) => {
      const id = encodeURIComponent(String(a.id ?? ''));
      const statusRes = await apiFetch(e, `/v2/agent/${id}`, {}, auth);
      const statusJson = (await statusRes.json()) as Record<string, unknown>;
      if (a.includeTrace) {
        const traceRes = await apiFetch(e, `/v2/agent/${id}/trace`, {}, auth);
        statusJson.trace = await traceRes.json().catch(() => null);
      }
      return [{ type: 'text', text: JSON.stringify(statusJson, null, 2) }];
    },
  },
  // 10. firecrawl_interact
  {
    name: 'firecrawl_interact',
    description:
      'Start or drive an interactive browser session using a URL, natural-language Co-Pilot prompt, or DOM actions.',
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Existing session ID to drive (omit to create new).',
        },
        url: { type: 'string', description: 'Initial URL when creating a session.' },
        prompt: {
          type: 'string',
          description: 'Natural-language instruction for the AI Browser Co-Pilot.',
        },
        code: {
          type: 'string',
          description: 'Optional JavaScript snippet to execute in page context.',
        },
      },
    },
    handler: async (a, e, auth) => {
      let sessionId = typeof a.sessionId === 'string' && a.sessionId ? a.sessionId : '';
      if (!sessionId) {
        const created = await apiFetch(
          e,
          '/v2/interact',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: a.url ?? 'https://example.com' }),
          },
          auth,
        );
        const cj = (await created.json()) as { id?: string };
        sessionId = cj.id ?? '';
      }
      if (a.prompt || a.code) {
        return proxyRestJson(
          e,
          'POST',
          `/v2/interact/${encodeURIComponent(sessionId)}`,
          { prompt: a.prompt, code: a.code },
          auth,
        );
      }
      return proxyRestJson(e, 'GET', `/v2/interact/${encodeURIComponent(sessionId)}`, null, auth);
    },
  },
  // 11. firecrawl_interact_stop
  {
    name: 'firecrawl_interact_stop',
    description: 'Stop and terminate an active interactive browser session.',
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Interactive browser session ID to close.' },
      },
      required: ['sessionId'],
    },
    handler: (a, e, auth) =>
      proxyRestJson(
        e,
        'DELETE',
        `/v2/interact/${encodeURIComponent(String(a.sessionId ?? ''))}`,
        null,
        auth,
      ),
  },
  // 12. firecrawl_parse
  {
    name: 'firecrawl_parse',
    description:
      'Parse a document (PDF, DOCX, XLSX, PPTX, ODT, ODS, CSV, RTF, HTML, TXT, or Image) into clean Markdown via Cloudflare Workers AI toMarkdown() + unpdf.',
    profiles: ['full', 'keyless'],
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL of the document to fetch and parse.' },
        data: { type: 'string', description: 'Inline document content to parse.' },
        filename: { type: 'string' },
        contentType: { type: 'string' },
      },
    },
    handler: (a, e, auth) => proxyRestJson(e, 'POST', '/v2/parse', a, auth),
  },
  // 13. firecrawl_search_feedback
  {
    name: 'firecrawl_search_feedback',
    description: 'Search prior job feedback entries stored in D1.',
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    handler: (a, e, auth) => {
      const q = encodeURIComponent(String(a.query ?? ''));
      const limit = Number(a.limit ?? 20) || 20;
      return proxyRestJson(e, 'GET', `/v2/feedback?query=${q}&limit=${limit}`, null, auth);
    },
  },
  // 14. firecrawl_feedback
  {
    name: 'firecrawl_feedback',
    description: 'Submit quality feedback or rating for a scrape, crawl, search, or agent job.',
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        endpoint: { type: 'string' },
        vote: { type: 'string', enum: ['up', 'down', 'good', 'bad'] },
        rating: { type: 'number' },
        comment: { type: 'string' },
      },
    },
    handler: (a, e, auth) => proxyRestJson(e, 'POST', '/v2/feedback', a, auth),
  },
  // 15. firecrawl_credit_usage
  {
    name: 'firecrawl_credit_usage',
    description: 'Read current team credit balance, spend limit, and Workers AI token usage.',
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: {
        includeHistorical: { type: 'boolean' },
      },
    },
    handler: async (a, e, auth) => {
      const credRes = await apiFetch(e, '/v2/team/credit-usage', {}, auth);
      const tokRes = await apiFetch(e, '/v2/team/token-usage', {}, auth);
      const out: Record<string, unknown> = {
        credits: await credRes.json().catch(() => null),
        tokens: await tokRes.json().catch(() => null),
      };
      if (a.includeHistorical) {
        const histRes = await apiFetch(e, '/v2/team/credit-usage/historical', {}, auth);
        out.historical = await histRes.json().catch(() => null);
      }
      return [{ type: 'text', text: JSON.stringify(out, null, 2) }];
    },
  },
  // 16. firecrawl_developer_search
  {
    name: 'firecrawl_developer_search',
    description: 'Search public repositories, code, issues, PRs and dev docs (GitHub-scoped).',
    profiles: ['full', 'search'],
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, k: { type: 'number' } },
      required: ['query'],
    },
    handler: (a, e, auth) =>
      proxySearch(e, String(a.query ?? ''), ['developer'], Number(a.k) || 10, auth),
  },
  // 17. firecrawl_gov_search
  {
    name: 'firecrawl_gov_search',
    description: 'Search US federal legal + regulatory primary sources (gov domains).',
    profiles: ['full', 'search'],
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, k: { type: 'number' } },
      required: ['query'],
    },
    handler: (a, e, auth) =>
      proxySearch(e, String(a.query ?? ''), ['gov'], Number(a.k) || 10, auth),
  },
  // 18. firecrawl_research_search_papers
  {
    name: 'firecrawl_research_search_papers',
    description: 'Search scholarly papers (research-paper category; arXiv/PubMed/journals).',
    profiles: ['full', 'search'],
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, k: { type: 'number' } },
      required: ['query'],
    },
    handler: (a, e, auth) =>
      proxySearch(e, String(a.query ?? ''), ['research'], Number(a.k) || 20, auth),
  },
  // 19. firecrawl_research_inspect_paper
  {
    name: 'firecrawl_research_inspect_paper',
    description:
      'Canonical metadata for one paper ID (arXiv:…, DOI:…, CorpusId:…) via Semantic Scholar.',
    profiles: ['full', 'search'],
    inputSchema: {
      type: 'object',
      properties: { paperId: { type: 'string' } },
      required: ['paperId'],
    },
    handler: async (a) => {
      try {
        const p = await s2Fetch(
          `${S2}/paper/${encodeURIComponent(String(a.paperId ?? ''))}?fields=title,abstract,year,venue,citationCount,authors.name,url,tldr`,
        );
        const authors = ((p.authors as Array<{ name?: string }>) ?? [])
          .map((x) => x.name)
          .join(', ');
        const tldr = (p.tldr as { text?: string } | null)?.text;
        return [
          {
            type: 'text',
            text: `${p.title ?? '(untitled)'} (${p.year ?? '?'})\nAuthors: ${authors || '—'}\nVenue: ${p.venue || '—'} · Citations: ${p.citationCount ?? '—'}\n${p.url || ''}${tldr ? `\nTL;DR: ${tldr}` : ''}\n\nAbstract:\n${p.abstract || '(no abstract)'}`,
          },
        ];
      } catch (e) {
        return [{ type: 'text', text: `Paper lookup failed: ${(e as Error).message}` }];
      }
    },
  },
  // 20. firecrawl_research_related_papers
  {
    name: 'firecrawl_research_related_papers',
    description: 'Find papers related to a seed paper ID (Semantic Scholar recommendations).',
    profiles: ['full', 'search'],
    inputSchema: {
      type: 'object',
      properties: {
        seed_ids: { type: 'array', items: { type: 'string' } },
        paperId: { type: 'string' },
        k: { type: 'number' },
      },
      required: [],
    },
    handler: async (a) => {
      const seed =
        Array.isArray(a.seed_ids) && a.seed_ids.length
          ? String(a.seed_ids[0])
          : String(a.paperId ?? '');
      if (!seed) return [{ type: 'text', text: 'Provide a seed paperId or seed_ids.' }];
      const k = Number(a.k) || 10;
      try {
        const body = await s2Fetch(
          `https://api.semanticscholar.org/recommendations/v1/papers/forpaper/${encodeURIComponent(seed)}?fields=title,year,authors.name&limit=${k}`,
        );
        const papers = (body.recommendedPapers as Array<Record<string, unknown>>) ?? [];
        const text = papers.map((p, i) => `${i + 1}. ${p.title} (${p.year ?? '?'})`).join('\n');
        return [{ type: 'text', text: text || 'No related papers found.' }];
      } catch (e) {
        return [{ type: 'text', text: `Related-papers lookup failed: ${(e as Error).message}` }];
      }
    },
  },
  // 21. firecrawl_research_read_paper
  {
    name: 'firecrawl_research_read_paper',
    description: 'Read a paper relevant to a question — returns its TL;DR + abstract.',
    profiles: ['full', 'search'],
    inputSchema: {
      type: 'object',
      properties: { paperId: { type: 'string' }, question: { type: 'string' } },
      required: ['paperId'],
    },
    handler: async (a) => {
      try {
        const p = await s2Fetch(
          `${S2}/paper/${encodeURIComponent(String(a.paperId ?? ''))}?fields=title,abstract,tldr`,
        );
        const tldr = (p.tldr as { text?: string } | null)?.text;
        return [
          {
            type: 'text',
            text: `Re: "${a.question ?? ''}"\n\n${p.title ?? ''}\nTL;DR: ${tldr || '—'}\n\nAbstract:\n${p.abstract || '(no abstract)'}`,
          },
        ];
      } catch (e) {
        return [{ type: 'text', text: `Paper read failed: ${(e as Error).message}` }];
      }
    },
  },
  // 22. firecrawl_research_search_github (deprecated shim, hidden from default list, callable via tools/call)
  {
    name: 'firecrawl_research_search_github',
    description:
      'Search GitHub repositories, code, issues, and documentation (legacy alias for firecrawl_developer_search).',
    profiles: ['full'],
    deprecated: true,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, k: { type: 'number' } },
      required: ['query'],
    },
    handler: (a, e, auth) =>
      proxySearch(e, String(a.query ?? ''), ['github', 'developer'], Number(a.k) || 10, auth),
  },
  // 23. firecrawl_monitor_create
  {
    name: 'firecrawl_monitor_create',
    description:
      'Create a recurring change-detection monitor for a URL (checked on a schedule). Requires an API key.',
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        name: { type: 'string' },
        tag: { type: 'string' },
        schedule: { type: 'string' },
        webhookUrl: { type: 'string' },
      },
      required: ['url'],
    },
    handler: (a, e, auth) => proxyRestJson(e, 'POST', '/v2/monitor', a, auth),
  },
  // 24. firecrawl_monitor_list
  {
    name: 'firecrawl_monitor_list',
    description: 'List your change-detection monitors. Requires an API key.',
    profiles: ['full'],
    inputSchema: { type: 'object', properties: {} },
    handler: (_a, e, auth) => proxyRestJson(e, 'GET', '/v2/monitor', null, auth),
  },
  // 25. firecrawl_monitor_get
  {
    name: 'firecrawl_monitor_get',
    description: 'Get details of a specific change-detection monitor by ID.',
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: (a, e, auth) =>
      proxyRestJson(e, 'GET', `/v2/monitor/${encodeURIComponent(String(a.id ?? ''))}`, null, auth),
  },
  // 26. firecrawl_monitor_update
  {
    name: 'firecrawl_monitor_update',
    description:
      'Update a change-detection monitor (name, schedule, enabled state, or webhookUrl).',
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        schedule: { type: 'string' },
        enabled: { type: 'boolean' },
        webhookUrl: { type: 'string' },
      },
      required: ['id'],
    },
    handler: (a, e, auth) => {
      const { id, ...patch } = a;
      return proxyRestJson(
        e,
        'PATCH',
        `/v2/monitor/${encodeURIComponent(String(id ?? ''))}`,
        patch,
        auth,
      );
    },
  },
  // 27. firecrawl_monitor_delete
  {
    name: 'firecrawl_monitor_delete',
    description: 'Delete a change-detection monitor by ID.',
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: (a, e, auth) =>
      proxyRestJson(
        e,
        'DELETE',
        `/v2/monitor/${encodeURIComponent(String(a.id ?? ''))}`,
        null,
        auth,
      ),
  },
  // 28. firecrawl_monitor_run
  {
    name: 'firecrawl_monitor_run',
    description: 'Run a monitor check now and return its change status. Requires an API key.',
    profiles: ['full'],
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: (a, e, auth) =>
      proxyRestJson(
        e,
        'POST',
        `/v2/monitor/${encodeURIComponent(String(a.id ?? ''))}/run`,
        {},
        auth,
      ),
  },
  // 29. firecrawl_monitor_checks
  {
    name: 'firecrawl_monitor_checks',
    description: 'List historical checks for a monitor. Requires an API key.',
    profiles: ['full'],
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: (a, e, auth) =>
      proxyRestJson(
        e,
        'GET',
        `/v2/monitor/${encodeURIComponent(String(a.id ?? ''))}/checks`,
        null,
        auth,
      ),
  },
  // 30. firecrawl_monitor_check
  {
    name: 'firecrawl_monitor_check',
    description: 'Get a single historical check for a monitor by monitor ID and check ID.',
    profiles: ['full'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Monitor ID' },
        checkId: { type: 'string', description: 'Check ID' },
      },
      required: ['id', 'checkId'],
    },
    handler: (a, e, auth) =>
      proxyRestJson(
        e,
        'GET',
        `/v2/monitor/${encodeURIComponent(String(a.id ?? ''))}/checks/${encodeURIComponent(String(a.checkId ?? ''))}`,
        null,
        auth,
      ),
  },
];

export function listTools(profile: ToolProfile, includeDeprecated = false): McpTool[] {
  return TOOLS.filter((t) => t.profiles.includes(profile) && (includeDeprecated || !t.deprecated));
}

export function toolError(err: unknown): { text: string; isError: true } {
  if (err instanceof NotImplemented) return { text: err.message, isError: true };
  if (err instanceof SsrfError) return { text: `Blocked: ${err.message}`, isError: true };
  return { text: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
}
