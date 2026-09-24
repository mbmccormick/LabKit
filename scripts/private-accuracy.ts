// pnpm test:private — SPEC §15 accuracy run on real reports in fixtures/private/
// (gitignored). Put the answer key for <file> next to it as <file>.expected.json
// (same shape as fixtures/synthetic/*.expected.json).
//
// Prints metrics and JSON paths only. Never prints names, dates or values.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { compact, parse, score, type Expected } from '../packages/parsers/test/harness';
import { ROOT } from './lib';

const dir = `${ROOT}fixtures/private/`;
const files = existsSync(dir) ? readdirSync(dir).filter((f) => !f.endsWith('.json') && !f.startsWith('.')) : [];
if (!files.length) {
  console.log('No files in fixtures/private/.');
  process.exit(0);
}
let expected = 0;
let mapped = 0;
let correct = 0;
let failed = false;
for (const f of files) {
  const report = await parse(dir + f);
  const rows = report.draws.reduce((n, d) => n + d.rows.length, 0);
  const keyPath = `${dir}${f}.expected.json`;
  if (!existsSync(keyPath)) {
    console.log(`${f}: vendor=${report.source.vendor} method=${report.source.method} draws=${report.draws.length} rows=${rows} unmatched=${report.unmatched.length} (no answer key)`);
    continue;
  }
  const s = score(compact(report), JSON.parse(readFileSync(keyPath, 'utf8')) as Expected);
  expected += s.expectedRows;
  mapped += s.mappedRows;
  correct += s.correctRows;
  console.log(`${f}: mapped ${s.mappedRows}/${s.expectedRows}, correct ${s.correctRows}/${s.mappedRows}, unmatched=${report.unmatched.length}`);
  for (const d of s.diffs) console.log(`  - ${d}`);
}
if (expected) {
  const mappedPct = (100 * mapped) / expected;
  const correctPct = mapped ? (100 * correct) / mapped : 0;
  console.log(`\nTOTAL mapped ${mappedPct.toFixed(1)}% (target ≥ 98%), mapped values correct ${correctPct.toFixed(1)}% (target 100%)`);
  failed = mappedPct < 98 || correct !== mapped;
}
process.exit(failed ? 1 : 0);
