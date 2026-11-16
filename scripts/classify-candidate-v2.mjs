import fs from 'node:fs';
import { classifyDelta, identityOf } from './lib/openapi-delta.mjs';
// Compare against the reviewed 2026-10-27 baseline so this stays reproducible after
// the pin file itself moves to the candidate bytes. Older checkouts predate the
// baseline snapshot, where the pin still pointed at the reviewed 49afc368 bytes.
const baselinePath = fs.existsSync('packages/contracts/upstream/v2-baseline-2026-10-27.json')
  ? 'packages/contracts/upstream/v2-baseline-2026-10-27.json'
  : 'packages/contracts/upstream/v2-openapi.json';
const base = fs.readFileSync(baselinePath);
const candidate = fs.readFileSync('docs/evidence/meg-1120/candidate-v2.json');
if (
  identityOf(candidate).sha256 !==
  'ca3d83a0ff8001f0b2e722e0fc7722e1e4e3b9e0e920a5a6d5ebec33001f2c38'
)
  throw Error('Wrong candidate');
const delta = classifyDelta(JSON.parse(base), JSON.parse(candidate));
function disposition(label, c) {
  if (label === 'POST /search')
    return 'UNSUPPORTED: categories object entries (including their nested filters) fail SearchRequestSchema enum validation; callers must use supported string categories. No object-filter semantics are implemented. The oneOf restructure is not proof of local support.';
  if (label.includes('support') || label.includes('SupportDocs'))
    return 'UNSUPPORTED: POST /support/docs-search and SupportDocsSearchRequest/Response have no local route or contract; upstream removal creates no local removal. Callers cannot use this specialized endpoint.';
  if (label.includes('developer') || label.includes('Developer'))
    return 'UNSUPPORTED: specialized GET /search/developer and DeveloperSearchResult/Response are not locally implemented. Removed type, coverage and reranked cannot be relied on; new partial, canonicalRepo, license and passage metadata are not returned. Generic developer category maps to github provider search, not this endpoint.';
  if (label.includes('gov') || label.includes('Gov'))
    return 'UNSUPPORTED: specialized GET/POST /search/gov and GovSearchResponse are absent. GET cites arrays with form/explode, POST cites string-or-array and sources web/gov are not implemented; generic gov category does not implement legal citation filters or grouped gov results.';
  if (label.includes('research') || label.includes('Research'))
    return 'UNSUPPORTED: specialized papers endpoints and ResearchPaperResult/Metadata are absent; sort, authors and ISO createdDate/updateDate are not provided by generic research-category search. The example date change does not establish a runtime guarantee.';
  if (label.includes('/agent'))
    return 'UNSUPPORTED: safe is not wired to provider filtering in the local agent implementation and no effective safe response field is guaranteed. Callers cannot depend on explicit-content filtering from this addition.';
  if (label.includes('Options'))
    return 'PARTIAL / TLS UNVERIFIED: optional scrape flag is not passed to transport; JSON parse route strips fields other than url. Omitted and false use the same transport path. Browser target certificate enforcement needs runtime evidence; no compatibility or VERIFIED claim is made.';
  return 'DOCUMENTARY: webhook URL description change; no executable schema constraint changed and no runtime behavior is inferred from this text.';
}
const output = {
  baseline: identityOf(base),
  candidate: identityOf(candidate),
  approval: 'UNPINNED / UNAPPROVED; no transition authorized',
  ...delta,
  sections: delta.sections.map((s) => ({
    ...s,
    changes: s.changes.map((c) => ({ ...c, disposition: disposition(s.label, c) })),
  })),
};
console.log(JSON.stringify(output, null, 2));
