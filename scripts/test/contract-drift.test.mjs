#!/usr/bin/env node
/**
 * Regression gate for scripts/check-contract-drift.mjs (MEG-99 AC4).
 *
 * Proves, with controlled fixtures and an isolated fetch stub (CONTRACT_UPSTREAM_FIXTURE_DIR /
 * CONTRACT_UPSTREAM_FIXTURE_FAIL — never used in production), that:
 *   1. matching upstream bytes  → exit 0, "No drift"
 *   2. changed v2 bytes         → exit 1, names v2 drift
 *   3. changed v1 bytes         → exit 1, names v1 drift
 *   4. fetch failure            → exit 1, INCONCLUSIVE (never "No drift")
 *   5. tampered pinned file     → exit 1, INCONCLUSIVE (manifest vs bytes)
 *
 * Each case runs in a throwaway copy of the repository scripts + pinned specs, so the real
 * pins are never modified. Dependency-free; `node scripts/test/contract-drift.test.mjs`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SCRIPT = path.join(REPO, 'scripts/check-contract-drift.mjs');
const UPSTREAM = path.join(REPO, 'packages/contracts/upstream');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(UPSTREAM, 'MANIFEST.json'), 'utf8'));

const results = [];
let failures = 0;

/** Copy the script + pinned specs into a scratch root so exits/paths are realistic. */
function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-gate-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'packages/contracts/upstream'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts/check-contract-drift.mjs'));
  for (const f of ['MANIFEST.json', ...Object.values(MANIFEST.specs).map((s) => s.file)])
    fs.copyFileSync(path.join(UPSTREAM, f), path.join(root, 'packages/contracts/upstream', f));
  return root;
}

/** Write `<file>.json` fixtures for the given versions using each spec's real pinned bytes. */
function fixtureDir(root, versions) {
  const dir = path.join(root, 'fixtures');
  fs.mkdirSync(dir, { recursive: true });
  for (const v of versions)
    fs.copyFileSync(path.join(UPSTREAM, MANIFEST.specs[v].file), path.join(dir, `${v}.json`));
  return dir;
}

function run(root, env) {
  try {
    const stdout = execFileSync(process.execPath, ['scripts/check-contract-drift.mjs'], {
      cwd: root,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function check(name, cond, detail) {
  results.push({ name, ok: Boolean(cond), detail });
  if (!cond) failures++;
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `  ${detail}`}`);
}

function expectCase(root, env, expect) {
  const r = run(root, env);
  expect(r);
}

console.log('\ncontract drift gate (scripts/check-contract-drift.mjs)\n');

// 1. Matching upstream bytes (the real pinned files, served as fixtures).
{
  const root = scratch();
  expectCase(root, { CONTRACT_UPSTREAM_FIXTURE_DIR: fixtureDir(root, ['v2', 'v1']) }, (r) =>
    check(
      'matching upstream bytes → exit 0 + "No drift"',
      r.code === 0 && /No drift/.test(r.out),
      `exit ${r.code}: ${r.out.slice(0, 200)}`,
    ),
  );
}

// 2. Changed v2 bytes.
{
  const root = scratch();
  const dir = path.join(root, 'fixtures');
  fs.mkdirSync(dir, { recursive: true });
  const v2 = fs.readFileSync(path.join(UPSTREAM, 'v2-openapi.json'), 'utf8');
  fs.writeFileSync(
    path.join(dir, 'v2.json'),
    v2.replace('"openapi": "3.0.0"', '"openapi": "3.0.0" '),
  );
  fs.copyFileSync(path.join(UPSTREAM, 'v1-openapi.json'), path.join(dir, 'v1.json'));
  expectCase(root, { CONTRACT_UPSTREAM_FIXTURE_DIR: dir }, (r) =>
    check(
      'changed v2 bytes → exit 1 + names v2',
      r.code === 1 && /\*\*v2\*\*: CHANGED/.test(r.out) && /\*\*v1\*\*: unchanged/.test(r.out),
      `exit ${r.code}: ${r.out.slice(0, 200)}`,
    ),
  );
}

// 3. Changed v1 bytes.
{
  const root = scratch();
  const dir = path.join(root, 'fixtures');
  fs.mkdirSync(dir, { recursive: true });
  const v1 = fs.readFileSync(path.join(UPSTREAM, 'v1-openapi.json'), 'utf8');
  fs.writeFileSync(
    path.join(dir, 'v1.json'),
    v1.replace('"openapi": "3.0.0"', '"openapi": "3.0.0" '),
  );
  fs.copyFileSync(path.join(UPSTREAM, 'v2-openapi.json'), path.join(dir, 'v2.json'));
  expectCase(root, { CONTRACT_UPSTREAM_FIXTURE_DIR: dir }, (r) =>
    check(
      'changed v1 bytes → exit 1 + names v1',
      r.code === 1 && /\*\*v1\*\*: CHANGED/.test(r.out) && /\*\*v2\*\*: unchanged/.test(r.out),
      `exit ${r.code}: ${r.out.slice(0, 200)}`,
    ),
  );
}

// 4. Fetch failure must be INCONCLUSIVE, never "No drift".
{
  const root = scratch();
  expectCase(root, { CONTRACT_UPSTREAM_FIXTURE_FAIL: 'v2' }, (r) =>
    check(
      'v2 fetch failure → exit 1 + INCONCLUSIVE (not "No drift")',
      r.code === 1 &&
        /INCONCLUSIVE/.test(r.out) &&
        /Inconclusive/.test(r.out) &&
        !/No drift/.test(r.out),
      `exit ${r.code}: ${r.out.slice(0, 200)}`,
    ),
  );
  expectCase(root, { CONTRACT_UPSTREAM_FIXTURE_FAIL: 'v1,v2' }, (r) =>
    check(
      'both fetches fail → exit 1 + INCONCLUSIVE',
      r.code === 1 && !/No drift/.test(r.out),
      `exit ${r.code}: ${r.out.slice(0, 200)}`,
    ),
  );
}

// 5. Tampered local pin is caught even when upstream is unchanged.
{
  const root = scratch();
  const pinned = path.join(root, 'packages/contracts/upstream/v2-openapi.json');
  fs.writeFileSync(pinned, fs.readFileSync(pinned, 'utf8') + '\n');
  expectCase(root, { CONTRACT_UPSTREAM_FIXTURE_DIR: fixtureDir(root, ['v2', 'v1']) }, (r) =>
    check(
      'tampered pinned v2 → exit 1 + INCONCLUSIVE',
      r.code === 1 && /INCONCLUSIVE/.test(r.out),
      `exit ${r.code}: ${r.out.slice(0, 200)}`,
    ),
  );
}

// 6. Triage guard: the real pins match the real manifest.
for (const [v, meta] of Object.entries(MANIFEST.specs)) {
  const buf = fs.readFileSync(path.join(UPSTREAM, meta.file));
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  check(
    `real pin ${v} matches manifest sha256 + size`,
    sha === meta.sha256 && buf.length === meta.bytes,
    `${sha} ${buf.length}B`,
  );
}

console.log(`\n${results.length - failures} passed, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
