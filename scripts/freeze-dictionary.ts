// pnpm dictionary:freeze — run at each production release. Adds every current
// entry's {loinc, display, text} hash to FROZEN.json. Existing hashes are never
// rewritten: if one disagrees, the build fails instead (SPEC §6.2 rule 1).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { DictionaryFile } from '@labkit/core';
import { ROOT } from './lib';

const dict = JSON.parse(readFileSync(`${ROOT}dictionary/dictionary.json`, 'utf8')) as DictionaryFile;
const path = `${ROOT}dictionary/FROZEN.json`;
const frozen = JSON.parse(readFileSync(path, 'utf8')) as { note: string; entries: Record<string, string> };
let added = 0;
for (const e of dict.entries) {
  const hash = createHash('sha256').update(JSON.stringify({ loinc: e.loinc, display: e.display, text: e.text })).digest('hex');
  const existing = frozen.entries[e.loinc];
  if (existing && existing !== hash) {
    console.error(`${e.loinc} is frozen and its labels changed. Revert the change.`);
    process.exit(1);
  }
  if (!existing) {
    frozen.entries[e.loinc] = hash;
    added++;
  }
}
writeFileSync(path, JSON.stringify(frozen, null, 2) + '\n');
console.log(`Froze ${added} new entries (${Object.keys(frozen.entries).length} total). Record this in dictionary/CHANGELOG.md.`);
