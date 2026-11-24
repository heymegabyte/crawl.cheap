import * as Sentry from '@sentry/cloudflare';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  getLangfuseSafeClient,
  resolveCorrelationContext,
  SevenSystemTelemetryRouter,
} from '@crawlcheap/engine';
import type { Env } from './env';
import { listTools, TOOLS, toolError, type McpContent, type ToolProfile } from './tools';

const sentryOptions = (env: Env) => ({ dsn: env.SENTRY_DSN, tracesSampleRate: 1.0 });

/**
 * crawl.cheap remote MCP — stateless Streamable-HTTP (JSON-RPC 2.0 over POST).
 * Firecrawl-tool-compatible. Profiles: /v2/mcp (full), /v2/mcp-search (search-only),
 * /mcp (alias → full). Clean-room stateless handler (request/response tool flow); a
 * migration to Cloudflare's createMcpHandler is tracked once its wiring is verified.
 */

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = {
  name: 'crawl.cheap',
  title: 'crawl.cheap — web data engine for AI',
  version: '0.1.0',
};

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function result(id: JsonRpcRequest['id'], value: unknown) {
  return { jsonrpc: '2.0' as const, id: id ?? null, result: value };
}
function rpcError(id: JsonRpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0' as const, id: id ?? null, error: { code, message } };
}

