# Firecrawl v2 drift review — 2026-11-16

Status: proposed pin; AppSec and Architect approval required before merge.

This change records upstream bytes and known compatibility limits. It changes no runtime code. No specialized endpoint is VERIFIED by this review. The 7-gate contract suite covers its stated probes only.

Locations: **20** changed · **18** review-class leaf changes · 30 additive · 11 documentation · 59 leaves

Change-set SHA-256: `136cce0a350fd49e322f62447730c888a8bcb0b859afee136ae6a92ea88045c6`. Both byte identities and this fingerprint bind the new transition; the historical transition is unchanged.

## Security disposition

The ParseOptions and ScrapeOptions skipTlsVerification default changes are KNOWN-UNSUPPORTED deltas. The optional flag is not forwarded to transport, and the JSON parse route strips it. Effective certificate enforcement across fetch, browser and parser paths remains UNVERIFIED. This pin makes no TLS security guarantee. Agent safe filtering also remains UNSUPPORTED. No default or runtime security policy is changed.

## Complete per-field dispositions

Every BREAKING? entry below is a known-unsupported delta. Removed example fields do not establish a local response contract. Supported string search categories remain available; object category filters remain unsupported.

### Saved classification review

Baseline: `49afc368bf971b2321857409d18ac32915f07abf73596905e97be52b2f397cfb` (485788 B). Candidate: `ca3d83a0ff8001f0b2e722e0fc7722e1e4e3b9e0e920a5a6d5ebec33001f2c38` (490961 B).

Reproduce from repository root: `node scripts/classify-candidate-v2.mjs` and `node scripts/diff-openapi.mjs packages/contracts/upstream/v2-baseline-2026-10-27.json docs/evidence/meg-1120/candidate-v2.json`. Both compare the reviewed 2026-10-27 baseline against the saved candidate, so they stay reproducible after this pin lands. Candidate bytes are proposed as the new pin in this change; merge remains approval-gated.

Fresh saved-byte comparison: 20 locations, 59 leaves, 18 review, 30 additive, 11 documentary. These are mechanical classes, not support guarantees. In particular, the differ labels nested example changes as review/additive; those do not by themselves change response constraints.

## POST /crawl

- `POST /crawl.requestBody.content.application/json.schema.properties.webhook.properties.url.description` (documentation, value): DOCUMENTARY: webhook URL description change; no executable schema constraint changed and no runtime behavior is inferred from this text.

## GET /agent

- `GET /agent.responses.200.content.application/json.schema.properties.agents.items.properties.options.properties.safe` (additive, added): UNSUPPORTED: safe is not wired to provider filtering in the local agent implementation and no effective safe response field is guaranteed. Callers cannot depend on explicit-content filtering from this addition.

## POST /agent

- `POST /agent.requestBody.content.application/json.schema.properties.safe` (additive, added): UNSUPPORTED: safe is not wired to provider filtering in the local agent implementation and no effective safe response field is guaranteed. Callers cannot depend on explicit-content filtering from this addition.

## GET /agent/{jobId}

- `GET /agent/{jobId}.responses.200.content.application/json.schema.properties.safe` (additive, added): UNSUPPORTED: safe is not wired to provider filtering in the local agent implementation and no effective safe response field is guaranteed. Callers cannot depend on explicit-content filtering from this addition.

## POST /search

- `POST /search.requestBody.content.application/json.schema.properties.categories.oneOf` (additive, added): UNSUPPORTED: categories object entries (including their nested filters) fail SearchRequestSchema enum validation; callers must use supported string categories. No object-filter semantics are implemented. The oneOf restructure is not proof of local support.
- `POST /search.requestBody.content.application/json.schema.properties.categories.description` (documentation, value): UNSUPPORTED: categories object entries (including their nested filters) fail SearchRequestSchema enum validation; callers must use supported string categories. No object-filter semantics are implemented. The oneOf restructure is not proof of local support.
- `POST /search.requestBody.content.application/json.schema.properties.categories.type` (BREAKING?, removed): UNSUPPORTED: categories object entries (including their nested filters) fail SearchRequestSchema enum validation; callers must use supported string categories. No object-filter semantics are implemented. The oneOf restructure is not proof of local support.
- `POST /search.requestBody.content.application/json.schema.properties.categories.items` (BREAKING?, removed): UNSUPPORTED: categories object entries (including their nested filters) fail SearchRequestSchema enum validation; callers must use supported string categories. No object-filter semantics are implemented. The oneOf restructure is not proof of local support.

## GET /search/research/papers

