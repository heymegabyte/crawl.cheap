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
 *
 * The walk itself lives in scripts/lib/openapi-delta.mjs, shared with the disposition
 * guard, so the counts a review publishes and the counts CI enforces cannot drift apart.
 */
import fs from 'node:fs';
import { classifyDelta } from './lib/openapi-delta.mjs';

const [baselinePath, candidatePath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) {
  console.error('usage: node scripts/diff-openapi.mjs <baseline.json> <candidate.json>');
  process.exit(2);
}

const result = classifyDelta(
  JSON.parse(fs.readFileSync(baselinePath, 'utf8')),
  JSON.parse(fs.readFileSync(candidatePath, 'utf8')),
);
const report = result.sections;

let total = 0;

for (const { label, changes } of report) {
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
const t = result.totals;
console.log(
  `\n${t.locations} changed locations · ${t.leaves} leaf changes · ${t.review} require review · ${t.additive} additive · ${t.documentation} documentation`,
);
console.log(`classified change-set sha256: ${result.changeSetSha256}`);