async function handleOne(
  req: JsonRpcRequest,
  env: Env,
  profile: ToolProfile,
  auth?: string,
): Promise<object | null> {
  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return rpcError(req?.id ?? null, -32600, 'Invalid Request');
  }
  switch (req.method) {
    case 'initialize':
      return result(req.id, {
        protocolVersion:
          typeof req.params?.protocolVersion === 'string'
            ? req.params.protocolVersion
            : PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: SERVER_INFO,
        instructions:
          'All 30 pinned Firecrawl-compatible firecrawl_* tools (28 listable + 2 deprecated shims) are live on Cloudflare Workers, alongside MCP resources and research prompt templates.',
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null; // notifications: no response
    case 'ping':
      return result(req.id, {});
    case 'resources/list':
      return result(req.id, {
        resources: [
          {
            uri: 'crawlcheap://docs/llms.txt',
            name: 'crawl.cheap LLM Documentation Index (llms.txt)',
            mimeType: 'text/plain',
            description:
              'Complete overview of crawl.cheap Firecrawl v1/v2 endpoints, 30 MCP tools, and OAuth 2.1 PKCE.',
          },
          {
            uri: 'crawlcheap://integrations/registry',
            name: 'crawl.cheap Ecosystem Integrations & Plugins Registry',
            mimeType: 'application/json',
            description:
              '12 drop-in integrations for LangChain, LlamaIndex, Vercel AI SDK, CrewAI, Cursor, Claude, Dify, and n8n.',
          },
        ],
      });
    case 'resources/read': {
      const uri = String(req.params?.uri ?? 'crawlcheap://docs/llms.txt');
      return result(req.id, {
        contents: [
          {
            uri,
            mimeType: uri.endsWith('registry') ? 'application/json' : 'text/plain',
            text: uri.endsWith('registry')
              ? JSON.stringify({ endpoint: 'https://api.crawl.cheap/v2/integrations', count: 12 })
              : '# crawl.cheap — Firecrawl v1/v2 Compatible Web Data Engine on Cloudflare Workers\nSee https://api.crawl.cheap/llms-full.txt',
          },
        ],
      });
    }
    case 'prompts/list':
      return result(req.id, {
        prompts: [
          {
            name: 'deep-web-research',
            description: 'Multi-step web search, parallel Markdown scrape, and cited synthesis.',
            arguments: [
              { name: 'topic', description: 'Research topic or question', required: true },
            ],
          },
          {
            name: 'competitor-pricing-extract',
            description: 'Extract structured pricing tiers and feature matrices from a URL.',
            arguments: [{ name: 'url', description: 'Pricing page URL', required: true }],
          },
        ],
      });
    case 'prompts/get': {
      const name = String(req.params?.name ?? 'deep-web-research');
      const args = (req.params?.arguments as Record<string, string>) ?? {};
      return result(req.id, {
        description: `Prompt template for ${name}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                name === 'competitor-pricing-extract'
                  ? `Use firecrawl_scrape with formats:["markdown","json"] on ${args.url ?? 'https://example.com'} to extract all pricing tiers.`
                  : `Use firecrawl_search and firecrawl_scrape to research "${args.topic ?? 'Cloudflare Workers'}" and synthesize findings with citations.`,
            },
          },
        ],
      });
    }
    case 'tools/list':
      return result(req.id, {
        tools: listTools(profile).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    case 'tools/call': {
      const name = req.params?.name as string | undefined;
      const args = (req.params?.arguments as Record<string, unknown>) ?? {};
      const tool = TOOLS.find((t) => t.name === name && t.profiles.includes(profile));
      if (!tool) return rpcError(req.id, -32602, `Unknown tool: ${name ?? '(none)'}`);
      const t0 = Date.now();
      const lf = getLangfuseSafeClient({
        publicKey: env.LANGFUSE_PUBLIC_KEY,
        secretKey: env.LANGFUSE_SECRET_KEY,
        baseUrl: env.LANGFUSE_HOST ?? env.LANGFUSE_BASEURL,
        serviceName: 'crawl-cheap-mcp',
        environment: env.SENTRY_ENVIRONMENT ?? 'production',
      });
      try {
        const content: McpContent = await tool.handler(args, env, auth);
        const durationMs = Math.max(1, Date.now() - t0);
        void lf.traceSafe({
          name: `mcp.tool.${tool.name}`,
          model: 'mcp.jsonrpc',
          input: args,
          output: { items: content.length },
          durationMs,
        });
        if (env.POSTHOG_API_KEY || (env.GA_MEASUREMENT_ID && env.GA_API_SECRET)) {
          const router = new SevenSystemTelemetryRouter({
            serviceName: 'crawl-cheap-mcp',
            environment: env.SENTRY_ENVIRONMENT ?? 'production',
            posthogHost: env.POSTHOG_HOST,
            posthogApiKey: env.POSTHOG_API_KEY,
            sentryDsn: env.SENTRY_DSN,
            ga4MeasurementId: env.GA_MEASUREMENT_ID,
            ga4ApiSecret: env.GA_API_SECRET,
            gtmContainerId: env.GTM_CONTAINER_ID,
          });
          void router.dispatchUnifiedEvent({
            eventName: 'mcp_tool_call',
            sessionId: 'mcp_session',
            distinctId: 'mcp_caller',
            properties: { tool: tool.name, profile, durationMs, isError: false },
          });
        }
        return result(req.id, { content, isError: false });
      } catch (err) {
        const { text } = toolError(err);
        void lf.traceSafe({
          name: `mcp.tool.${tool.name}`,
          model: 'mcp.jsonrpc',
          input: args,
          output: { error: text },
          durationMs: Math.max(1, Date.now() - t0),
          level: 'ERROR',
          statusMessage: text,
        });
        return result(req.id, { content: [{ type: 'text', text }], isError: true });
      }
    }
    default:
      return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

async function handleMcp(
  body: unknown,
  env: Env,
  profile: ToolProfile,
  auth?: string,
): Promise<{ status: number; json?: unknown }> {
  const batch = Array.isArray(body) ? (body as JsonRpcRequest[]) : [body as JsonRpcRequest];
  const responses: object[] = [];
  for (const req of batch) {
    const res = await handleOne(req, env, profile, auth);
    if (res !== null) responses.push(res);
  }
  if (responses.length === 0) return { status: 202 };
  return { status: 200, json: Array.isArray(body) ? responses : responses[0] };
}

const app = new Hono<{ Bindings: Env }>();
app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['content-type', 'authorization', 'mcp-protocol-version', 'traceparent'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    exposeHeaders: ['traceparent', 'x-trace-id'],
  }),
);
app.use('*', async (c, next) => {
  const corr = resolveCorrelationContext(c.req.header('traceparent'));
  c.header('traceparent', corr.traceparent);
  c.header('x-trace-id', corr.traceId);
  await next();
});

const INFO = {
  service: 'crawl.cheap MCP',
  transport: 'Streamable HTTP (stateless JSON-RPC 2.0)',
  toolsRegistered: TOOLS.length,
  toolsListable: listTools('full').length,
  endpoints: {
    full: 'POST /v2/mcp',
    searchOnly: 'POST /v2/mcp-search',
    keyless: 'POST /v2/mcp-keyless',
    alias: 'POST /mcp',
  },
  liveTools: TOOLS.map((t) => t.name),
  note: 'All 30 pinned firecrawl_* tools (28 listable + 2 deprecated shims) are implemented and live.',
};

app.get('/', (c) => c.json(INFO));
app.get('/health', (c) => c.json({ status: 'ok', service: 'crawl-cheap-mcp' }));

// RFC 9728 Protected Resource Metadata & RFC 8414 Authorization Server Metadata for MCP OAuth 2.1 clients
app.get('/.well-known/oauth-protected-resource', (c) => {
  const origin = new URL(c.req.url).origin;
  const authServer = c.env.API_BASE || 'https://api.crawl.cheap';
  return c.json({
    resource: `${origin}/v2/mcp`,
    authorization_servers: [authServer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp', 'crawl', 'scrape', 'search', 'extract'],
    resource_name: 'crawl.cheap Remote MCP Server (Firecrawl-compatible)',
  });
});

app.get('/.well-known/oauth-authorization-server', (c) => {
  const issuer = (c.env.API_BASE || 'https://api.crawl.cheap').replace(/\/+$/, '');
  return c.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    revocation_endpoint: `${issuer}/revoke`,
    introspection_endpoint: `${issuer}/introspect`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['mcp', 'crawl', 'scrape', 'search', 'extract'],
  });
});

app.get('/.well-known/mcp.json', (c) => {
  const origin = new URL(c.req.url).origin;
  const authServer = (c.env.API_BASE || 'https://api.crawl.cheap').replace(/\/+$/, '');
  return c.json({
    $schema: 'https://modelcontextprotocol.io/schemas/server-card/v1.0',
    version: '1.0',
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: SERVER_INFO,
    toolsRegistered: TOOLS.length,
    toolsListable: listTools('full').length,
    endpoints: [
      {
        profile: 'full',
        url: `${origin}/v2/mcp`,
        transport: 'streamable-http',
        capabilities: ['tools', 'resources', 'prompts'],
        auth: {
          type: 'oauth2',
          authorization_server: authServer,
          protected_resource_metadata: `${origin}/.well-known/oauth-protected-resource`,
        },
      },
      {
        profile: 'search',
        url: `${origin}/v2/mcp-search`,
        transport: 'streamable-http',
        capabilities: ['tools'],
      },
      {
        profile: 'keyless',
        url: `${origin}/v2/mcp-keyless`,
        transport: 'streamable-http',
        capabilities: ['tools'],
      },
    ],
  });
});

const mcpAgentCardHandler = (c: {
  req: { url: string };
  env: Env;
  json: (b: unknown) => Response;
}) => {
  const origin = new URL(c.req.url).origin;
  const apiOrigin = (c.env.API_BASE || 'https://api.crawl.cheap').replace(/\/+$/, '');
  return c.json({
    protocolVersion: '1.0.0',
    name: 'crawl.cheap-mcp',
    description:
      'All 30 Firecrawl-compatible firecrawl_* MCP tools over Streamable-HTTP with OAuth 2.1 PKCE S256.',
    version: '1.0.0',
    url: `${origin}/v2/mcp`,
    provider: { organization: 'crawl.cheap', url: 'https://crawl.cheap' },
    supportedInterfaces: [
      {
        url: `${apiOrigin}/a2a/v1`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
      {
        url: `${origin}/v2/mcp`,
        protocolBinding: 'MCP_STREAMABLE_HTTP',
        protocolVersion: PROTOCOL_VERSION,
      },
    ],
    capabilities: { streaming: true, pushNotifications: false },
  });
};

app.get('/.well-known/agent-card.json', mcpAgentCardHandler);
app.get('/.well-known/agent.json', mcpAgentCardHandler);

app.onError((err, c) => {
  Sentry.captureException(err);
  return c.json(rpcError(null, -32603, 'Internal error'), 500);
});
app.get('/debug/sentry', (c) => {
  if (c.req.query('token') !== 'selftest') return c.json({ ok: false }, 404);
  throw new Error(`sentry-selftest-mcp ${c.req.query('nonce') ?? ''}`.trim());
});

const mount = (path: string, profile: ToolProfile) => {
  app.get(path, (c) =>
    c.json({
      ...INFO,
      profile,
      hint: 'POST JSON-RPC 2.0 here (initialize, tools/list, tools/call).',
    }),
  );
  app.post(path, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(rpcError(null, -32700, 'Parse error'), 400);
    }
    const { status, json } = await handleMcp(
      body,
      c.env,
      profile,
      c.req.header('authorization') ?? undefined,
    );
    if (status === 202) return c.body(null, 202);
    return c.json(json as object, 200);
  });
};

mount('/v2/mcp', 'full');
mount('/mcp', 'full');
mount('/v2/mcp-search', 'search');
mount('/v2/mcp-keyless', 'keyless');

export default Sentry.withSentry(sentryOptions, {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),
} satisfies ExportedHandler<Env>);
