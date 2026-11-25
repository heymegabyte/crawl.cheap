# OpenSpec Technical Design — Streamlined `@theme.tools` 28-Library Thin-Shell (`crawl.cheap`)

## 1. Architecture & Archetype Classification

- **Repository**: `crawl.cheap` (`https://crawl.cheap`)
- **Classified Archetype**: `commercial-field-service-and-client-sites`
- **Runtime Composition Adapter**: `src/theme-tools-thin-shell.ts`
- **Manifest**: `theme.tools.json` (`schemaVersion: 2`)
- **Self-Verification Command**: `node --experimental-strip-types src/theme-tools-thin-shell.ts --verify`

## 2. Discovered Screens, Components, Sections & Routes (`25` Inventoried)

| Relative Path                                    | Canonical `@theme.tools/*` Delegation                                | Visual Convergence Contract |
| :----------------------------------------------- | :------------------------------------------------------------------- | :-------------------------- |
| `packages/contracts/src/account.ts`              | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/contracts/src/actions.ts`              | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/contracts/src/batch.ts`                | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/contracts/src/common.ts`               | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/contracts/src/crawl.ts`                | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/contracts/src/extract.ts`              | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/contracts/src/index.ts`                | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/contracts/src/map.ts`                  | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/contracts/src/pricing.ts`              | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/contracts/src/scrape.ts`               | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/contracts/src/search.ts`               | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/contracts/src/webhook.ts`              | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/contracts/test/pricing.test.ts`        | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/contracts/test/scrape-formats.test.ts` | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/engine/src/browser.ts`                 | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/engine/src/catalog-manifest.ts`        | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/engine/src/cf-crawl.ts`                | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/engine/src/chunker.ts`                 | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/engine/src/extract-ai.ts`              | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/engine/src/extract-content.ts`         | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/engine/src/fetcher.ts`                 | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/engine/src/html-to-markdown.ts`        | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/engine/src/index.ts`                   | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/engine/src/interact.ts`                | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |
| `packages/engine/src/map.ts`                     | `@theme.tools/ui` / `@theme.tools/blog` / `@theme.tools/media-video` | 16 states (`0.333s` OKLCH)  |

## 3. Cross-Cutting Platform Invariants

1. **VoiceKit `$17,000` Startup Credits Grant**: Replaces ElevenLabs everywhere (`primaryProvider: "voicekit"`, fallback `melotts-workers-ai` -> `piper-local`).
2. **Sovereign 8-Pillar Telemetry**: W3C `traceparent`, GTM Consent Mode v2 default-deny (`gcs=G100`), Langfuse Cloud v4 OTLP with strict `2500ms` `AbortSignal.timeout(2500)` fail-open and 3-strike circuit breaker.
3. **Cloudflare 13-Dimension Free-Tier Edge**: 5 WAF Custom Rules, 1 Rate Limit Rule, 4 Edge Security Headers, 2 Cache Rules, Zstd+Brotli+Gzip Compression Rule, API-Safe Config Rule, Smart Tiered Cache, Bot Fight Mode, Leaked Credentials Check, Page Shield, DNSSEC, URL Normalization (`scope: "both"`), and 25 Zone Settings.
