# Firecrawl Compatibility Matrix

> The honest, top-level status of the drop-in-compatibility contract. Statuses are
> **VERIFIED** (tested against a live client/SDK), **PARTIAL** (works, with a documented
> gap), **NOT IMPLEMENTED** (contracted upstream, not served — honest 501), or
> **N/A** (not applicable to this edition). Detailed evidence + the full field-by-field
> enumeration live in [`firecrawl-compatibility.md`](./firecrawl-compatibility.md).

**Pinned upstream** (re-verify on change): REST `firecrawl/firecrawl@f9f2e3d` · MCP
`firecrawl-mcp-server@ec0f9de` (npm `firecrawl-mcp@3.28.2`, 30 registered / 28 listed) ·
pricing `firecrawl.dev/pricing` — all re-verified **2026-10-09**.

## Machine contract tests (pinned OpenAPI)

The official **v2 + v1 OpenAPI** are now pinned byte-exact in `packages/contracts/upstream/`
(sha256 in `MANIFEST.json`): **v2** = 44 paths / **56 operations** / 65 schemas; **v1** = 21 paths /
**23 operations** / 12 schemas. A dependency-free OpenAPI-3.0 validator (`e2e/contract/run.mjs`) does
two things against the **live** API:

- **Coverage** (routed vs not, method-aware live probe): **v2 28/56** · **v1 2/23** operations SERVED.
  The unserved v2 ops are out-of-scope (`/support/*`, `/team/threat-protection`), Fuego-namespaced
  under different paths (upstream `/interact/*` → Fuego `/v2/browser`; `/search/developer|gov|research`
  → Fuego MCP tools + `/v2/search` categories), or low-priority (`/scrape/{jobId}` async, `/feedback`,
  agent list/trace/snapshots, monitor PATCH). **v1 is intentionally thin** (only `/v1/scrape` +
  `/v1/map` adapters) — tracked as a NEXT item; the official SDKs use v2.
- **Conformance** (live response ⊆ documented 200 schema): **4/4 VERIFIED** — `scrape`, `map`,
  `search`, `team/credit-usage` responses validate against Firecrawl's **own** pinned OpenAPI.

A scheduled CI job (`.github/workflows/contract-drift.yml`) re-fetches upstream weekly and opens a
**reviewable issue** on any sha256 drift — upstream contract changes never silently reach production.
A fetch failure is reported as **INCONCLUSIVE** (fails, opens the issue too), never as "no drift".
`scripts/test/contract-drift.test.mjs` proves the gate in CI with fixtures (match / v2 drift / v1
drift / fetch failure / tampered pin). A second CI step, `scripts/check-delta-disposition.mjs`
(proven by `scripts/test/delta-disposition.test.mjs`), binds every disposition to the full SHA-256
**and** byte length of both documents plus a fingerprint over every classified change
(`packages/contracts/upstream/DELTA_DISPOSITION.json`). Any other baseline/candidate pair — even a
strictly smaller one — fails closed, so a changed spec cannot be re-pinned or merged unclassified.

### Pin identity (re-pin log)

| Version | Retrieved                              | SHA-256                                                            |  Bytes | Delta review                                                       |
| ------- | -------------------------------------- | ------------------------------------------------------------------ | -----: | ------------------------------------------------------------------ |
| v2      | **2026-11-16** (confirmed pin, merged) | `ca3d83a0ff8001f0b2e722e0fc7722e1e4e3b9e0e920a5a6d5ebec33001f2c38` | 490961 | [`FIRECRAWL_DRIFT_2026-11-16.md`](./FIRECRAWL_DRIFT_2026-11-16.md) |
| v2      | 2026-10-27 (superseded)                | `49afc368bf971b2321857409d18ac32915f07abf73596905e97be52b2f397cfb` | 485788 | [`FIRECRAWL_DRIFT_2026-10-27.md`](./FIRECRAWL_DRIFT_2026-10-27.md) |
| v2      | 2026-10-10 (superseded)                | `0541be01504053f8e978b60c6a12dc100cd6a76020f2a2723ecf9411f5778a3b` | 473629 | baseline                                                           |
| v1      | 2026-10-10                             | `d30b8816c05054b596b02d7dc8f39cb186ac79108b03113f3f4c9eee86300781` | 132167 | **unchanged** at the 2026-10-27 re-fetch (same bytes + hash)       |

