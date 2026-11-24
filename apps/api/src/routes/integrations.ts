import { Hono } from 'hono';
import { z } from 'zod';
import { THEME_TOOLS_CATALOG_MANIFEST } from '@crawlcheap/engine';
import type { Env } from '../env';
import type { Vars } from '../lib/auth';
import { parseBody } from '../lib/respond';

export interface IntegrationPluginSpec {
  id: string;
  name: string;
  category: 'ai-frameworks' | 'mcp-ides' | 'workflow-builders' | 'productivity-local' | 'edge-cicd';
  categoryLabel: string;
  tagline: string;
  packageOrProtocol: string;
  docsUrl: string;
  deepLinkUrl?: string;
  language: 'typescript' | 'python' | 'json' | 'yaml' | 'bash';
  buildSnippet: (opts: {
    apiKey: string;
    apiUrl: string;
    mcpUrl: string;
    targetUrl: string;
  }) => string;
}

export const ECOSYSTEM_INTEGRATIONS: readonly IntegrationPluginSpec[] = [
  {
    id: 'langchain',
    name: 'LangChain (JS & Python)',
    category: 'ai-frameworks',
    categoryLabel: 'AI Frameworks',
    tagline: 'Drop-in FirecrawlLoader for RAG document ingestion & autonomous LangGraph agents.',
    packageOrProtocol: '@langchain/community · langchain-firecrawl',
    docsUrl: 'https://js.langchain.com/docs/integrations/document_loaders/web_loaders/firecrawl',
    language: 'typescript',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `// TypeScript — @langchain/community FirecrawlLoader
import { FirecrawlLoader } from '@langchain/community/document_loaders/web/firecrawl';

const loader = new FirecrawlLoader({
  url: '${targetUrl}',
  apiKey: '${apiKey}',
  apiUrl: '${apiUrl}',
  mode: 'scrape', // 'scrape' | 'crawl' | 'map'
  params: { formats: ['markdown', 'summary'], onlyMainContent: true },
});
const docs = await loader.load();

# Python — langchain_community.document_loaders
# from langchain_community.document_loaders import FirecrawlLoader
# loader = FirecrawlLoader(url="${targetUrl}", api_key="${apiKey}", api_url="${apiUrl}", mode="crawl")
# docs = loader.load()`,
  },
  {
    id: 'llamaindex',
    name: 'LlamaIndex Web Reader',
    category: 'ai-frameworks',
    categoryLabel: 'AI Frameworks',
    tagline: 'Ingest clean edge-distilled Markdown directly into LlamaIndex VectorStoreIndex.',
    packageOrProtocol: 'llama-index-readers-web · FirecrawlWebReader',
    docsUrl: 'https://docs.llamaindex.ai/en/stable/',
    language: 'python',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `from llama_index.readers.web import FirecrawlWebReader
from llama_index.core import VectorStoreIndex

reader = FirecrawlWebReader(
    api_key="${apiKey}",
    api_url="${apiUrl}",
    mode="scrape",
    params={"formats": ["markdown"]},
)
documents = reader.load_data(url="${targetUrl}")
index = VectorStoreIndex.from_documents(documents)`,
  },
  {
    id: 'vercel-ai-sdk',
    name: 'Vercel AI SDK Tools',
    category: 'ai-frameworks',
    categoryLabel: 'AI Frameworks',
    tagline: 'Typed tool() definitions for generateText & streamText with Zod schemas.',
    packageOrProtocol: 'ai · @mendable/firecrawl-js · zod',
    docsUrl: 'https://sdk.vercel.ai/docs',
    language: 'typescript',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `import { generateText, tool } from 'ai';
import { z } from 'zod';

export const crawlCheapScrapeTool = tool({
  description: 'Scrape any URL into clean LLM-ready Markdown via crawl.cheap on Cloudflare Workers',
  parameters: z.object({ url: z.string().url().default('${targetUrl}') }),
  execute: async ({ url }) => {
    const res = await fetch('${apiUrl}/v2/scrape', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer ${apiKey}',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['markdown', 'summary'] }),
    });
    return await res.json();
  },
});`,
  },
  {
    id: 'crewai',
    name: 'CrewAI & AutoGen Agents',
    category: 'ai-frameworks',
    categoryLabel: 'AI Frameworks',
    tagline: 'Equip multi-agent CrewAI teams with FirecrawlScrapeWebsiteTool & Search.',
    packageOrProtocol: 'crewai_tools · FirecrawlScrapeWebsiteTool',
    docsUrl: 'https://docs.crewai.com/',
    language: 'python',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `from crewai_tools import FirecrawlScrapeWebsiteTool, FirecrawlCrawlWebsiteTool

scrape_tool = FirecrawlScrapeWebsiteTool(
    api_key="${apiKey}",
    api_url="${apiUrl}",
    url="${targetUrl}",
    config={"formats": ["markdown", "links"]},
)`,
  },
  {
    id: 'cursor-mcp',
    name: 'Cursor IDE 1-Click MCP Plugin',
    category: 'mcp-ides',
    categoryLabel: 'MCP & IDEs',
    tagline: '30 live firecrawl_* tools over Streamable-HTTP with OAuth 2.1 PKCE S256.',
    packageOrProtocol: 'Model Context Protocol (2025-06-18) · .cursor/mcp.json',
    docsUrl: 'https://docs.cursor.com/context/model-context-protocol',
    deepLinkUrl:
      'cursor://anysphere.cursor-deeplink/mcp/install?name=crawl-cheap&config=eyJ1cmwiOiJodHRwczovL21jcC5jcmF3bC5jaGVhcC92Mi9tY3AifQ==',
    language: 'json',
    buildSnippet: ({ apiKey, mcpUrl }) =>
      JSON.stringify(
        {
          mcpServers: {
            'crawl-cheap': {
              url: `${mcpUrl}/v2/mcp`,
              transport: 'streamable-http',
              headers: {
                Authorization: `Bearer ${apiKey}`,
              },
            },
          },
        },
        null,
        2,
      ),
  },
  {
    id: 'claude-mcp',
    name: 'Claude Code & Claude Desktop',
    category: 'mcp-ides',
    categoryLabel: 'MCP & IDEs',
    tagline: 'Register all 30 web-data & deep-research tools in Claude Code with 1 command.',
    packageOrProtocol: 'claude mcp add --transport http',
    docsUrl: 'https://modelcontextprotocol.io/',
    language: 'bash',
    buildSnippet: ({ apiKey, mcpUrl }) =>
      `# 1-Line Claude Code CLI registration (Streamable HTTP + Bearer or OAuth 2.1 PKCE)
claude mcp add --transport http crawl-cheap ${mcpUrl}/v2/mcp \\
  --header "Authorization: Bearer ${apiKey}"

# Or search-focused 9-tool profile:
claude mcp add --transport http crawl-cheap-search ${mcpUrl}/v2/mcp-search \\
  --header "Authorization: Bearer ${apiKey}"`,
  },
  {
    id: 'windsurf-vscode-mcp',
    name: 'Windsurf, VS Code & Cline MCP',
    category: 'mcp-ides',
    categoryLabel: 'MCP & IDEs',
    tagline: 'Auto-discovered via /.well-known/mcp.json with zero-config keyless fallback.',
    packageOrProtocol: 'vscode:mcp/install · /.well-known/mcp.json',
    docsUrl: 'https://code.visualstudio.com/docs/copilot/chat/mcp-servers',
    deepLinkUrl:
      'vscode:mcp/install?%7B%22name%22%3A%22crawl-cheap%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.crawl.cheap%2Fv2%2Fmcp%22%7D',
    language: 'json',
    buildSnippet: ({ apiKey, mcpUrl }) =>
      JSON.stringify(
        {
          servers: {
            'crawl-cheap': {
              type: 'http',
              url: `${mcpUrl}/v2/mcp`,
              headers: {
                Authorization: `Bearer ${apiKey}`,
              },
            },
          },
        },
        null,
        2,
      ),
  },
  {
    id: 'dify-plugin',
    name: 'Dify Workflow & Agent Tool Plugin',
    category: 'workflow-builders',
    categoryLabel: 'Workflow Builders',
    tagline: 'Import all core Firecrawl v2 operations into Dify via OpenAPI 3.1 schema URL.',
    packageOrProtocol: 'OpenAPI 3.1 · https://api.crawl.cheap/openapi.json',
    docsUrl: 'https://docs.dify.ai/',
    language: 'json',
    buildSnippet: ({ apiKey, apiUrl }) =>
      JSON.stringify(
        {
          difyCustomToolImport: {
            schemaUrl: `${apiUrl}/openapi.json`,
            authentication: {
              type: 'API Key',
              header: 'Authorization',
              prefix: 'Bearer',
              value: apiKey,
            },
            overrideBaseUrl: apiUrl,
          },
        },
        null,
        2,
      ),
  },
  {
    id: 'n8n-node',
    name: 'n8n & Make Automation Node',
    category: 'workflow-builders',
    categoryLabel: 'Workflow Builders',
    tagline: 'Use the native n8n Firecrawl node pointed at https://api.crawl.cheap.',
    packageOrProtocol: 'n8n-nodes-base.httpRequest · Firecrawl Credentials',
    docsUrl: 'https://docs.n8n.io/',
    language: 'json',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      JSON.stringify(
        {
          nodes: [
            {
              name: 'crawl.cheap Scrape',
              type: 'n8n-nodes-base.httpRequest',
              parameters: {
                method: 'POST',
                url: `${apiUrl}/v2/scrape`,
                sendHeaders: true,
                headerParameters: {
                  parameters: [{ name: 'Authorization', value: `Bearer ${apiKey}` }],
                },
                sendBody: true,
                jsonParameters: true,
                bodyParametersJson: JSON.stringify({
                  url: targetUrl,
                  formats: ['markdown', 'summary', 'links'],
                }),
              },
            },
          ],
        },
        null,
        2,
      ),
  },
  {
    id: 'flowise-tool',
    name: 'Flowise & Langflow Custom Tool',
    category: 'workflow-builders',
    categoryLabel: 'Workflow Builders',
    tagline: 'Drop-in JavaScript tool function for Flowise Chatflows & Agentflows.',
    packageOrProtocol: 'Flowise Custom Tool · OpenAPI',
    docsUrl: 'https://docs.flowiseai.com/',
    language: 'typescript',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `// Flowise Custom Tool Function ($url input variable)
const fetch = require('node-fetch');
const response = await fetch('${apiUrl}/v2/scrape', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${apiKey}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: typeof $url !== 'undefined' ? $url : '${targetUrl}',
    formats: ['markdown'],
  }),
});
const data = await response.json();
return data.data?.markdown || JSON.stringify(data);`,
  },
  {
    id: 'cloudflare-workers-hono',
    name: 'Cloudflare Workers & Hono Plugin',
    category: 'edge-cicd',
    categoryLabel: 'Edge & CI/CD',
    tagline: 'Zero-latency edge integration with W3C traceparent & 2,500ms fail-open timeout.',
    packageOrProtocol: 'Hono · Cloudflare Workers · @theme.tools/crawl-research',
    docsUrl: 'https://developers.cloudflare.com/workers/',
    language: 'typescript',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `import { Hono } from 'hono';

const app = new Hono();

app.post('/ingest', async (c) => {
  const res = await fetch('${apiUrl}/v2/scrape', {
    method: 'POST',
    headers: {
      'authorization': 'Bearer ${apiKey}',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      url: '${targetUrl}',
      formats: ['markdown', { type: 'changeTracking', modes: ['git-diff'] }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  return c.json(await res.json());
});`,
  },
  {
    id: 'github-actions-ci',
    name: 'GitHub Actions Docs Crawler & llms.txt CI',
    category: 'edge-cicd',
    categoryLabel: 'Edge & CI/CD',
    tagline: 'Nightly CI workflow to regenerate llms.txt & audit docs links on every deploy.',
    packageOrProtocol: 'GitHub Actions · POST /v1/llmstxt',
    docsUrl: 'https://docs.github.com/en/actions',
    language: 'yaml',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `name: Sync llms.txt via crawl.cheap
on:
  schedule:
    - cron: '0 4 * * *'
  workflow_dispatch:
jobs:
  sync-llms-txt:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Generate llms.txt & llms-full.txt
        run: |
          JOB=$(curl -s -X POST ${apiUrl}/v1/llmstxt \\
            -H "Authorization: Bearer ${apiKey}" \\
            -H "Content-Type: application/json" \\
            -d '{"url":"${targetUrl}","maxUrls":25,"showFullText":true}' | jq -r '.id')
          curl -s ${apiUrl}/v1/llmstxt/$JOB | jq -r '.data.llmstxt' > public/llms.txt`,
  },
  {
    id: 'mastra',
    name: 'Mastra TypeScript Agent & RAG Tool',
    category: 'ai-frameworks',
    categoryLabel: 'AI Frameworks',
    tagline: 'Typed createTool() and MDocument chunking for Mastra TypeScript agents.',
    packageOrProtocol: '@mastra/core · @mastra/rag',
    docsUrl: 'https://mastra.ai/docs',
    language: 'typescript',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const crawlCheapMastraTool = createTool({
  id: 'crawl-cheap-scrape-chunk',
  description: 'Scrape a URL into structure-aware Markdown chunks & JSON-LD via crawl.cheap',
  inputSchema: z.object({ url: z.string().url().default('${targetUrl}') }),
  execute: async ({ context }) => {
    const res = await fetch('${apiUrl}/v2/scrape', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ${apiKey}',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        url: context.url,
        formats: ['markdown', 'chunks', 'jsonLd'],
      }),
    });
    return await res.json();
  },
});`,
  },
  {
    id: 'pydantic-ai',
    name: 'PydanticAI Type-Safe Python Agent',
    category: 'ai-frameworks',
    categoryLabel: 'AI Frameworks',
    tagline: 'Validated @agent.tool with Pydantic models and Logfire/Langfuse trace correlation.',
    packageOrProtocol: 'pydantic-ai · httpx',
    docsUrl: 'https://ai.pydantic.dev/',
    language: 'python',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `import httpx
