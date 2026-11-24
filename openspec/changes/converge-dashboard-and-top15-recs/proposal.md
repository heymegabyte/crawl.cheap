# Converge Universal Mega-Menu Navbar, Firecrawl Admin Dashboard & Top-15 Studio Enhancements

**Architect:** antigravity  
**Architect Role:** assigned

## Why

Following the Desktop video review and recursive Top-15 convergence loop, `crawl.cheap` needed:

1. A consolidated, two-column `Explore & Guides` Mega-Menu across `/`, `/blog/*`, and `/app/` with text-free graphic preview SVGs (`/assets/previews/*.svg`) and non-overlapping `position: static` caption footers.
2. An emoji-free visual standard across both `/app/` and `/` using crisp 16×16 monochrome SVG line icons and updated capability stats (`57` v2 / `23` v1 API ops, `30` MCP tools).
3. A single-view, URL-hash-routed Firecrawl Admin Dashboard (`/app/#overview`, `#playground`, `#research`, `#copilot`, `#activity`, `#usage`, `#keys`, `#settings`) with a `⌘K` Command Palette, WebSocket Crawl Watcher integration, multi-language SDK snippet filter, Activity Log JSON/CSV export + row inspector, Profile & Avatar Customizer (`POST /api/auth/profile`), Scheduled Monitors table, and self-describing auth provider discovery (`GET /api/auth/providers`).

## What Changes

- **Backend (`apps/api`)**:
  - `GET /api/auth/providers` & `GET /api/auth/oauth/providers`: Self-describing auth provider registry (`google`, `github`, `magic-link`, `email-password`, `oauth21-pkce-s256`, `api-key`).
  - `GET /api/auth/profile` & `POST /api/auth/profile`: Live D1 + memory profile and avatar update endpoint returning derived initials.
  - `POST /api/auth/api-key/revoke`: Unified `{ success: true, revoked: true, keyId }` response envelope.
  - `GET /v2/concurrency-check`: Includes `data: { active, concurrency, maxConcurrency }` alongside top-level Firecrawl v2 fields.
- **Frontend (`apps/web`)**:
  - Consolidated 11-item 2-column `Explore & Guides` Mega-Menu with text-free preview SVGs.
  - Emoji-free monochrome 16×16 SVG line icons across both `/app/` and `/`.
  - Bidirectional URL hash routing, `⌘K` Command Palette, multi-language Playground code selector + Copy/Download + WebSocket crawl watcher, Activity Logs search/export/inspector, Profile & Avatar editor, and Scheduled Monitors management table.
