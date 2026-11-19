// Generate the AI-discovery corpus (llms-full.txt) for crawl.cheap by CONSUMING the
// @theme.tools/seo-geo engine (vendored, zero workspace deps — see ../vendor/theme-tools-seo-geo).
//
// `buildLlmsDiscoveryCorpus` emits the structured llms.txt / llms-full.txt spec. The existing
// hand-written public/llms.txt is kept as the canonical short index; this script adds the
// long-form public/llms-full.txt (full markdown bodies) that the short index points at.
//
// Run: node scripts/gen-seo.mjs   (no network, no AI, no secrets — deterministic)
import { buildLlmsDiscoveryCorpus } from '../vendor/theme-tools-seo-geo/builders.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

const { llmsFullTxt } = buildLlmsDiscoveryCorpus({
  siteTitle: 'crawl.cheap',
  blockquoteSummary:
    'Open-source, Cloudflare-native web data engine that speaks the Firecrawl v2 API. Scrape, crawl, map, search, extract, parse, run AI Search (RAG) and persistent interactive browser sessions — at roughly half Firecrawl’s price. Point an existing Firecrawl client at crawl.cheap and keep your code.',
  architecturalNotes: [
    'MIT-licensed; self-hostable on your own Cloudflare account with no dependency on crawl.cheap.',
    'Firecrawl v2 compatibility = change the base URL + swap in a crawl.cheap `cc_` key; request/response business logic is unchanged.',
    'One Cloudflare Worker terminates the REST API; a second serves the marketing site + remote MCP.',
  ],
  sections: [
    {
      heading: 'API',
      entries: [
        {
          title: 'Firecrawl v2-compatible REST API',
          url: 'https://api.crawl.cheap',
          summary:
            'POST /v2/scrape, /map, /crawl, /batch/scrape, /search, /extract, /parse, /agent, /monitor, /browser, /ai-search.',
          fullMarkdownBody:
            '## Firecrawl v2-compatible REST API\n\n' +
            'Base URL `https://api.crawl.cheap`. Every endpoint mirrors the Firecrawl v2 request/response contract, so an existing Firecrawl client works after changing only the base URL and the API key (use a crawl.cheap `cc_` key, never a Firecrawl `fc-` key).\n\n' +
            '- `POST /v2/scrape` — fetch one URL as clean markdown / HTML / links / screenshot.\n' +
            '- `POST /v2/map` — enumerate a site’s URLs from sitemaps + link discovery.\n' +
            '- `POST /v2/crawl` — recursively crawl a site with include/exclude rules.\n' +
            '- `POST /v2/batch/scrape` — scrape many URLs in one job.\n' +
            '- `POST /v2/search` — web / news / images search with `tbs` time filters.\n' +
            '- `POST /v2/extract` — structured JSON extraction against a schema.\n' +
            '- `POST /v2/parse` — parse an already-fetched document.\n' +
            '- `POST /v2/agent` — autonomous multi-step research.\n' +
            '- `POST /v2/monitor` — scheduled change detection.\n' +
            '- `POST /v2/browser` — persistent interactive browser sessions.\n' +
            '- `POST /v2/ai-search` — semantic RAG over crawled content.',
        },
        {
          title: 'Remote MCP server',
          url: 'https://crawl-cheap-mcp.manhattan.workers.dev/v2/mcp',
          summary:
            'Stateless Streamable-HTTP JSON-RPC exposing firecrawl_* tools (scrape/map/crawl/search/agent/monitor/research).',
          fullMarkdownBody:
            '## Remote MCP server\n\n' +
            'A stateless Streamable-HTTP JSON-RPC MCP endpoint at `https://crawl-cheap-mcp.manhattan.workers.dev/v2/mcp`. It exposes `firecrawl_*` tools (scrape, map, crawl, search, agent, monitor, research) so an MCP-capable agent can use crawl.cheap directly as a first-class tool provider.',
        },
      ],
    },
    {
      heading: 'Docs',
      entries: [
        {
          title: 'README + quickstart',
          url: 'https://github.com/heymegabyte/crawl.cheap',
          summary: 'Install, quickstart, and the full endpoint reference.',
        },
        {
          title: 'Firecrawl compatibility',
          url: 'https://github.com/heymegabyte/crawl.cheap/blob/main/docs/firecrawl-compatibility.md',
          summary: 'Exactly which Firecrawl v2 behaviours are mirrored and how to migrate.',
        },
        {
          title: 'Self-hosting',
          url: 'https://github.com/heymegabyte/crawl.cheap/blob/main/deploy/README.md',
          summary: 'Deploy crawl.cheap to your own Cloudflare account with no dependency on us.',
        },
      ],
    },
  ],
});

writeFileSync(join(publicDir, 'llms-full.txt'), llmsFullTxt, 'utf8');
process.stdout.write(`llms-full.txt written (${llmsFullTxt.length} bytes)\n`);