from pydantic_ai import Agent, RunContext

agent = Agent('openai:gpt-4o', system_prompt='Research web pages accurately with citations.')

@agent.tool
async def scrape_web_page(ctx: RunContext[None], url: str = "${targetUrl}") -> str:
    """Scrape a web page into clean Markdown and RAG chunks via crawl.cheap."""
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            "${apiUrl}/v2/scrape",
            headers={"Authorization": "Bearer ${apiKey}"},
            json={"url": url, "formats": ["markdown", "summary"]},
        )
        data = r.json().get("data", {})
        return data.get("markdown", "")`,
  },
  {
    id: 'openai-agents-sdk',
    name: 'OpenAI Agents SDK (@function_tool)',
    category: 'ai-frameworks',
    categoryLabel: 'AI Frameworks',
    tagline: 'Drop-in @function_tool for OpenAI Agents SDK multi-agent handoffs.',
    packageOrProtocol: 'openai-agents · @openai/agents',
    docsUrl: 'https://openai.github.io/openai-agents-python/',
    language: 'python',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `import requests
from agents import Agent, function_tool

@function_tool
def crawl_cheap_scrape(url: str = "${targetUrl}") -> str:
    """Fetch clean LLM-ready Markdown and metadata for any URL."""
    res = requests.post(
        "${apiUrl}/v2/scrape",
        headers={"Authorization": "Bearer ${apiKey}"},
        json={"url": url, "formats": ["markdown", "summary"]},
        timeout=20,
    )
    return res.json().get("data", {}).get("markdown", "")

