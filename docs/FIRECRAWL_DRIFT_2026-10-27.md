# Firecrawl OpenAPI drift review — v2 pin 2026-10-27

Tracked by [MEG-99](/MEG/issues/MEG-99). Acceptance contract:
[`FIRECRAWL_DRIFT_ACCEPTANCE.md`](./FIRECRAWL_DRIFT_ACCEPTANCE.md) (AC1–AC5 belong in this review).

## Artifact identity

| Item                               | Value                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Baseline (pinned 2026-10-10)       | `0541be01504053f8e978b60c6a12dc100cd6a76020f2a2723ecf9411f5778a3b` · 473629 B                                  |
| Triage-expected candidate          | `5f889b6c8be4…` · 477957 B (from the drift issue; prefix only)                                                 |
| **Reviewed + pinned (2026-10-27)** | **`49afc368bf971b2321857409d18ac32915f07abf73596905e97be52b2f397cfb` · 485788 B**                              |
| Source                             | `https://docs.firecrawl.dev/api-reference/v2-openapi.json`                                                     |
| Retrieved                          | 2026-10-27T07:08Z, re-fetched once (byte-identical to the first fetch)                                         |
| v1 (unchanged)                     | `d30b8816c05054b596b02d7dc8f39cb186ac79108b03113f3f4c9eee86300781` · 132167 B · 21 paths / 23 ops / 12 schemas |
| v2 structure                       | 45 paths / 57 operations / 67 schemas (identical counts to baseline)                                           |

**Upstream moved again between triage and review.** The triage prefix `5f889b6c8be4…`
(477957 B) is not what the docs endpoint serves today; the reviewed bytes are `49afc368…`
(485788 B). Per the acceptance contract, the newer artifact is reviewed and pinned, and
`MANIFEST.json#history` keeps the 2026-10-10 identity. The 477957 B intermediate was never
fetched by this review, so no claim is made about it beyond "superseded".

## How to reproduce

```sh
git show <baseline-rev>:packages/contracts/upstream/v2-openapi.json > /tmp/v2-baseline.json
node scripts/diff-openapi.mjs /tmp/v2-baseline.json packages/contracts/upstream/v2-openapi.json
sha256sum packages/contracts/upstream/v2-openapi.json packages/contracts/upstream/v1-openapi.json
node scripts/test/contract-drift.test.mjs   # drift gate fixtures (AC4)
```

The diff script prints every leaf change with a JSON-pointer-style location and a mechanical
class (`added`/`array-length` → additive, `removed`/`type` → breaking review, enum/required/value →
review, description/title/example → documentation). Current totals: **16 changed locations,
105 leaf changes — 36 require review, 44 additive, 25 documentation**.

## Changed operations

