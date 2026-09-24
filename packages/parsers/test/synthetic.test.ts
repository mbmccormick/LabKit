import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compact, parse, root, score, type Expected } from './harness';

const dir = `${root}fixtures/synthetic/`;
const fixtures = readdirSync(dir).filter((f) => !f.endsWith('.json') && !f.startsWith('.'));

describe('synthetic fixtures (SPEC §15 Parsers)', () => {
  it('has fixtures', () => expect(fixtures.length).toBeGreaterThanOrEqual(4));

  for (const f of fixtures) {
    it(f, async () => {
      const exp = JSON.parse(readFileSync(`${dir}${f}.expected.json`, 'utf8')) as Expected;
      const report = await parse(dir + f);
      const s = score(compact(report), exp);
      expect(s.diffs).toEqual([]);
      expect(s.correctRows).toBe(s.expectedRows);
    });
  }

  it('never takes values from Previous Result columns', async () => {
    for (const f of ['quest-sample.pdf', 'function-results-of-record.pdf', 'labcorp-sample.pdf']) {
      const r = await parse(dir + f);
      const values = r.draws.flatMap((d) => d.rows.map((row) => (row.value?.kind === 'quantity' ? row.value.value : null)));
      // Previous values in the fixtures: 201, 52, 99, 120, 6.1, 2890, 101, 5.6, 95, 5.5, 130
      for (const prev of [201, 52, 99, 120, 6.1, 2.89, 101, 5.6, 95, 5.5, 130]) expect(values, `${f} ${prev}`).not.toContain(prev);
    }
  });
});