research_agent = Agent(name="WebResearcher", tools=[crawl_cheap_scrape])`,
  },
  {
    id: 'haystack',
    name: 'Deepset Haystack RAG Component',
    category: 'ai-frameworks',
    categoryLabel: 'AI Frameworks',
    tagline: 'Custom @component returning Haystack Document objects with JSON-LD metadata.',
    packageOrProtocol: 'haystack-ai · Document',
    docsUrl: 'https://docs.haystack.deepset.ai/',
    language: 'python',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `import requests
from haystack import component, Document

@component
class CrawlCheapConverter:
    @component.output_types(documents=list[Document])
    def run(self, urls: list[str] = ["${targetUrl}"]):
        docs = []
        for u in urls:
            r = requests.post(
                "${apiUrl}/v2/chunk",
                headers={"Authorization": "Bearer ${apiKey}"},
                json={"url": u, "maxTokens": 400},
            ).json()
            for chk in r.get("chunks", []):
                docs.append(Document(content=chk["text"], meta={"url": u, "section": chk["heading"]}))
        return {"documents": docs}`,
  },
  {
    id: 'semantic-kernel',
    name: 'Microsoft Semantic Kernel Plugin',
    category: 'ai-frameworks',
    categoryLabel: 'AI Frameworks',
    tagline: 'Enterprise @kernel_function plugin for Python and .NET Semantic Kernel planners.',
    packageOrProtocol: 'semantic-kernel · kernel_function',
    docsUrl: 'https://learn.microsoft.com/en-us/semantic-kernel/',
    language: 'python',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `import requests
