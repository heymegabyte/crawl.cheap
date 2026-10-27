#!/usr/bin/env node
/**
 * Regression gate for scripts/check-delta-disposition.mjs (MEG-99 AC1).
 *
 * Proves that an upstream v2 delta larger than the reviewed disposition in
 * docs/COMPATIBILITY_MATRIX.md fails, so no spec change can be merged unclassified:
 *   1. the real reviewed pair (2026-10-10 baseline → pinned) passes
 *   2. an unclassified additive delta fails and says so
 *   3. a missing disposition line is refused (exit 2), never treated as covered
 *   4. an identical pair passes with no delta
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
  path.join(REPO, 'packages/contracts/upstream/v2-baseline-2026-10-10.json');
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
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'packages/contracts/upstream'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts/check-delta-disposition.mjs'));
  fs.copyFileSync(
    path.join(REPO, 'docs/COMPATIBILITY_MATRIX.md'),
    path.join(root, 'docs/COMPATIBILITY_MATRIX.md'),
  );
  fs.copyFileSync(
    path.join(REPO, 'packages/contracts/upstream/MANIFEST.json'),
    path.join(root, 'packages/contracts/upstream/MANIFEST.json'),
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
    '    git show b0974fe:packages/contracts/upstream/v2-openapi.json > packages/contracts/upstream/v2-baseline-2026-10-10.json\n',
  );
  process.exit(2);
}

// 1. The real reviewed pair is covered.
{
  const r = run(scratch(), [BASELINE, PINNED]);
  check(
    'reviewed 2026-10-10 → 2026-10-27 pair → exit 0 (covered)',
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
    fs.readFileSync(matrix, 'utf8').replace(/Locations: \*\*\d+\*\*[^\n]*/, 'Locations: removed'),
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

console.log(`\n${total - failures} passed, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
