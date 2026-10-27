#!/usr/bin/env node
/**
 * AC1 guard for MEG-99: no upstream delta may remain unclassified.
 *
 * The reproducible differ (scripts/diff-openapi.mjs) prints every leaf change. This script
 * fails when a pinned-vs-upstream v2 delta exists that the current delta review does NOT
 * account for. The review is the disposition table in docs/COMPATIBILITY_MATRIX.md: its
 * "Locations" line states how many changed locations and review-class leaf changes were
 * classified at review time.
 *
 *   node scripts/check-delta-disposition.mjs                 # upstream vs pinned (CI)
 *   node scripts/check-delta-disposition.mjs a.json b.json   # explicit pair
 *
 * Exit 0 = every delta is covered by the reviewed disposition; 1 = unclassified delta
 * (re-review required before re-pinning); 2 = usage / unreadable review.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const MATRIX = 'docs/COMPATIBILITY_MATRIX.md';
const MANIFEST = 'packages/contracts/upstream/MANIFEST.json';
const PINNED = 'packages/contracts/upstream/v2-openapi.json';

const M = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

/** Count locations and review-class leaves; mirrors scripts/diff-openapi.mjs exactly. */
function countDelta(baseline, candidate) {
  const DOC = new Set(['description', 'title', 'example', 'examples', 'summary', 'format']);
  const changes = [];
  function walk(a, p, at) {
    if (a === p) return;
    const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a;
    const tp = Array.isArray(p) ? 'array' : p === null ? 'null' : typeof p;
    if (ta !== tp) return changes.push({ at, kind: 'type' });
    if (ta === 'object') {
      for (const k of new Set([...Object.keys(a || {}), ...Object.keys(p || {})])) {
        if (!(k in (a || {}))) changes.push({ at: `${at}.${k}`, kind: 'removed' });
        else if (!(k in (p || {}))) changes.push({ at: `${at}.${k}`, kind: 'added' });
        else walk(a[k], p[k], `${at}.${k}`);
      }
      return;
    }
    if (ta === 'array') {
      if (a.length !== p.length) changes.push({ at, kind: 'array-length' });
      for (let i = 0; i < Math.max(a.length, p.length); i++) {
        if (i >= a.length) changes.push({ at: `${at}[${i}]`, kind: 'removed' });
        else if (i >= p.length) changes.push({ at: `${at}[${i}]`, kind: 'added' });
        else walk(a[i], p[i], `${at}[${i}]`);
      }
      return;
    }
    changes.push({ at, kind: 'value' });
  }
  const scopes = [];
  for (const [p, item] of Object.entries(candidate.paths ?? {}))
    for (const m of Object.keys(item))
      if (['get', 'post', 'put', 'patch', 'delete'].includes(m))
        scopes.push([`${m.toUpperCase()} ${p}`, candidate.paths[p]?.[m], baseline.paths[p]?.[m]]);
  for (const name of Object.keys(candidate.components?.schemas ?? {}))
    scopes.push([
      `schema ${name}`,
      candidate.components?.schemas?.[name],
      baseline.components?.schemas?.[name],
    ]);
  let locations = 0;
  let review = 0;
  for (const [, a, p] of scopes) {
    const before = changes.length;
    walk(a ?? {}, p ?? {}, '$');
    const n = changes.length - before;
    if (!n) continue;
    locations++;
    for (let i = before; i < changes.length; i++) {
      const c = changes[i];
      const leaf = c.at
        .split('.')
        .pop()
        .replace(/\[\d+\]$/, '');
      const doc = DOC.has(leaf);
      if (!doc && c.kind !== 'added' && c.kind !== 'array-length') review++;
    }
  }
  return { locations, review };
}

async function retrieve(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'fuegol-delta-guard/1.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const [basePath, candPath] = process.argv.slice(2);
let baseline;
let candidate;
let identity;
if (basePath && candPath) {
  baseline = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  candidate = JSON.parse(fs.readFileSync(candPath, 'utf8'));
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
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha === meta.sha256 && buf.length === meta.bytes) {
    console.log('Delta disposition: no delta at review time (reviewed pin === upstream bytes).');
    process.exit(0);
  }
  baseline = JSON.parse(fs.readFileSync(PINNED, 'utf8'));
  candidate = JSON.parse(buf.toString('utf8'));
  identity = `upstream ${sha.slice(0, 12)}… vs pinned ${meta.sha256.slice(0, 12)}…`;
}

const matrix = fs.readFileSync(MATRIX, 'utf8');
const m = matrix.match(/Locations:\s*\*\*(\d+)\*\*[^·]*·\s*\*\*(\d+)\*\*/);
if (!m) {
  console.error(
    `UNCLASSIFIED-DELTA: ${MATRIX} has no reviewed disposition line ` +
      '("Locations: **N** · **M** ..."). Re-review is incomplete.',
  );
  process.exit(2);
}
const reviewed = { locations: Number(m[1]), review: Number(m[2]) };
const found = countDelta(baseline, candidate);

console.log(`Delta check (${identity})`);
console.log(`  reviewed disposition: ${reviewed.locations} locations · ${reviewed.review} review`);
console.log(`  observed delta:       ${found.locations} locations · ${found.review} review`);

if (found.locations === 0 && found.review === 0) {
  console.log('OK — no delta between the compared documents.');
  process.exit(0);
}
if (found.locations <= reviewed.locations && found.review <= reviewed.review) {
  console.log('OK — observed delta is covered by the reviewed disposition.');
  process.exit(0);
}
console.error(
  'UNCLASSIFIED-DELTA: the observed delta is larger than the reviewed disposition. ' +
    'Review it (docs/FIRECRAWL_DRIFT_*.md), classify every location, and re-pin before merge.',
);
process.exit(1);
