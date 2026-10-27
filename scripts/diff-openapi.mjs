#!/usr/bin/env node
/**
 * Reproducible semantic diff between two Firecrawl v2 OpenAPI documents, used to review
 * pinned-spec drift (MEG-99). Prints a classification table of changed operations/schemas
 * with JSON-pointer-style locations, so no delta is left unclassified.
 *
 *   node scripts/diff-openapi.mjs <baseline.json> <candidate.json>
 *
 * Classification is mechanical: a removal or a narrowed enum/required/type is potentially
 * breaking (review it), an addition is additive, a description-only change is documentary.
 */
import fs from 'node:fs';

const [baselinePath, candidatePath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) {
  console.error('usage: node scripts/diff-openapi.mjs <baseline.json> <candidate.json>');
  process.exit(2);
}
const A = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
const P = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

const DOC_KEYS = new Set(['description', 'title', 'example', 'examples', 'summary', 'format']);

function walk(a, p, at, out) {
  if (a === p) return;
  const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a;
  const tp = Array.isArray(p) ? 'array' : p === null ? 'null' : typeof p;
  if (ta !== tp) return out.push({ at, kind: 'type', from: tp, to: ta });
  if (ta === 'object') {
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(p || {})])) {
      if (!(k in (a || {}))) out.push({ at: `${at}.${k}`, kind: 'removed', was: p[k] });
      else if (!(k in (p || {}))) out.push({ at: `${at}.${k}`, kind: 'added', now: a[k] });
      else walk(a[k], p[k], `${at}.${k}`, out);
    }
    return;
  }
  if (ta === 'array') {
    if (a.length !== p.length) out.push({ at, kind: 'array-length', from: p.length, to: a.length });
    for (let i = 0; i < Math.max(a.length, p.length); i++) {
      if (i >= a.length) out.push({ at: `${at}[${i}]`, kind: 'removed', was: p[i] });
      else if (i >= p.length) out.push({ at: `${at}[${i}]`, kind: 'added', now: a[i] });
      else walk(a[i], p[i], `${at}[${i}]`, out);
    }
    return;
  }
  out.push({ at, kind: 'value', from: p, to: a });
}

function classify(changes) {
  let breaking = 0;
  let additive = 0;
  let doc = 0;
  for (const c of changes) {
    const leaf = c.at
      .split('.')
      .pop()
      .replace(/\[\d+\]$/, '');
    if (DOC_KEYS.has(leaf)) c.cls = 'documentation';
    else if (c.kind === 'added' || c.kind === 'array-length') c.cls = 'additive';
    else if (c.kind === 'removed' || c.kind === 'type') c.cls = 'BREAKING?';
    else if (leaf === 'enum') c.cls = 'enum';
    else if (leaf === 'required') c.cls = 'required';
    else c.cls = 'value';
    if (c.cls === 'documentation') doc++;
    else if (c.cls === 'additive') additive++;
    else breaking++;
  }
  return { breaking, additive, doc };
}

const section = (label, getter) => {
  const changes = [];
  walk(getter(A), getter(P), label, changes);
  return classify(changes) && changes;
};

const report = [];
for (const [p, item] of Object.entries(A.paths)) {
  for (const m of Object.keys(item)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(m)) continue;
    const label = `${m.toUpperCase()} ${p}`;
    const changes = section(label, (s) => s.paths[p]?.[m]);
    if (changes.length) report.push({ label, changes });
  }
}
for (const [name, schema] of Object.entries(A.components?.schemas ?? {})) {
  const changes = section(`schema ${name}`, (s) => s.components?.schemas?.[name]);
  if (changes.length) report.push({ label: `schema ${name}`, changes });
}

let total = 0;
const totals = { breaking: 0, additive: 0, doc: 0 };
for (const { label, changes } of report) {
  const c = classify(changes);
  totals.breaking += c.breaking;
  totals.additive += c.additive;
  totals.doc += c.doc;
  total += changes.length;
  console.log(`\n## ${label} (${changes.length} changes)`);
  for (const ch of changes.slice(0, 200)) {
    const detail =
      ch.kind === 'value'
        ? `${JSON.stringify(ch.from).slice(0, 80)} → ${JSON.stringify(ch.to).slice(0, 80)}`
        : ch.kind === 'removed'
          ? `removed ${JSON.stringify(ch.was).slice(0, 80)}`
          : ch.kind === 'added'
            ? `added ${JSON.stringify(ch.now).slice(0, 80)}`
            : ch.kind === 'array-length'
              ? `length ${ch.from} → ${ch.to}`
              : `${ch.from} → ${ch.to}`;
    console.log(`- [${ch.cls}] \`${ch.at}\` — ${detail}`);
  }
}
console.log(
  `\n${report.length} changed locations · ${total} leaf changes · ${totals.breaking} require review · ${totals.additive} additive · ${totals.doc} documentation`,
);
