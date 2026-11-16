#!/usr/bin/env node
/**
 * Regression gate for scripts/check-delta-disposition.mjs (MEG-99 AC1).
 *
 * Proves that no unreviewed v2 delta can be merged, and that a disposition is bound to the
 * exact reviewed bytes rather than to a historical count budget (AppSec AC1 finding):
 *   1. the real reviewed pair (2026-10-27 baseline → pinned) passes
 *   2. an unclassified additive delta fails and says so
 *   3. a missing disposition line is refused (exit 2), never treated as covered
 *   4. an identical pair passes with no delta
 *   5. a different pair whose counts are BELOW the reviewed budget still fails closed
 *      (single unknown operation, same-count replacement, removed operation/schema)
 *   6. a tampered classified change-set fingerprint fails even for the reviewed bytes
 *
 * Dependency-free; `node scripts/test/delta-disposition.test.mjs`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SCRIPT = path.join(REPO, 'scripts/check-delta-disposition.mjs');
const BASELINE =
  process.env.DELTA_BASELINE ??
  path.join(REPO, 'packages/contracts/upstream/v2-baseline-2026-10-27.json');
const PINNED = path.join(REPO, 'packages/contracts/upstream/v2-openapi.json');

let failures = 0;
let total = 0;
function check(name, cond, detail) {
  total++;
  if (!cond) failures++;
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `  ${detail}`}`);
}

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-guard-'));
  fs.mkdirSync(path.join(root, 'scripts/lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'packages/contracts/upstream'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts/check-delta-disposition.mjs'));
  fs.copyFileSync(
    path.join(REPO, 'scripts/lib/openapi-delta.mjs'),
    path.join(root, 'scripts/lib/openapi-delta.mjs'),
  );
  fs.copyFileSync(
    path.join(REPO, 'docs/COMPATIBILITY_MATRIX.md'),
    path.join(root, 'docs/COMPATIBILITY_MATRIX.md'),
  );
  fs.copyFileSync(
    path.join(REPO, 'packages/contracts/upstream/MANIFEST.json'),
    path.join(root, 'packages/contracts/upstream/MANIFEST.json'),
  );
  fs.copyFileSync(
    path.join(REPO, 'packages/contracts/upstream/DELTA_DISPOSITION.json'),
    path.join(root, 'packages/contracts/upstream/DELTA_DISPOSITION.json'),
  );
  fs.copyFileSync(PINNED, path.join(root, 'packages/contracts/upstream/v2-openapi.json'));
  return root;
}

function run(root, args) {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['scripts/check-delta-disposition.mjs', ...args],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

console.log('\ndelta disposition guard (scripts/check-delta-disposition.mjs)\n');

if (!fs.existsSync(BASELINE)) {
  console.log(`  ! baseline ${BASELINE} not found — restore it with:\n`);
  console.log(
    '    git show 0c17c25:packages/contracts/upstream/v2-openapi.json > packages/contracts/upstream/v2-baseline-2026-10-27.json\n',
  );
  process.exit(2);
}

// 1. The real reviewed pair is covered.
{
  const r = run(scratch(), [BASELINE, PINNED]);
  check(
    'reviewed 2026-10-27 → 2026-11-16 pair → exit 0 (covered)',
    r.code === 0 && /covered by the reviewed disposition/.test(r.out),
    `exit ${r.code}: ${r.out.slice(0, 240)}`,
  );
}

// 2. A larger, unreviewed delta fails.
{
  const root = scratch();
  const reviewed = fs.readFileSync(BASELINE, 'utf8');
  const big = JSON.parse(reviewed);
  for (let i = 0; i < 40; i++) big.paths[`/unreviewed-${i}`] = { get: { responses: {} } };
  const file = path.join(root, 'bigger.json');
  fs.writeFileSync(file, JSON.stringify(big));
  const r = run(root, [BASELINE, file]);
  check(
    'unreviewed delta → exit 1 + UNCLASSIFIED-DELTA',
    r.code === 1 && /UNCLASSIFIED-DELTA/.test(r.out),
    `exit ${r.code}: ${r.out.slice(0, 240)}`,
  );
}

// 3. A missing disposition line is refused.
{
  const root = scratch();
  const matrix = path.join(root, 'docs/COMPATIBILITY_MATRIX.md');
  fs.writeFileSync(
    matrix,
    fs.readFileSync(matrix, 'utf8').replace(/Locations: \*\*\d+\*\*[^\n]*/g, 'Locations: removed'),
  );
  const r = run(root, [BASELINE, PINNED]);
  check(
    'missing disposition line → exit 2 (not covered)',
    r.code === 2 && /Re-review is incomplete/.test(r.out),
    `exit ${r.code}: ${r.out.slice(0, 240)}`,
  );
}