Contract run for the 2026-10-27 pin (`API=https://api.crawl.cheap node e2e/contract/run.mjs`): **exit 0**,
7/7 gates pass — 4/4 conformance probes, the `attributes` focused probe, and the AC2 status gate
(0 breaks; 9 read-only GETs answer an empty 200, every write probe answers 4xx — no 5xx, no
unrequested 2xx write). Coverage **v2 28/57 · v1 2/23** (identical to the 2026-10-10 run — the re-pin
added no routed-operation expectations). The status gate and its counts are in
`e2e/contract/report.json#statusGate`.

### v2 2026-11-16 pin — approved and merged

Locations: **20** changed · **18** review-class leaf changes · 30 additive · 11 documentation

Confirmed pin: `ca3d83a0ff8001f0b2e722e0fc7722e1e4e3b9e0e920a5a6d5ebec33001f2c38` (490961 B), replacing `49afc368` (485788 B). v1 is unchanged. See [the complete drift review](./FIRECRAWL_DRIFT_2026-11-16.md) and [saved field classification](./evidence/meg-1120/classification.json). This exact transition has 20 locations and 59 leaves; its identity-bound disposition preserves the prior transition.

Specialized support/developer/government/research operations, object search categories, and agent safe filtering are **UNSUPPORTED**. The skipTlsVerification default delta is **KNOWN-UNSUPPORTED**; effective certificate verification remains **UNVERIFIED**. AppSec and Architect approved this pin on 2026-11-16; it merged in PR #3 (merge commit `ddc9517`), and no runtime code changed. Historical pin records below remain provenance.

Contract run on the confirmed pin (`API=https://api.crawl.cheap node e2e/contract/run.mjs`): **exit 0**,
7/7 gates pass — 4/4 conformance probes, the `attributes` focused probe, and the AC2 status gate
(0 status breaks). Coverage **v2 28/56 · v1 2/23**.

### v2 2026-10-27 delta — what changed and how it is served

Full classification is in [`FIRECRAWL_DRIFT_2026-10-27.md`](./FIRECRAWL_DRIFT_2026-10-27.md).
The machine-checked disposition is the next line; `scripts/check-delta-disposition.mjs` (CI:
`contract-drift.yml`) only accepts this exact reviewed baseline→candidate bytes pair and its
classified-change fingerprint, so no upstream change can reach production unclassified.

Locations: **16** changed · **36** review-class leaf changes · 44 additive · 25 documentation

Summary:

| Area                                                                                                       | Change                                                                              | Status here                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attributes` format (`{type:'attributes', selectors[]}` → `data.attributes`)                               | NEW format                                                                          | **VERIFIED (static tier)** — `extractAttributes` in the engine; unit + contract tests. Browser-only renders warn instead of returning an empty array. |
| `parsers` (`"pdf"`/`"image"` names, PDF option object `pages`/`blocks`/`pageMarkers`, default `pdf,image`) | widened schema                                                                      | Contract accepts the exact upstream shape. `pages`/`blocks`/`pageMarkers` are accepted but **not applied** by the document-parse tier (see gaps).     |
| `metadata.language`                                                                                        | `string \| string[] \| null`                                                        | Contract widened + tested (previously rejected arrays/null).                                                                                          |
| `POST /agent` `zeroDataRetention`, `location`                                                              | NEW request fields                                                                  | **NOT IMPLEMENTED** — accepted-then-dropped.                                                                                                          |
| `GET                                                                                                       | POST /search/gov` filters (`jurisdiction`, `court`, `courtType`, `cites`, `domain`) | NEW filters                                                                                                                                           | **NOT IMPLEMENTED** (REST path not routed; MCP `gov_search` unfiltered). |
| `POST /scrape` `toolDetail` · schema `FindToolsData.next` · `AgentTraceEvent.error`                        | additive/type-only                                                                  | No behavior change (proprietary tool contracts not served).                                                                                           |
| `search` `sources` default + `ParseOptions.parsers` default                                                | documentation/representation                                                        | No behavior change.                                                                                                                                   |
| `SearchFeedbackRequest.valuableResults`                                                                    | NEW field                                                                           | **NOT IMPLEMENTED** (`/feedback` is a 501).                                                                                                           |

No breaking delta for any served operation was found; the one real conformance bug the delta exposed
(`metadata.language` rejecting an array or `null`) is fixed.

## SDKs (the operational definition of "drop-in")

| Client                               | Version | How                                     | Status                                       |
| ------------------------------------ | ------- | --------------------------------------- | -------------------------------------------- |
| TypeScript `@mendable/firecrawl-js`  | 4.45.0  | `apiUrl` + fuegol key, code unchanged   | **VERIFIED** 8/8 (`e2e/sdk-compat/test.mjs`) |
| Python `firecrawl-py`                | 4.49.3  | `api_url=` + fuegol key, code unchanged | **VERIFIED** 4/4 (`e2e/sdk-compat/test.py`)  |
| Go / Java / Rust / Ruby / PHP / .NET | —       | REST contract is identical; untested    | NOT VERIFIED (no harness yet)                |

## REST endpoints (prefix `/v2`)

| Family                                                                                  | Status          | Notes                                                                                     |
| --------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `scrape` (markdown/html/links/json/screenshot/actions/changeTracking/attributes/cache)  | **VERIFIED**    | static + browser tier; `removeBase64Images`, `maxAge` live; `attributes` static-tier only |
| `map`                                                                                   | **VERIFIED**    | sitemap + link discovery                                                                  |
| `crawl` (+status/cancel/errors)                                                         | **VERIFIED**    | Durable-Object coordinator, race-safe cancel                                              |
| `batch/scrape` (+status/cancel/errors)                                                  | **VERIFIED**    | reuses the crawl DO                                                                       |
| `search` (web/news/images, `tbs`, categories)                                           | **VERIFIED**    | Exa primary / Tavily fallback                                                             |
| `extract` (+status)                                                                     | **VERIFIED**    | Workers AI, ExtractCoordinator DO                                                         |
| `parse` (PDF/HTML/text)                                                                 | **VERIFIED**    | unpdf; multipart or `{url}`                                                               |
| `agent` (+status)                                                                       | **VERIFIED**    | web-search + scrape + AI synthesis                                                        |
| `monitor` (+run/checks/webhook)                                                         | **VERIFIED**    | cron sweep + change diff + signed alerts                                                  |
| `browser` + `/:id/act` (interact)                                                       | **VERIFIED**    | persistent Puppeteer session, DO-backed                                                   |
| `ai-search/index` · `ai-search/query` (RAG)                                             | **VERIFIED**    | Vectorize + Workers AI (Fuego-exclusive, namespaced)                                      |
| `team/credit-usage` (+historical), `keys`, spend-limit                                  | **VERIFIED**    | real D1 ledger; reserve-before-work → 402                                                 |
| **`pricing` · `quote`** (price book + preflight)                                        | **VERIFIED**    | NEW — 25/25 prod E2E (`e2e/quote/run.mjs`)                                                |
| `crawl/active` · `crawl/ongoing`                                                        | PARTIAL         | returns empty — no cross-DO registry yet                                                  |
| `crawl/params-preview`, `scrape/:jobId`, token-usage, queue-status, keyless/eligibility | NOT IMPLEMENTED | honest 501/⛔; low-priority                                                               |
| `/slack`, `/support`, threat-protection, SIEM                                           | N/A             | out-of-scope for this edition                                                             |

Error envelope `{success:false, error, code?, details?}` with the upstream `ErrorCode` enum verbatim;
status codes 400/401/402/403/404/408/409/429/500/503. Legacy `/v1/*` served by adapters.

## MCP (`fuegol-mcp.manhattan.workers.dev`, stateless Streamable-HTTP)

| Tool group                                                                                | Status                                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `firecrawl_scrape` · `map` · `crawl` · `check_crawl_status` · `search`                    | **VERIFIED**                                     |
| `developer_search` · `gov_search` · `research_search_papers` + paper inspect/related/read | **VERIFIED** (Exa categories + Semantic Scholar) |
| `firecrawl_agent` · `monitor_create/list/run/checks` (Bearer-forwarded)                   | **VERIFIED**                                     |
| `firecrawl_find_tools`                                                                    | NOT IMPLEMENTED (proprietary catalog)            |

## Commerce (the product's revenue contract)

| Capability                                       | Status          | Blocker                                                                            |
| ------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------- |
| Preflight quote + price book + margin floor      | **VERIFIED**    | —                                                                                  |
| Real-time credit ledger + reserve/enforce + 402  | **VERIFIED**    | —                                                                                  |
| Stripe subscriptions + one-time packs + webhooks | NOT IMPLEMENTED | needs a Stripe **`sk_test_`** key (only `sk_live_` is available; live-charge risk) |

## Gating rule

The release is **not** labeled "fully Firecrawl compatible" until the pinned v1+v2 OpenAPI/MCP
contracts and the major official-SDK paths pass. Today: core + premium families + TS/Python SDKs +
MCP core tools are VERIFIED; the honest remaining gaps are the low-priority diagnostics endpoints and
the externally-blocked Stripe commerce layer.
