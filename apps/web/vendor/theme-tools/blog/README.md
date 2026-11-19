# `@theme.tools/blog`

> **ArticleDocument v1.0.0, Plate Studio & 100 Editorial Components** (core-workspace · layer: `engines`)

Lossless Plate <-> ArticleDocument v1.0.0 serialization, citation/media/data validators, and 20 article fixtures.

## Narrow Entry Points

- `@theme.tools/blog/contracts` — Pure TypeScript contracts, schemas, and event descriptors (zero DOM/Worker globals).
- `@theme.tools/blog/core` — Deterministic domain state machines and validation logic.
- `@theme.tools/blog/cloudflare` — Cloudflare Workers / Hono route descriptors and binding requirements (D1, R2, KV).
- `@theme.tools/blog/react` — React 19 surface descriptors (`UniversalArticleReader`).
- `@theme.tools/blog/elements` — Custom Element registration (`<tt-article-reader>`).
- `@theme.tools/blog/testing` — Deterministic conformance suite and test fixtures.