| Operation          | Delta                                                                                       | Classification | Disposition                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /scrape`     | new `toolDetail` enum (`compact`/`summary`/`full`) on `domainTools` results                 | additive       | Ignored option — accepted and stored, no behavior change (tool-contract detail is proprietary). No user-visible impact.                                                            |
| `POST /agent`      | new `zeroDataRetention` (bool, default false) and `location` (proxy country)                | additive       | **Not implemented** — unknown fields are dropped by the contract. User impact: ZDR/location requests are silently not honored on `agent`. Tracked as an unsupported delta (below). |
| `POST /search`     | `sources` default `["web"]` → `[{"type":"web"}]` (object form)                              | documentation  | No behavior change: both forms were and are accepted; our Zod default remains `['web']`.                                                                                           |
| `GET /search/gov`  | +5 query filters (`jurisdiction`, `court`, `courtType`, `cites`, `domain`); 400 description | additive       | Gov is served via MCP `gov_search` (Exa category), not this REST path. Filters not implemented on REST; documented gap.                                                            |
| `POST /search/gov` | same 5 body filters; 400 description                                                        | additive       | Same as above.                                                                                                                                                                     |

## Changed schemas

| Schema                                                   | Delta                                                                                                                                                                                               | Classification                                     | Disposition                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Formats`                                                | new `attributes` member (`type:'attributes'` + required `selectors[]`) inserted at index 7 (`screenshot`…`highlights` shift by one)                                                                 | additive (member) + **required-on-object changed** | **Implemented** — `AttributesFormatSchema` already existed; the engine now returns `data.attributes` (`extractAttributes`, static-HTTP tier). Regression tests in `packages/engine/test/html-to-markdown.test.ts` and `packages/contracts/test/scrape-formats.test.ts`. Browser-only renders emit an honest warning instead of an empty array. |
| `ScrapeOptions`                                          | `parsers` items now oneOf[name `"pdf"`/`"image"`, PDF object (`+pages`, `+blocks`, `+pageMarkers`), Image object]; default `["pdf"]` → `["pdf","image"]`; `waitFor` gains explicit `maximum: 60000` | additive + default widening                        | `ParserSchema` updated to the exact upstream shape (name shorthands + PDF option object incl. new booleans + Image object). `waitFor` cap 60000 was already enforced in Zod. PDF parse options (`pages`/`blocks`/`pageMarkers`) are accepted but not yet applied by the document-parse tier — documented gap.                                  |
| `ParseFormats`                                           | first item becomes an object (`{type:'markdown'}`)                                                                                                                                                  | additive                                           | Type-only in the spec; our parse request accepts the object form.                                                                                                                                                                                                                                                                              |
| `ParseOptions`                                           | `parsers` default `["pdf"]` → `[{type:"pdf"}]`                                                                                                                                                      | documentation                                      | No behavior change.                                                                                                                                                                                                                                                                                                                            |
| `ScrapeResponse`                                         | `data.attributes` array added; `metadata.language` `oneOf`+`nullable` → `anyOf` with `nullable:true` per branch                                                                                     | additive + nullability relaxation                  | `DocumentSchema.attributes` existed; **`DocumentMetadataSchema.language` widened** to `string \| string[] \| null` to match (previously rejected an array or null — a real conformance bug now fixed, covered by a test).                                                                                                                      |
| `CrawlStatusResponseObj`, `BatchScrapeStatusResponseObj` | same `metadata.language` nullability change                                                                                                                                                         | additive / relaxation                              | Fixed by the shared metadata schema above; crawl/batch responses reuse it.                                                                                                                                                                                                                                                                     |
| `AgentTraceEvent`                                        | `error` gains explicit `type:"object"` on two variants                                                                                                                                              | documentation                                      | No change; the same `$ref` union was already emitted.                                                                                                                                                                                                                                                                                          |
| `FindToolsData`                                          | `next` gains `type:"object"`                                                                                                                                                                        | documentation                                      | No change (find_tools remains NOT IMPLEMENTED).                                                                                                                                                                                                                                                                                                |
| `SearchFeedbackRequest`                                  | `valuableResults` added (≤50, addressed by group + 1-indexed position); description                                                                                                                 | additive                                           | **Not implemented** — `/feedback` is a documented 501. Unsupported delta (below).                                                                                                                                                                                                                                                              |
| `EndpointFeedbackRequest`                                | description only                                                                                                                                                                                    | documentation                                      | No change.                                                                                                                                                                                                                                                                                                                                     |

**Explicit conclusion (AC1):** no breaking request/response delta for any operation this edition
serves. The only narrowing-looking edits (`Formats.items.oneOf[i].type.enum[0]`) are an index
shift caused by inserting `attributes`; every format name still exists and parses (verified by the
contract test that round-trips all shorthand + object forms). The `metadata.language` change is a
relaxation and exposed a real gap in our schema, now fixed.

## Unsupported deltas (honest gaps)

| Field / operation                                                                    | Current behavior                                                | User impact                                                                             |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `POST /agent` `zeroDataRetention`, `location`                                        | Accepted-then-dropped (unknown keys)                            | Agent runs are not ZDR and use the default egress country. Not advertised as supported. |
| `/search/gov` REST filters (`jurisdiction`, `court`, `courtType`, `cites`, `domain`) | REST path not routed; MCP `gov_search` has no filter support    | Users needing court-level filtering must filter client-side.                            |
| PDF parser options `pages`, `blocks`, `pageMarkers`                                  | Accepted; document-parse tier emits a single `pages` array only | Per-page markers/layout blocks unavailable.                                             |
| `attributes` format on a browser-only render                                         | Warning returned, no `data.attributes`                          | Static-HTTP scrapes (the default tier) do return attributes.                            |
| `search` `/feedback` + `valuableResults`                                             | 501                                                             | No feedback capture.                                                                    |
| `scrape.domainTools`/`toolDetail`                                                    | Option accepted, no `data.tools`                                | Proprietary catalog not served.                                                         |

None of these is labeled VERIFIED; see the matrix rows in
[`COMPATIBILITY_MATRIX.md`](./COMPATIBILITY_MATRIX.md).

## Verification evidence

| Check                  | Command                                                      | Result                                                                       |
| ---------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Byte identity          | `sha256sum packages/contracts/upstream/{v2,v1}-openapi.json` | v2 `49afc368…` / 485788 B; v1 `d30b8816…` / 132167 B                         |
| Contract schema tests  | `pnpm --filter @fuegol/contracts test`                       | 27/27 pass (incl. 7 new delta cases)                                         |
| Engine attribute tests | `pnpm --filter @fuegol/engine test`                          | 23/23 pass (incl. 4 new attribute cases)                                     |
| Drift gate fixtures    | `node scripts/test/contract-drift.test.mjs`                  | 8/8 pass (match/size, v2 drift, v1 drift, both fetch failures, tampered pin) |
| Typecheck              | `pnpm -r --if-present typecheck`                             | contracts, engine, api, mcp — clean                                          |
| Live contract run      | `node e2e/contract/run.mjs`                                  | Requires a deployed API + key; see PR/issue comment for the run against prod |
