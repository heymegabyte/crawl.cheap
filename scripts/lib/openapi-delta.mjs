/**
 * Single source of truth for the pinned-spec delta walk (MEG-99).
 *
 * Both the reproducible differ (scripts/diff-openapi.mjs) and the disposition guard
 * (scripts/check-delta-disposition.mjs) classify deltas with THIS module, so the counts a
 * review publishes and the counts CI checks can never drift apart.
 *
 * The walk iterates the UNION of the baseline and candidate documents. An operation or
 * schema that exists only in the baseline was REMOVED upstream; walking only candidate
 * keys would silently drop the most breaking delta class.
 */
import crypto from 'node:crypto';

export const DOC_KEYS = new Set(['description', 'title', 'example', 'examples', 'summary', 'format']);
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

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
  let review = 0;
  let additive = 0;
  let documentation = 0;
  for (const c of changes) {
    const leaf = c.at
      .split('.')
      .pop()
      .replace(/\[\d+\]$/, '');
    if (DOC_KEYS.has(leaf)) {
      c.cls = 'documentation';
      documentation++;
    } else if (c.kind === 'added' || c.kind === 'array-length') {
      c.cls = 'additive';
      additive++;
    } else if (c.kind === 'removed' || c.kind === 'type') {
      c.cls = 'BREAKING?';
      review++;
    } else if (leaf === 'enum') {
      c.cls = 'enum';
      review++;
    } else if (leaf === 'required') {
      c.cls = 'required';
      review++;
    } else {
      c.cls = 'value';
      review++;
    }
  }
  return { review, additive, documentation };
}

/** Sections (one per changed operation/schema), each with classified leaf changes. */
export function deltaSections(baseline, candidate) {
  const sections = [];
  const section = (label, getter) => {
    const changes = [];
    walk(getter(candidate), getter(baseline), label, changes);
    if (!changes.length) return;
    classify(changes);
    sections.push({ label, changes });
  };
  const pathKeys = [
    ...new Set([...Object.keys(candidate.paths ?? {}), ...Object.keys(baseline.paths ?? {})]),
  ];
  for (const p of pathKeys) {
    const methods = new Set([
      ...Object.keys(candidate.paths?.[p] ?? {}),
      ...Object.keys(baseline.paths?.[p] ?? {}),
    ]);
    for (const m of methods) {
      if (!METHODS.includes(m)) continue;
      section(`${m.toUpperCase()} ${p}`, (s) => s.paths?.[p]?.[m]);
    }
  }
  const schemaKeys = [
    ...new Set([
      ...Object.keys(candidate.components?.schemas ?? {}),
      ...Object.keys(baseline.components?.schemas ?? {}),
    ]),
  ];
  for (const name of schemaKeys) section(`schema ${name}`, (s) => s.components?.schemas?.[name]);
  return sections;
}

/**
 * Identity of the classified change set: a SHA-256 over every change's location, kind and
 * class. Counts alone cannot prove that the reviewed delta and the observed delta are the
 * same delta; this fingerprint can. Any single unreviewed change alters it.
 */
export function changeSetSha256(sections) {
  const entries = sections
    .flatMap((s) => s.changes.map((c) => ({ at: c.at, kind: c.kind, cls: c.cls })))
    .sort((a, b) => (a.at === b.at ? a.kind.localeCompare(b.kind) : a.at.localeCompare(b.at)));
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(entries))
    .digest('hex');
}

export function classifyDelta(baseline, candidate) {
  const sections = deltaSections(baseline, candidate);
  const totals = { locations: sections.length, review: 0, additive: 0, documentation: 0, leaves: 0 };
  for (const s of sections) {
    const c = classify(s.changes);
    totals.review += c.review;
    totals.additive += c.additive;
    totals.documentation += c.documentation;
    totals.leaves += s.changes.length;
  }
  return { sections, totals, changeSetSha256: changeSetSha256(sections) };
}

export function identityOf(buf) {
  return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}