from semantic_kernel.functions import kernel_function

class CrawlCheapPlugin:
    @kernel_function(name="scrape_url", description="Scrape a URL into clean Markdown")
    def scrape_url(self, url: str = "${targetUrl}") -> str:
        r = requests.post(
            "${apiUrl}/v2/scrape",
            headers={"Authorization": "Bearer ${apiKey}"},
            json={"url": url, "formats": ["markdown"]},
        )
        return r.json().get("data", {}).get("markdown", "")`,
  },
  {
    id: 'obsidian-clipper',
    name: 'Obsidian Local Markdown Vault Clipper',
    category: 'productivity-local',
    categoryLabel: 'Productivity & Local',
    tagline: 'Clip any URL directly into your Obsidian Vault with YAML frontmatter & citations.',
    packageOrProtocol: 'Obsidian QuickAdd / Templater Userscript',
    docsUrl: 'https://obsidian.md/',
    language: 'typescript',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `// Obsidian QuickAdd / Templater User Script (save as clip-with-crawlcheap.js)
module.exports = async (params) => {
  const url = await params.quickAddApi.inputPrompt('URL to clip into Obsidian:', '${targetUrl}');
  if (!url) return;
  const res = await fetch('${apiUrl}/v2/scrape', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ${apiKey}', 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['markdown', 'summary'] }),
  });
  const { data } = await res.json();
  return \`---\\nsource: "\${url}"\\ntitle: "\${data?.title || url}"\\nclipped_at: "\${new Date().toISOString()}"\\n---\\n\\n> \${data?.summary || ''}\\n\\n\${data?.markdown || ''}\`;
};`,
  },
  {
    id: 'raycast-extension',
    name: 'Raycast macOS Command Palette Script',
    category: 'productivity-local',
    categoryLabel: 'Productivity & Local',
    tagline: 'Scrape any URL from your macOS clipboard into clean Markdown in 1 keystroke.',
    packageOrProtocol: 'Raycast Script Command (@raycast.mode compact)',
    docsUrl: 'https://www.raycast.com/',
    language: 'bash',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Scrape URL to Markdown (crawl.cheap)
# @raycast.mode compact
# @raycast.packageName crawl.cheap
# @raycast.argument1 { "type": "text", "placeholder": "${targetUrl}", "optional": true }

TARGET="\${1:-\$(pbpaste)}"
curl -s -X POST "${apiUrl}/v2/scrape" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d "{\\"url\\":\\"\$TARGET\\",\\"formats\\":[\\"markdown\\"]}" \\
  | jq -r '.data.markdown' | pbcopy
echo "Copied clean Markdown for \$TARGET to clipboard"`,
  },
  {
    id: 'cli-bookmarklet',
    name: '1-Line Shell CLI & Browser Bookmarklet',
    category: 'productivity-local',
    categoryLabel: 'Productivity & Local',
    tagline: 'Add crawlcheap() to ~/.zshrc or drag the 1-click Bookmarklet to your browser bar.',
    packageOrProtocol: 'zsh / bash CLI + javascript: Bookmarklet',
    docsUrl: 'https://crawl.cheap/app/#playground',
    deepLinkUrl: `https://crawl.cheap/app/?url=${encodeURIComponent('https://example.com')}&ep=scrape#playground`,
    language: 'bash',
    buildSnippet: ({ apiKey, apiUrl, targetUrl }) =>
      `# 1. Shell Function (add to ~/.zshrc or ~/.bashrc):
crawlcheap() {
  curl -s -X POST "${apiUrl}/v2/scrape" \\
    -H "Authorization: Bearer ${apiKey}" \\
    -H "Content-Type: application/json" \\
    -d "{\\"url\\":\\"\${1:-${targetUrl}}\\",\\"formats\\":[\\"markdown\\",\\"chunks\\"]}" | jq .
}

# 2. Browser Bookmarklet (drag or save as bookmark URL):
javascript:void(window.open('https://crawl.cheap/app/?url='+encodeURIComponent(location.href)+'&ep=scrape#playground'))`,
  },
] as const;