- `GET /search/research/papers.parameters` (additive, array-length): UNSUPPORTED: specialized papers endpoints and ResearchPaperResult/Metadata are absent; sort, authors and ISO createdDate/updateDate are not provided by generic research-category search. The example date change does not establish a runtime guarantee.
- `GET /search/research/papers.parameters[6]` (additive, added): UNSUPPORTED: specialized papers endpoints and ResearchPaperResult/Metadata are absent; sort, authors and ISO createdDate/updateDate are not provided by generic research-category search. The example date change does not establish a runtime guarantee.
- `GET /search/research/papers.responses.200.content.application/json.example.results[0].authors` (additive, added): UNSUPPORTED: specialized papers endpoints and ResearchPaperResult/Metadata are absent; sort, authors and ISO createdDate/updateDate are not provided by generic research-category search. The example date change does not establish a runtime guarantee.
- `GET /search/research/papers.responses.200.content.application/json.example.results[0].createdDate` (additive, added): UNSUPPORTED: specialized papers endpoints and ResearchPaperResult/Metadata are absent; sort, authors and ISO createdDate/updateDate are not provided by generic research-category search. The example date change does not establish a runtime guarantee.
- `GET /search/research/papers.responses.200.content.application/json.example.results[0].updateDate` (additive, added): UNSUPPORTED: specialized papers endpoints and ResearchPaperResult/Metadata are absent; sort, authors and ISO createdDate/updateDate are not provided by generic research-category search. The example date change does not establish a runtime guarantee.

## GET /search/research/papers/{id}

- `GET /search/research/papers/{id}.responses.200.content.application/json.example.paper.createdDate` (value, value): UNSUPPORTED: specialized papers endpoints and ResearchPaperResult/Metadata are absent; sort, authors and ISO createdDate/updateDate are not provided by generic research-category search. The example date change does not establish a runtime guarantee.

## GET /search/developer

- `GET /search/developer.responses.200.content.application/json.example.partial` (additive, added): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.
- `GET /search/developer.responses.200.content.application/json.example.results[0].type` (BREAKING?, removed): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.
- `GET /search/developer.responses.200.content.application/json.example.coverage` (BREAKING?, removed): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.
- `GET /search/developer.responses.200.content.application/json.example.reranked` (BREAKING?, removed): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.

## GET /search/gov

- `GET /search/gov.parameters` (additive, array-length): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `GET /search/gov.parameters[5].description` (documentation, value): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `GET /search/gov.parameters[5].schema.type` (value, value): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `GET /search/gov.parameters[5].schema.items` (additive, added): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `GET /search/gov.parameters[5].schema.minItems` (additive, added): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `GET /search/gov.parameters[5].schema.maxItems` (additive, added): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `GET /search/gov.parameters[5].schema.minLength` (BREAKING?, removed): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `GET /search/gov.parameters[5].style` (additive, added): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `GET /search/gov.parameters[5].explode` (additive, added): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `GET /search/gov.parameters[7]` (additive, added): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `GET /search/gov.responses.200.description` (documentation, value): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.

## POST /search/gov

- `POST /search/gov.requestBody.content.application/json.schema.properties.cites.oneOf` (additive, added): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `POST /search/gov.requestBody.content.application/json.schema.properties.cites.description` (documentation, value): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `POST /search/gov.requestBody.content.application/json.schema.properties.cites.type` (BREAKING?, removed): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `POST /search/gov.requestBody.content.application/json.schema.properties.cites.minLength` (BREAKING?, removed): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `POST /search/gov.requestBody.content.application/json.schema.properties.sources` (additive, added): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.
- `POST /search/gov.responses.200.description` (documentation, value): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.

## POST /support/docs-search

- `POST /support/docs-search` (BREAKING?, type): UNSUPPORTED: POST /support/docs-search and SupportDocsSearchRequest/Response have no local route or contract; upstream removal creates no local removal. Callers cannot use this specialized endpoint.

## schema ParseOptions

- `schema ParseOptions.properties.skipTlsVerification.default` (value, value): PARTIAL / TLS UNVERIFIED: optional scrape flag is not passed to transport; JSON parse route strips fields other than url. Omitted and false use the same transport path. Browser target certificate enforcement needs runtime evidence; no compatibility or VERIFIED claim is made.

## schema ScrapeOptions

- `schema ScrapeOptions.properties.skipTlsVerification.default` (value, value): PARTIAL / TLS UNVERIFIED: optional scrape flag is not passed to transport; JSON parse route strips fields other than url. Omitted and false use the same transport path. Browser target certificate enforcement needs runtime evidence; no compatibility or VERIFIED claim is made.

## schema ResearchPaperResult

- `schema ResearchPaperResult.properties.authors` (additive, added): UNSUPPORTED: specialized papers endpoints and ResearchPaperResult/Metadata are absent; sort, authors and ISO createdDate/updateDate are not provided by generic research-category search. The example date change does not establish a runtime guarantee.
- `schema ResearchPaperResult.properties.createdDate` (additive, added): UNSUPPORTED: specialized papers endpoints and ResearchPaperResult/Metadata are absent; sort, authors and ISO createdDate/updateDate are not provided by generic research-category search. The example date change does not establish a runtime guarantee.
- `schema ResearchPaperResult.properties.updateDate` (additive, added): UNSUPPORTED: specialized papers endpoints and ResearchPaperResult/Metadata are absent; sort, authors and ISO createdDate/updateDate are not provided by generic research-category search. The example date change does not establish a runtime guarantee.

