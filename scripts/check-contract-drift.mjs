#!/usr/bin/env node
/**
 * Scheduled drift check: re-fetch the upstream Firecrawl OpenAPI and compare sha256
 * to the pinned MANIFEST. Exits 1 (+ a summary) on any change so the drift is
 * REVIEWED — never silently pulled into production (see §2 of the build brief).
 * On drift: re-pin the spec, re-run `node e2e/contract/run.mjs`, update the matrix.
 *
 * Honest verdicts (MEG-99 AC4): a spec is UNCHANGED only when its fetched bytes hash to
 * the pinned sha256 AND its byte length matches the manifest. A fetch that fails, or a
 * hash/byte-length disagreement inside the manifest, yields INCONCLUSIVE and fails the
 * run — never a false "no drift".
 *
 *   node scripts/check-contract-drift.mjs
 *
 * Test hooks (fixtures only; never used in production):
 *   CONTRACT_UPSTREAM_FIXTURE_DIR  — read `<version>.json` from this dir instead of fetching
 *   CONTRACT_UPSTREAM_FIXTURE_FAIL — comma-separated versions whose fetch must fail
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MANIFEST_PATH = 'packages/contracts/upstream/MANIFEST.json';
const PINNED_DIR = path.dirname(MANIFEST_PATH);
const M = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const FIXTURE_DIR = process.env.CONTRACT_UPSTREAM_FIXTURE_DIR;
const FIXTURE_FAIL = new Set(
  (process.env.CONTRACT_UPSTREAM_FIXTURE_FAIL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const lines = [];
let drift = false;
let inconclusive = false;

async function retrieve(v, meta) {
  if (FIXTURE_FAIL.has(v)) throw new Error('fixture: forced fetch failure');
  if (FIXTURE_DIR) return Buffer.from(fs.readFileSync(path.join(FIXTURE_DIR, `${v}.json`)));
  const r = await fetch(meta.sourceUrl, { headers: { 'user-agent': 'fuegol-drift/1.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

function localIntegrity(v, meta) {
  const file = path.join(PINNED_DIR, meta.file);
  if (!fs.existsSync(file)) return `pinned ${meta.file} missing`;
  const buf = fs.readFileSync(file);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== meta.sha256) return `pinned ${meta.file} sha256 ${sha.slice(0, 12)}… ≠ manifest`;
  if (buf.length !== meta.bytes)
    return `pinned ${meta.file} is ${buf.length}B, manifest says ${meta.bytes}B`;
  return null;
}

for (const [v, meta] of Object.entries(M.specs)) {
  const bad = localIntegrity(v, meta);
  if (bad) {
    inconclusive = true;
    lines.push(`- **${v}**: INCONCLUSIVE — ${bad}`);
  }

  let buf;
  try {
    buf = await retrieve(v, meta);
  } catch (e) {
    inconclusive = true;
    lines.push(`- **${v}**: INCONCLUSIVE — fetch failed (${e.message}); pin NOT verified`);
    continue;
  }
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha === meta.sha256 && buf.length === meta.bytes) {
    lines.push(`- **${v}**: unchanged (\`${sha.slice(0, 12)}…\`, ${buf.length}B)`);
  } else if (sha === meta.sha256) {
    inconclusive = true;
    lines.push(
      `- **${v}**: INCONCLUSIVE — sha256 matches but size differs (manifest ${meta.bytes}B, upstream ${buf.length}B)`,
    );
  } else {
    drift = true;
    lines.push(
      `- **${v}**: CHANGED — pinned \`${meta.sha256.slice(0, 12)}…\` (${meta.bytes}B) → upstream \`${sha.slice(0, 12)}…\` (${buf.length}B) · full sha256 \`${sha}\``,
    );
  }
}

const verdict = drift
  ? '⚠️ **Drift detected.** Review the upstream change, re-pin the spec, re-run `node e2e/contract/run.mjs`, and update `docs/COMPATIBILITY_MATRIX.md`. Never auto-merge upstream contract changes into production.'
  : inconclusive
    ? '⚠️ **Inconclusive.** At least one spec could not be verified against its pin. This is NOT a no-drift result: retry the fetch or inspect the pinned files before trusting the check.'
    : '✅ No drift — pinned specs still match upstream byte-for-byte.';

const summary = `# Firecrawl OpenAPI drift check

Pinned ${M.retrievedAt}.

${lines.join('\n')}

${verdict}`;

console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
fs.writeFileSync('contract-drift-summary.md', summary);
process.exit(drift || inconclusive ? 1 : 0);