// 4. Identical pair has no delta.
{
  const r = run(scratch(), [PINNED, PINNED]);
  check(
    'identical pair → exit 0 (no delta)',
    r.code === 0 && /no delta/.test(r.out),
    `exit ${r.code}: ${r.out.slice(0, 240)}`,
  );
}

// Security regressions (AppSec AC1): a historical count budget must never approve a new
// identity. Each candidate below is a DIFFERENT artifact pair whose delta counts are at or
// below the reviewed budget, so a count-only guard approves it. The identity-bound guard
// must fail closed.
const { classifyDelta } = await import(
  new URL('../../scripts/lib/openapi-delta.mjs', import.meta.url).href
);
const reviewed = JSON.parse(
  fs.readFileSync(path.join(REPO, 'packages/contracts/upstream/DELTA_DISPOSITION.json'), 'utf8'),
).transitions.at(-1);
const pinnedDoc = JSON.parse(fs.readFileSync(PINNED, 'utf8'));

for (const [name, mutate] of [
  [
    'single unknown operation',
    (spec) => {
      spec.paths['/appsec-unreviewed-probe'] = { post: { responses: {} } };
    },
  ],
  [
    'same-count replacement (one documentary edit + one additive edit)',
    (spec) => {
      const schema = Object.keys(spec.components.schemas)[0];
      spec.components.schemas[schema].description = 'Unreviewed replacement, same leaf count';
      spec.paths['/appsec-same-count-probe'] = { get: { responses: {} } };
    },
  ],
  [
    'removed operation',
    (spec) => {
      const route = Object.keys(spec.paths).find((route) => spec.paths[route].post);
      delete spec.paths[route].post;
    },
  ],
  [
    'removed schema',
    (spec) => {
      delete spec.components.schemas[Object.keys(spec.components.schemas)[0]];
    },
  ],
]) {
  const root = scratch();
  const candidate = structuredClone(pinnedDoc);
  mutate(candidate);
  const file = path.join(root, 'unreviewed.json');
  fs.writeFileSync(file, JSON.stringify(candidate));
  const result = run(root, [PINNED, file]);
  const counts = classifyDelta(pinnedDoc, candidate).totals;
  const underBudget = counts.locations <= reviewed.locations && counts.review <= reviewed.review;
  check(
    name + ' → counts under budget yet exit 1',
    underBudget && result.code === 1 && /UNCLASSIFIED-DELTA/.test(result.out),
    `counts ${counts.locations}/${counts.review} (budget ${reviewed.locations}/${reviewed.review}); ` +
      `exit ${result.code}: ${result.out.slice(0, 200)}`,
  );
}

// The exact reviewed bytes still fail if the recorded classified change set no longer
// matches — the fingerprint, not the counts, is the disposition identity.
{
  const root = scratch();
  const file = path.join(root, 'packages/contracts/upstream/DELTA_DISPOSITION.json');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.transitions.at(-1).changeSetSha256 = '0'.repeat(64);
  fs.writeFileSync(file, JSON.stringify(record));
  const r = run(root, [BASELINE, PINNED]);
  check(
    'tampered change-set fingerprint → exit 1 (reviewed bytes, wrong classification)',
    r.code === 1 && /fingerprint/.test(r.out),
    `exit ${r.code}: ${r.out.slice(0, 240)}`,
  );
}

// A disposition record whose counts disagree with the human-readable matrix is refused.
{
  const root = scratch();
  const file = path.join(root, 'packages/contracts/upstream/DELTA_DISPOSITION.json');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.transitions.at(-1).locations = 15;
  fs.writeFileSync(file, JSON.stringify(record));
  const r = run(root, [BASELINE, PINNED]);
  check(
    'disposition/matrix count disagreement → exit 1',
    r.code === 1 && /COMPATIBILITY_MATRIX/.test(r.out),
    `exit ${r.code}: ${r.out.slice(0, 240)}`,
  );
}

console.log(`\n${total - failures} passed, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
