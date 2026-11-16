#!/usr/bin/env node
/**
 * AC1 guard for MEG-99: no upstream delta may remain unclassified.
 *
 * The reproducible differ (scripts/diff-openapi.mjs) prints every leaf change. This script
 * fails closed unless the exact baseline and candidate BYTES being compared match a
 * transition recorded in packages/contracts/upstream/DELTA_DISPOSITION.json, and the
 * classified change-set fingerprint still matches that record.
 *
 * Why identity, not counts: a historical count budget ("the delta is no larger than the one
 * we reviewed in 2026-10-27") accepts any unrelated pair that happens to be smaller. AppSec
 * reproduced that bypass with a wholly unreviewed operation. Dispositions are therefore
 * bound to the full SHA-256 of both documents plus a SHA-256 over every classified change.
 *
 *   node scripts/check-delta-disposition.mjs                 # upstream vs pinned (CI)
 *   node scripts/check-delta-disposition.mjs a.json b.json   # explicit pair
 *
 * Exit 0 = the compared pair is exactly a reviewed, classified transition (or has no delta);
 * 1 = unclassified / different pair / fingerprint mismatch; 2 = usage, missing disposition
 * record or unreadable human-readable review.
 */
import fs from 'node:fs';
import { classifyDelta, identityOf } from './lib/openapi-delta.mjs';

const MATRIX = 'docs/COMPATIBILITY_MATRIX.md';
const MANIFEST = 'packages/contracts/upstream/MANIFEST.json';
const PINNED = 'packages/contracts/upstream/v2-openapi.json';
const DISPOSITION = 'packages/contracts/upstream/DELTA_DISPOSITION.json';

function refuse(message, code = 2) {
  console.error(message);
  process.exit(code);
}

let M;
let disposition;
try {
  M = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  disposition = JSON.parse(fs.readFileSync(DISPOSITION, 'utf8'));
} catch (e) {
  refuse(`UNCLASSIFIED-DELTA: cannot read review metadata (${e.message}). Re-review is incomplete.`);
}
if (!Array.isArray(disposition.transitions)) {
  refuse(`UNCLASSIFIED-DELTA: ${DISPOSITION} has no transitions array. Re-review is incomplete.`);
}

async function retrieve(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'fuegol-delta-guard/1.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const [basePath, candPath] = process.argv.slice(2);
let baselineBuf;
let candidateBuf;
let identity;
if (basePath && candPath) {
  try {
    baselineBuf = fs.readFileSync(basePath);
    candidateBuf = fs.readFileSync(candPath);
  } catch (e) {
    refuse(`UNCLASSIFIED-DELTA: unreadable pair (${e.message}).`, 2);
  }
  identity = 'explicit pair';
} else {
  // Compare the reviewed pin to what upstream serves now. Byte-identical means no delta
  // exists, so there is nothing to classify. Fetch failure is INCONCLUSIVE (exit 1),
  // never a pass.
  const meta = M.specs.v2;
  let buf;
  try {
    buf = await retrieve(meta.sourceUrl);
  } catch (e) {
    console.error(`UNCLASSIFIED-DELTA: INCONCLUSIVE — v2 fetch failed (${e.message})`);
    process.exit(1);
  }
  const upstream = identityOf(buf);
  if (upstream.sha256 === meta.sha256 && upstream.bytes === meta.bytes) {
    console.log('Delta disposition: no delta at review time (reviewed pin === upstream bytes).');
    process.exit(0);
  }
  baselineBuf = fs.readFileSync(PINNED);
  candidateBuf = buf;
  identity = `upstream ${upstream.sha256.slice(0, 12)}… vs pinned ${meta.sha256.slice(0, 12)}…`;
}

const baselineId = identityOf(baselineBuf);
const candidateId = identityOf(candidateBuf);
const baseline = JSON.parse(baselineBuf.toString('utf8'));
const candidate = JSON.parse(candidateBuf.toString('utf8'));
const found = classifyDelta(baseline, candidate);

console.log(`Delta check (${identity})`);
console.log(`  baseline:  ${baselineId.sha256.slice(0, 12)}… ${baselineId.bytes} B`);
console.log(`  candidate: ${candidateId.sha256.slice(0, 12)}… ${candidateId.bytes} B`);
console.log(`  observed delta: ${found.totals.locations} locations · ${found.totals.review} review · ${found.totals.additive} additive · ${found.totals.documentation} documentation`);

if (found.totals.locations === 0) {
  console.log('OK — no delta between the compared documents.');
  process.exit(0);
}

// The human-readable review is still required; it is what a reviewer reads.
let matrix;
try {
  matrix = fs.readFileSync(MATRIX, 'utf8');
} catch (e) {
  refuse(`UNCLASSIFIED-DELTA: ${MATRIX} unreadable (${e.message}). Re-review is incomplete.`);
}
const m = matrix.match(/Locations:\s*\*\*(\d+)\*\*[^·]*·\s*\*\*(\d+)\*\*/);
if (!m) {
  refuse(
    `UNCLASSIFIED-DELTA: ${MATRIX} has no reviewed disposition line ` +
      '("Locations: **N** · **M** ..."). Re-review is incomplete.',
  );
}

// Dispositions are pair identities, never count ceilings.
const record = disposition.transitions.find(
  (t) =>
    t?.baseline?.sha256 === baselineId.sha256 &&
    t?.baseline?.bytes === baselineId.bytes &&
    t?.candidate?.sha256 === candidateId.sha256 &&
    t?.candidate?.bytes === candidateId.bytes,
);
if (!record) {
  console.error(
    'UNCLASSIFIED-DELTA: this exact baseline/candidate pair has no reviewed disposition in ' +
      `${DISPOSITION}. A new upstream delta must be reviewed (docs/FIRECRAWL_DRIFT_*.md), ` +
      'classified, and recorded as a transition before it can be pinned or merged.',
  );
  process.exit(1);
}

const reviewed = {
  locations: Number(m[1]),
  review: Number(m[2]),
  additive: Number(record.additive),
  documentation: Number(record.documentation),
};
const drift = [];
for (const key of ['locations', 'review', 'additive', 'documentation']) {
  if (!Number.isInteger(record[key])) drift.push(`${key}=${record[key]} (not recorded)`);
  else if (found.totals[key] !== record[key])
    drift.push(`${key} observed ${found.totals[key]} ≠ recorded ${record[key]}`);
}
if (found.changeSetSha256 !== record.changeSetSha256) {
  drift.push(
    `classified change-set fingerprint observed ${found.changeSetSha256.slice(0, 12)}… ≠ ` +
      `recorded ${String(record.changeSetSha256).slice(0, 12)}…`,
  );
}
if (reviewed.locations !== record.locations || reviewed.review !== record.review) {
  drift.push(
    `${MATRIX} documents ${reviewed.locations}/${reviewed.review} but the disposition record ` +
      `holds ${record.locations}/${record.review}`,
  );
}
if (drift.length) {
  console.error('UNCLASSIFIED-DELTA: the compared pair no longer matches its reviewed disposition:');
  for (const d of drift) console.error(`  - ${d}`);
  console.error('Re-run scripts/diff-openapi.mjs, re-classify, and update the disposition record.');
  process.exit(1);
}

console.log(
  `OK — exact reviewed transition ${record.id} (${record.reviewedIn ?? 'review'}); ` +
    'observed delta is covered by the reviewed disposition.',
);
process.exit(0);
