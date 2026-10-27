# Firecrawl OpenAPI drift acceptance contract

Implementation owner: **Implementer-Swarm**, under [MEG-99](/MEG/issues/MEG-99). Contract author: Independent-Reviewer, under [MEG-357](/MEG/issues/MEG-357).

All checks below require evidence before implementation acceptance. This contract is not a merge or deployment approval.

## Artifact identity

The 2026-10-10 manifest records:

| Version | Baseline SHA-256                                                   |  Bytes |
| ------- | ------------------------------------------------------------------ | -----: |
| v2      | `0541be01504053f8e978b60c6a12dc100cd6a76020f2a2723ecf9411f5778a3b` | 473629 |
| v1      | `d30b8816c05054b596b02d7dc8f39cb186ac79108b03113f3f4c9eee86300781` | 132167 |

Triage identifies the candidate v2 as `5f889b6c8be4…`, 477957 bytes. Obtain its full SHA-256 from the reviewed bytes; a prefix is insufficient. If upstream has moved again, identify the newer artifact and review the additional changes before pinning it. Preserve provenance and both original artifacts.

## Acceptance checks

- [ ] **AC1 — Review every upstream delta.** Attach a reproducible semantic diff between the baseline and candidate v2 specs. Enumerate changed operations and schemas by method/path or JSON pointer, before/after behavior, and classification: breaking, additive, or documentation-only. Include request/response requirements, types, enums, nullability, defaults, authentication, status codes, removals, and referenced schemas. For every breaking change, link either a client/adapter accommodation with a focused regression test or a known unsupported delta in the compatibility documentation. Unsupported entries must identify affected fields/operations, current behavior, and user impact, without an unqualified VERIFIED label. If no breaking changes exist, explicitly record that conclusion and its evidence. No delta may remain unclassified.

- [ ] **AC2 — Verify the exact pin and run the contract suite.** Save reviewed bytes without reformatting to `packages/contracts/upstream/v2-openapi.json`. Update `MANIFEST.json` with the full SHA-256, byte size, retrieval provenance, and recalculated structural counts. Independently run `sha256sum` and `wc -c` on both pinned files and compare results with the manifest and reviewed artifacts. Run `node e2e/contract/run.mjs` from the implementation revision. Attach stdout, stderr, exit code, timestamp, API target, and `e2e/contract/report.json`. Require exit 0 and passing core scrape/map conformance with expected successful HTTP statuses. Explain every other reported failure or unsupported operation; new regressions require fixes or explicit AC1 unsupported entries. Add focused tests for supported changed behavior beyond the existing runner's coverage. Do not claim full compatibility from exit 0 alone.

- [ ] **AC3 — Update the matrix and preserve v1.** Update `docs/COMPATIBILITY_MATRIX.md` with the reviewed v2 identity/date, actual path/operation/schema counts, measured coverage/conformance results, and links to unsupported deltas and evidence. Use VERIFIED, PARTIAL, NOT IMPLEMENTED, and N/A accurately. Explicitly mark v1 unchanged. Its bytes, full hash, size, and manifest identity/structural counts must remain the baseline above. Explain any v1 runtime coverage change separately from spec identity. Do not present historical test counts as fresh evidence.

- [ ] **AC4 — Prove future drift fails.** Supply a deterministic regression test or enforced CI gate that exercises the actual `scripts/check-contract-drift.mjs`: matching upstream bytes succeed; changed v2 bytes fail nonzero and identify v2 drift; changed v1 bytes also fail. Use controlled fixtures or an isolated fetch stub, without modifying production pins. Verify local pinned bytes and sizes against the manifest. Fetch failures must produce failure or an explicit inconclusive result, never verified no-drift. Verify the scheduled/manual `.github/workflows/contract-drift.yml` check and its reviewable issue notification remain effective. Attach positive/negative outputs and workflow evidence.

- [ ] **AC5 — Attach evidence and preserve review control.** Attach the semantic diff/disposition table, source URLs and acquisition times, old/new full hashes and byte sizes, integrity output, contract output/report, focused tests, drift-gate results, and matrix changes to the implementation issue/PR. Identify the immutable implementation revision, command working directories, timestamps, targets, and exit codes; redact credentials. Register uploaded artifacts and the implementation PR/branch as Paperclip work products with usable links. Every acceptance check must map to evidence. Upstream changes must never auto-merge into production: drift detection must not automatically accept pins, merge, or deploy; preserve explicit review before production promotion.

## Existing limitations relevant to acceptance

Repository inspection found that the drift checker skips fetch failures and can then print “No drift.” The existing scheduled check does not prove equality when retrieval fails; AC4 requires honest failure/inconclusive reporting.

The contract runner records coverage and four conformance probes but gates its exit only on scrape/map conformance. It does not gate on HTTP status, all other failures, or complete route coverage. AC2 therefore requires report-level review and focused checks for changed behavior.

## Decision rule

Accept implementation only when AC1–AC5 have evidence and every breaking delta has an explicit disposition. Missing evidence and unexplained regressions fail acceptance. Completion of the contract-authoring review does not certify the implementation. Implementer-Swarm owns implementation and validation under MEG-99; this review must not modify that issue.