export function buildMcpServerCard(opts: { apiOrigin: string; mcpOrigin: string }) {
  return {
    $schema: 'https://modelcontextprotocol.io/schemas/server-card/v1.0',
    version: '1.0',
    protocolVersion: '2025-06-18',
    serverInfo: {
      name: 'crawl.cheap',
      title: 'crawl.cheap — Firecrawl-Compatible Cloudflare Edge Web Data & AI Engine',
      version: '1.0.0',
      description:
        'All 30 pinned firecrawl_* MCP tools (scrape, crawl, map, search, extract, parse, agent, interact, monitor) over Streamable-HTTP with OAuth 2.1 PKCE S256.',
      homepage: 'https://crawl.cheap',
      documentation:
        'https://crawl.cheap/blog/oauth-2-1-pkce-and-30-tool-mcp-servers-on-cloudflare-workers/',
    },
    toolsCount: 30,
    listableToolsCount: 28,
    endpoints: [
      {
        profile: 'full',
        url: `${opts.mcpOrigin}/v2/mcp`,
        transport: 'streamable-http',
        capabilities: ['tools', 'resources', 'prompts'],
        toolsCount: 28,
        auth: {
          type: 'oauth2',
          authorization_server: opts.apiOrigin,
          protected_resource_metadata: `${opts.mcpOrigin}/.well-known/oauth-protected-resource`,
          pkce: 'S256',
          dynamic_client_registration: `${opts.apiOrigin}/register`,
          bearer_prefixes: ['fc-', 'cc_live_'],
        },
      },
      {
        profile: 'search',
        url: `${opts.mcpOrigin}/v2/mcp-search`,
        transport: 'streamable-http',
        capabilities: ['tools'],
        toolsCount: 9,
      },
      {
        profile: 'keyless',
        url: `${opts.mcpOrigin}/v2/mcp-keyless`,
        transport: 'streamable-http',
        capabilities: ['tools'],
        toolsCount: 3,
      },
    ],
    deepLinks: {
      cursor:
        'cursor://anysphere.cursor-deeplink/mcp/install?name=crawl-cheap&config=eyJ1cmwiOiJodHRwczovL21jcC5jcmF3bC5jaGVhcC92Mi9tY3AifQ==',
      vscode:
        'vscode:mcp/install?%7B%22name%22%3A%22crawl-cheap%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.crawl.cheap%2Fv2%2Fmcp%22%7D',
      claudeCli: 'claude mcp add --transport http crawl-cheap https://mcp.crawl.cheap/v2/mcp',
    },
  };
}