## schema ResearchPaperMetadata

- `schema ResearchPaperMetadata.properties.createdDate.description` (documentation, value): UNSUPPORTED: specialized papers endpoints and ResearchPaperResult/Metadata are absent; sort, authors and ISO createdDate/updateDate are not provided by generic research-category search. The example date change does not establish a runtime guarantee.
- `schema ResearchPaperMetadata.properties.createdDate.format` (documentation, added): UNSUPPORTED: specialized papers endpoints and ResearchPaperResult/Metadata are absent; sort, authors and ISO createdDate/updateDate are not provided by generic research-category search. The example date change does not establish a runtime guarantee.
- `schema ResearchPaperMetadata.properties.updateDate.description` (documentation, value): UNSUPPORTED: specialized papers endpoints and ResearchPaperResult/Metadata are absent; sort, authors and ISO createdDate/updateDate are not provided by generic research-category search. The example date change does not establish a runtime guarantee.
- `schema ResearchPaperMetadata.properties.updateDate.format` (documentation, added): UNSUPPORTED: specialized papers endpoints and ResearchPaperResult/Metadata are absent; sort, authors and ISO createdDate/updateDate are not provided by generic research-category search. The example date change does not establish a runtime guarantee.

## schema DeveloperSearchResult

- `schema DeveloperSearchResult.properties.id.description` (documentation, value): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.
- `schema DeveloperSearchResult.properties.passages.items.properties.citation_url` (additive, added): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.
- `schema DeveloperSearchResult.properties.passages.items.properties.truncated` (additive, added): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.
- `schema DeveloperSearchResult.properties.passages.items.properties.served_span` (additive, added): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.
- `schema DeveloperSearchResult.properties.passages.items.properties.full_tokens_est` (additive, added): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.
- `schema DeveloperSearchResult.properties.license` (additive, added): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.
- `schema DeveloperSearchResult.properties.type` (BREAKING?, removed): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.

## schema DeveloperSearchResponse

- `schema DeveloperSearchResponse.properties.partial` (additive, added): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.
- `schema DeveloperSearchResponse.properties.repos.items.properties.canonicalRepo` (additive, added): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.
- `schema DeveloperSearchResponse.properties.coverage` (BREAKING?, removed): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.
- `schema DeveloperSearchResponse.properties.reranked` (BREAKING?, removed): UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.

## schema GovSearchResponse

- `schema GovSearchResponse.properties.data.properties.gov` (additive, added): UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.

## schema SupportDocsSearchRequest

- `schema SupportDocsSearchRequest` (BREAKING?, type): UNSUPPORTED: POST /support/docs-search and SupportDocsSearchRequest/Response have no local route or contract; upstream removal creates no local removal. Callers cannot use this specialized endpoint.

## schema SupportDocsSearchResponse

- `schema SupportDocsSearchResponse` (BREAKING?, type): UNSUPPORTED: POST /support/docs-search and SupportDocsSearchRequest/Response have no local route or contract; upstream removal creates no local removal. Callers cannot use this specialized endpoint.

## Effective TLS evidence

| Path                                          | Option omitted              | Option false                   | Observed verification                                                          |
| --------------------------------------------- | --------------------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| HTTP scrape                                   | standard fetch options      | same options                   | Transport boundary tested; certificate handshake UNVERIFIED in Workers runtime |
| Browser quick action                          | URL only                    | URL only                       | Mock binding inspected; target certificate enforcement UNVERIFIED              |
| Browser REST / screenshot / Puppeteer actions | no bypass setting in source | same source path               | Runtime UNVERIFIED; not covered by mock quick-action test                      |
| JSON parser URL                               | safeFetch                   | extra flag stripped; safeFetch | Source inspected; certificate handshake UNVERIFIED                             |
| Uploaded parser bytes                         | no outbound URL fetch       | no outbound URL fetch          | TLS not applicable to supplied bytes                                           |

Source: `packages/engine/src/fetcher.ts`, `browser.ts`, `interact.ts`, `scrape.ts`; `apps/api/src/routes/parse.ts`. The optional schema is not certificate evidence. No SSRF bypass was introduced. The test proves private redirect rejection before a second request.

Remaining blocker: obtain an authorized non-production Workers/Browser Rendering runtime with binding access and reachable valid/invalid-certificate fixtures. Run omitted and false through HTTP scrape, browser binding/REST/actions/screenshots, and JSON parser URL. Record certificate-specific failures (not generic connectivity errors), a valid-certificate success control, and ensure parser is not invoked after TLS failure. Backend-Engineer owns this evidence work; AppSec must review independently. Production deployment is prohibited by this task.
