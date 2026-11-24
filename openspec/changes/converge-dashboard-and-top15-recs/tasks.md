# Tasks: Converge Dashboard & Top-15 Studio Enhancements

- [x] 1. Consolidate top navbar into expanded 2-column `Explore & Guides` Mega-Menu with 11 text-free preview SVGs and non-overlapping static captions.
- [x] 2. Simplify `/app/` into a focused single-view dashboard (`Overview`, `Playground`, `Extract & Research`, `Browser Sandbox`, `Activity Logs`, `Usage & Billing`, `API Keys`, `Settings`) with monochrome SVG icons and zero emojis.
- [x] 3. Replace all 14 bento tile emojis on `/` with monochrome SVG icons, update hero stats (`57` v2 / `23` v1 ops, `30` MCP tools), and align `#estimator` anchor ID with Mega-Menu.
- [x] 4. Add `GET /api/auth/providers`, `GET/POST /api/auth/profile`, unified `POST /api/auth/api-key/revoke` (`revoked: true`), and `GET /v2/concurrency-check` (`data.active`).
- [x] 5. Implement URL hash deep-linking, `⌘K` Command Palette, Playground language filter + Copy/Download + WebSocket Watcher, Activity Logs search + JSON/CSV export + row inspector, Profile/Avatar editor, and Scheduled Monitors table.
- [x] 6. Implement 20-Plugin Ecosystem Integrations Registry (`/v2/integrations`, `/v2/plugins`, `POST /v2/integrations/:id/config`), `/.well-known/mcp.json`, Linux Foundation A2A v1.0 `/.well-known/agent-card.json` (`/.well-known/agent.json`, `POST /a2a/v1`), `/.well-known/ai-plugin.json`, `/openapi.json`, `/llms.txt`, `/llms-full.txt`, 28-library `@theme.tools/catalog` binding, `lockdown: true` cache mode, structured `redactPII` entity redaction, structure-aware RAG Markdown chunker (`POST /v2/chunk`, `formats: ['chunks', 'jsonLd']`), and Cloudflare AutoRAG (`POST /v2/autorag/ingest`, `POST /v2/autorag/query`).
- [x] 7. Verify with Vitest (`89/89`) and real-browser CDP E2E (`46/46`) across all 6 breakpoints (`320px`..`1440px`).