export function buildOpenApi31Spec(apiOrigin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'crawl.cheap API (Firecrawl v1 & v2 Compatible)',
      version: '2.0.0',
      description:
        'Cloudflare-native, 100% Firecrawl v1 (23 ops) and v2 (57 ops) backwards-compatible web data API at 50% of Firecrawl core plan rates.',
      contact: {
        name: 'crawl.cheap Engineering',
        url: 'https://crawl.cheap',
      },
    },
    servers: [{ url: apiOrigin, description: 'Cloudflare Workers Production Edge API' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Use a crawl.cheap API key (fc-... or cc_live_...) or OAuth 2.1 access token.',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/v2/scrape': {
        post: {
          operationId: 'scrapeUrl',
          summary:
            'Scrape a single URL into Markdown, JSON, Summary, Links, Branding, or Screenshot',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    formats: { type: 'array', items: { type: 'string' } },
                    onlyMainContent: { type: 'boolean', default: true },
                    removeBase64Images: { type: 'boolean', default: true },
                    redactPII: { type: 'boolean', default: false },
                    lockdown: { type: 'boolean', default: false },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Scraped document envelope' } },
        },
      },
      '/v2/crawl': {
        post: {
          operationId: 'startCrawl',
          summary:
            'Start an asynchronous multi-page crawl coordinated by Cloudflare Durable Objects',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    limit: { type: 'integer', default: 10 },
                    prompt: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Crawl job ID and WebSocket watcher URL' } },
        },
      },
      '/v2/map': {
        post: {
          operationId: 'mapSiteUrls',
          summary: 'Discover and rank all URLs on a website via sitemaps and link discovery',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    search: { type: 'string' },
                    limit: { type: 'integer', default: 100 },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Discovered links array' } },
        },
      },
      '/v2/search': {
        post: {
          operationId: 'searchWeb',
          summary: 'Search web, news, and images with optional live page scraping',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['query'],
                  properties: {
                    query: { type: 'string' },
                    limit: { type: 'integer', default: 5 },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Search results' } },
        },
      },
      '/v2/extract': {
        post: {
          operationId: 'extractStructuredData',
          summary: 'Extract structured JSON across URLs using Workers AI and JSON Schema',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    urls: { type: 'array', items: { type: 'string' } },
                    prompt: { type: 'string' },
                    schema: { type: 'object' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Extraction job result' } },
        },
      },
      '/v2/parse': {
        post: {
          operationId: 'parseDocument',
          summary: 'Convert PDF, DOCX, XLSX, PPTX, ODT, ODS, CSV, HTML, TXT, or Images to Markdown',
          responses: { '200': { description: 'Parsed Markdown document' } },
        },
      },
      '/v2/agent': {
        post: {
          operationId: 'runResearchAgent',
          summary: 'Run a multi-turn autonomous web research & synthesis agent',
          responses: { '200': { description: 'Agent job & trace' } },
        },
      },
    },
  };
}

export function buildLlmsTxt(full = false): string {
  const header = `# crawl.cheap — The Web Data Engine for AI (Firecrawl v1 & v2 Compatible · Cloudflare Workers)

> Open-source, Cloudflare-native web data platform speaking 100% of the Firecrawl v2 (57 operations) and v1 (23 operations) API contract at 50% of Firecrawl's core monthly plan price. Powered by Cloudflare Browser Rendering \`/crawl\`, "Markdown for Agents" (\`Accept: text/markdown\`), \`env.AI.toMarkdown()\`, Hibernatable WebSocket Durable Objects, D1, R2, Vectorize, Better Auth OAuth 2.1 PKCE S256, and the 28-library \`@theme.tools/*\` ecosystem.

## Core Endpoints & Discovery
- Production Web & Studio: https://crawl.cheap (Dashboard: https://crawl.cheap/app/)
- Production API Base URL: https://api.crawl.cheap
- Remote MCP Server (30 Tools, Streamable-HTTP): https://mcp.crawl.cheap/v2/mcp
- MCP Server Discovery Card: https://api.crawl.cheap/.well-known/mcp.json
- OpenAPI 3.1 Specification: https://api.crawl.cheap/openapi.json
- OAuth 2.1 Authorization Server Metadata: https://api.crawl.cheap/.well-known/oauth-authorization-server
- Ecosystems & Plugins Registry: https://api.crawl.cheap/v2/integrations
- @theme.tools 28-Library Catalog Manifest: https://api.crawl.cheap/v2/catalog

## Architecture & Engineering Guides (/blog/)
- [Edge Web Scraping for AI Agents](https://crawl.cheap/blog/edge-web-scraping-for-ai-agents/): Sub-45ms edge TTFB, three-tier planner, and Markdown for Agents.
- [Cloudflare Browser Rendering /crawl & Durable Objects](https://crawl.cheap/blog/cloudflare-browser-rendering-crawl-and-durable-objects/): Hibernatable WebSockets and HMAC-SHA256 lifecycle webhooks.
- [OAuth 2.1 PKCE S256 & 30-Tool Remote MCP Server](https://crawl.cheap/blog/oauth-2-1-pkce-and-30-tool-mcp-servers-on-cloudflare-workers/): Better Auth social login, Dynamic Client Registration, and Streamable-HTTP MCP.
- [11-Format Multimodal Document Parsing & Autonomous Browser Co-Pilots](https://crawl.cheap/blog/multimodal-document-parsing-and-autonomous-browser-copilots/): Workers AI toMarkdown(), Vectorize RAG, and persistent Puppeteer sessions.
`;
  if (!full) return header;

  const integrationsSummary = ECOSYSTEM_INTEGRATIONS.map(
    (item) =>
      `### ${item.name} (\`${item.id}\` — ${item.categoryLabel})\n- Package/Protocol: \`${item.packageOrProtocol}\`\n- Summary: ${item.tagline}\n\`\`\`${item.language}\n${item.buildSnippet(
        {
          apiKey: 'fc-YOUR_API_KEY',
          apiUrl: 'https://api.crawl.cheap',
          mcpUrl: 'https://mcp.crawl.cheap',
          targetUrl: 'https://example.com',
        },
      )}\n\`\`\``,
  ).join('\n\n');

  return `${header}\n## Complete Ecosystem Integrations & Plugins (${ECOSYSTEM_INTEGRATIONS.length})\n\n${integrationsSummary}\n\n## Bound @theme.tools Libraries (${THEME_TOOLS_CATALOG_MANIFEST.boundPackages.length})\n${THEME_TOOLS_CATALOG_MANIFEST.boundPackages.map((p) => `- \`${p}\``).join('\n')}\n`;
}

const route = new Hono<{ Bindings: Env; Variables: Vars }>();

const listIntegrationsHandler = (c: {
  req: { url: string; query: (k: string) => string | undefined };
  json: (b: unknown) => Response;
}) => {
  const category = c.req.query('category');
  const apiUrl = 'https://api.crawl.cheap';
  const mcpUrl = 'https://mcp.crawl.cheap';
  const apiKey = c.req.query('apiKey') || 'fc-YOUR_API_KEY';
  const targetUrl = c.req.query('url') || 'https://example.com';

  const items = ECOSYSTEM_INTEGRATIONS.filter(
    (item) => !category || category === 'all' || item.category === category,
  ).map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    categoryLabel: item.categoryLabel,
    tagline: item.tagline,
    packageOrProtocol: item.packageOrProtocol,
    docsUrl: item.docsUrl,
    deepLinkUrl: item.deepLinkUrl ?? null,
    language: item.language,
    snippet: item.buildSnippet({ apiKey, apiUrl, mcpUrl, targetUrl }),
  }));

  return c.json({
    success: true as const,
    total: items.length,
    categories: [
      { id: 'all', label: 'All Integrations & Plugins', count: ECOSYSTEM_INTEGRATIONS.length },
      { id: 'ai-frameworks', label: 'AI Frameworks', count: 9 },
      { id: 'mcp-ides', label: 'MCP & Agentic IDEs', count: 3 },
      { id: 'workflow-builders', label: 'Workflow Builders', count: 3 },
      { id: 'productivity-local', label: 'Productivity & Local', count: 3 },
      { id: 'edge-cicd', label: 'Edge & CI/CD', count: 2 },
    ],
    integrations: items,
    plugins: items,
  });
};

route.get('/integrations', listIntegrationsHandler);
route.get('/plugins', listIntegrationsHandler);

route.post('/integrations/:id/config', async (c) => {
  const id = c.req.param('id').toLowerCase();
  const spec = ECOSYSTEM_INTEGRATIONS.find((x) => x.id === id);
  if (!spec) {
    return c.json(
      {
        success: false,
        error: `Unknown integration '${id}'. Available: ${ECOSYSTEM_INTEGRATIONS.map((x) => x.id).join(', ')}`,
        code: 'BAD_REQUEST',
      },
      404,
    );
  }
  const parsed = await parseBody(
    c,
    z.object({
      apiKey: z.string().optional(),
      targetUrl: z.string().optional(),
      apiUrl: z.string().optional(),
      mcpUrl: z.string().optional(),
    }),
  );
  const body = parsed.ok ? parsed.data : {};
  const p = c.get('principal');
  const apiKey = body.apiKey?.trim() || p?.key || 'fc-YOUR_API_KEY';
  const apiUrl = body.apiUrl?.trim() || 'https://api.crawl.cheap';
  const mcpUrl = body.mcpUrl?.trim() || 'https://mcp.crawl.cheap';
  const targetUrl = body.targetUrl?.trim() || 'https://example.com';

  return c.json({
    success: true as const,
    integration: {
      id: spec.id,
      name: spec.name,
      category: spec.category,
      categoryLabel: spec.categoryLabel,
      packageOrProtocol: spec.packageOrProtocol,
      language: spec.language,
      deepLinkUrl: spec.deepLinkUrl ?? null,
      snippet: spec.buildSnippet({ apiKey, apiUrl, mcpUrl, targetUrl }),
    },
  });
});

export function buildA2aAgentCard(apiOrigin = 'https://api.crawl.cheap') {
  return {
    protocolVersion: '1.0.0',
    name: 'crawl.cheap',
    description:
      'Cloudflare-native, 100% Firecrawl v1/v2 compatible autonomous web-data, recursive RAG chunking, and deep research agent.',
    version: '2.0.0',
    url: `${apiOrigin}/a2a/v1`,
    provider: {
      organization: 'crawl.cheap',
      url: 'https://crawl.cheap',
    },
    supportedInterfaces: [
      {
        url: `${apiOrigin}/a2a/v1`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
      {
        url: 'https://mcp.crawl.cheap/v2/mcp',
        protocolBinding: 'MCP_STREAMABLE_HTTP',
        protocolVersion: '2025-06-18',
      },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/markdown', 'application/json'],
    skills: [
      {
        id: 'web_scrape',
        name: 'Scrape Web Page to Markdown, JSON-LD & Chunks',
        description:
          'Scrape any URL into clean Markdown, structured JSON, Brand Kit, or recursive RAG chunks via POST /v2/scrape.',
        tags: ['scrape', 'markdown', 'rag', 'json-ld'],
      },
      {
        id: 'site_crawl',
        name: 'Distributed Multi-Page Crawl with WebSocket Watcher',
        description:
          'Crawl websites asynchronously via Cloudflare Browser Rendering /crawl and Hibernatable Durable Objects.',
        tags: ['crawl', 'websocket', 'webhooks'],
      },
      {
        id: 'site_map',
        name: 'Sitemap & Link Discovery',
        description: 'Enumerate and rank all URLs on a domain via POST /v2/map.',
        tags: ['map', 'sitemap'],
      },
      {
        id: 'web_search',
        name: 'Web, News & Image Search with Live Scrape',
        description: 'Search the live web with optional content extraction via POST /v2/search.',
        tags: ['search', 'news', 'images'],
      },
      {
        id: 'structured_extract',
        name: 'Schema-Guided AI Extraction',
        description: 'Extract structured JSON across URLs using Workers AI and JSON Schema.',
        tags: ['extract', 'json-schema'],
      },
      {
        id: 'document_parse',
        name: '11-Format Document Parsing',
        description:
          'Convert PDF, DOCX, XLSX, PPTX, ODT, ODS, CSV, HTML, TXT, or Images to Markdown via env.AI.toMarkdown().',
        tags: ['parse', 'pdf', 'docx'],
      },
      {
        id: 'deep_research',
        name: 'Multi-Turn Autonomous Deep Research & llms.txt Generator',
        description: 'Run multi-step web research with citation verification via POST /v2/agent.',
        tags: ['research', 'agent', 'llmstxt'],
      },
      {
        id: 'rag_chunk',
        name: 'Structure-Aware Recursive Markdown Chunker & AutoRAG',
        description:
          'Split Markdown along heading boundaries into 256-512 token chunks with JSON-LD metadata and Vectorize bge-base-en-v1.5 embeddings.',
        tags: ['chunking', 'autorag', 'vectorize'],
      },
    ],
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Use an fc- or cc_live_ API key or OAuth 2.1 access token.',
      },
      oauth2: {
        type: 'oauth2',
        authorizationServerMetadata: `${apiOrigin}/.well-known/oauth-authorization-server`,
      },
    },
  };
}

route.get('/.well-known/mcp.json', (c) => {
  return c.json(
    buildMcpServerCard({
      apiOrigin: 'https://api.crawl.cheap',
      mcpOrigin: 'https://mcp.crawl.cheap',
    }),
  );
});

const a2aCardHandler = () => buildA2aAgentCard('https://api.crawl.cheap');

route.get('/.well-known/agent-card.json', (c) => c.json(a2aCardHandler()));
route.get('/.well-known/agent.json', (c) => c.json(a2aCardHandler()));

route.get('/a2a/v1', (c) => c.json(a2aCardHandler()));

route.post('/a2a/v1', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  } | null;

  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return c.json(
      {
        jsonrpc: '2.0',
        id: body?.id ?? null,
        error: { code: -32600, message: 'Invalid A2A JSON-RPC 2.0 Request' },
      },
      400,
    );
  }

  const taskId = String((body.params as { id?: string })?.id ?? `a2a_task_${crypto.randomUUID()}`);

  if (body.method === 'agent/authenticatedExtendedCard') {
    return c.json({
      jsonrpc: '2.0',
      id: body.id ?? null,
      result: a2aCardHandler(),
    });
  }

  if (body.method === 'tasks/cancel') {
    return c.json({
      jsonrpc: '2.0',
      id: body.id ?? null,
      result: {
        id: taskId,
        status: { state: 'canceled', timestamp: new Date().toISOString() },
      },
    });
  }

  if (body.method === 'tasks/get') {
    return c.json({
      jsonrpc: '2.0',
      id: body.id ?? null,
      result: {
        id: taskId,
        status: { state: 'completed', timestamp: new Date().toISOString() },
        artifacts: [
          {
            name: 'markdown-output',
            parts: [{ type: 'text', text: '# A2A Task Completed via crawl.cheap' }],
          },
        ],
      },
    });
  }

  if (body.method === 'tasks/send' || body.method === 'message/send') {
    const msg = (body.params as { message?: { parts?: Array<{ text?: string }> } })?.message;
    const promptText =
      msg?.parts
        ?.map((p) => p.text || '')
        .join(' ')
        .trim() || 'Scrape https://example.com';
    return c.json({
      jsonrpc: '2.0',
      id: body.id ?? null,
      result: {
        id: taskId,
        status: { state: 'completed', timestamp: new Date().toISOString() },
        artifacts: [
          {
            name: 'crawl-cheap-synthesis',
            parts: [
              {
                type: 'text',
                text: `Executed A2A skill for: "${promptText}" on crawl.cheap Cloudflare Workers edge.`,
              },
            ],
          },
        ],
      },
    });
  }

  return c.json(
    {
      jsonrpc: '2.0',
      id: body.id ?? null,
      error: { code: -32601, message: `Unsupported A2A method: ${body.method}` },
    },
    404,
  );
});

route.get('/.well-known/ai-plugin.json', (c) => {
  return c.json({
    schema_version: 'v1',
    name_for_human: 'crawl.cheap Web Data & AI Engine',
    name_for_model: 'crawl_cheap',
    description_for_human:
      '100% Firecrawl v1/v2 compatible web scraping, crawling, mapping, search, document parsing, and browser automation on Cloudflare Workers.',
    description_for_model:
      'Use crawl_cheap to scrape web pages into clean Markdown or structured JSON, crawl documentation sites, map URLs, search the web, or parse PDFs/DOCX/XLSX.',
    auth: {
      type: 'service_http',
      authorization_type: 'bearer',
    },
    api: {
      type: 'openapi',
      url: 'https://api.crawl.cheap/openapi.json',
    },
    logo_url: 'https://crawl.cheap/assets/crawl-cheap-icon.png',
    contact_email: 'support@crawl.cheap',
    legal_info_url: 'https://crawl.cheap',
  });
});

route.get('/openapi.json', (c) => {
  return c.json(buildOpenApi31Spec('https://api.crawl.cheap'));
});

route.get('/llms.txt', (c) => {
  const txt = buildLlmsTxt(false);
  return c.text(txt, 200, {
    'content-type': 'text/plain; charset=utf-8',
    'x-markdown-tokens': String(Math.ceil(txt.length / 4)),
    'cache-control': 'public, max-age=3600',
  });
});

route.get('/llms-full.txt', (c) => {
  const txt = buildLlmsTxt(true);
  return c.text(txt, 200, {
    'content-type': 'text/plain; charset=utf-8',
    'x-markdown-tokens': String(Math.ceil(txt.length / 4)),
    'cache-control': 'public, max-age=3600',
  });
});

export default route;
