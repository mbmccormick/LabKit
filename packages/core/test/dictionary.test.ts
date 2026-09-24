import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dictionaryFileSchema } from '../src/dictionary-schema';
import { loadDictionary } from '../src/dictionary';
import { printedToUcum } from '../src/normalize';
import { dictionary, dictionaryFile, readJson } from './helpers';

const frozen = readJson<{ entries: Record<string, string> }>('dictionary/FROZEN.json');
export const frozenHash = (e: { loinc: string; display: string; text: string }) =>
  createHash('sha256').update(JSON.stringify({ loinc: e.loinc, display: e.display, text: e.text })).digest('hex');

describe('dictionary (SPEC §6, §15)', () => {
  it('matches the schema', () => {
    const r = dictionaryFileSchema.safeParse(dictionaryFile);
    expect(r.success ? [] : r.error.issues).toEqual([]);
  });

  it('has unique LOINC codes', () => {
    const codes = dictionaryFile.entries.map((e) => e.loinc);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every quantity entry a ucum unit and plausible bounds', () => {
    for (const e of dictionaryFile.entries) {
      if (e.valueType === 'quantity') {
        expect(e.ucum, e.loinc).toBeTruthy();
        expect(e.plausible, e.loinc).toBeDefined();
        expect(e.plausible!.min, e.loinc).toBeLessThan(e.plausible!.max);
      } else {
        expect(e.ucum, e.loinc).toBeNull();
        expect(e.unitConversions, e.loinc).toBeUndefined();
      }
    }
  });

  it('only defines conversions from units the alias table knows', () => {
    for (const e of dictionaryFile.entries) {
      for (const c of e.unitConversions ?? []) {
        expect(c.from, e.loinc).not.toBe(e.ucum);
        expect(Object.values({ ...e.unitAliases }).includes(c.from) || printedToUcum(c.from) === c.from, `${e.loinc} ${c.from}`).toBe(true);
      }
    }
  });

  it('resolves every alias uniquely per (vendor, panel)', () => {
    const seen = new Map<string, string>();
    for (const e of dictionaryFile.entries) {
      for (const a of e.aliases) {
        const k = `${a.vendor}|${a.panel ?? ''}|${a.name.toLowerCase().replace(/\s+/g, ' ').trim()}`;
        expect(seen.get(k) ?? e.loinc, k).toBe(e.loinc);
        seen.set(k, e.loinc);
        const m = dictionary.match(a.vendor, a.name, a.panel);
        expect(m.kind === 'exact' && m.entry.loinc).toBe(e.loinc);
      }
    }
  });

  it('never makes SARS-CoV-2 or immunization codes signable', () => {
    for (const e of dictionaryFile.entries) {
      if (/sars-cov-2|covid|immuniz|vaccin/i.test(`${e.display} ${e.text}`)) expect(e.excludeFromSigning, e.loinc).toBe(true);
    }
  });

  it('agrees with FROZEN.json for every released entry', () => {
    for (const [loinc, hash] of Object.entries(frozen.entries)) {
      const e = dictionary.byLoinc.get(loinc);
      expect(e, `frozen entry ${loinc} was removed`).toBeDefined();
      expect(frozenHash(e!), `frozen entry ${loinc} changed loinc/display/text`).toBe(hash);
    }
  });

  it('search finds by label, alias and code', () => {
    expect(dictionary.search('apo b')[0]?.loinc).toBe('1884-6');
    expect(dictionary.search('hs-crp')[0]?.loinc).toBe('30522-7');
    expect(dictionary.search('1884-6')[0]?.loinc).toBe('1884-6');
    expect(dictionary.search('ldl').length).toBeGreaterThan(3);
    expect(dictionary.search('')).toEqual([]);
  });

  it('never matches serum and urine analytes by bare name across panels', () => {
    const m = dictionary.match('function', 'Glucose');
    expect(m.kind === 'exact' && m.entry.loinc).toBe('2345-7');
    const u = dictionary.match('function', 'Glucose - Urine');
    expect(u.kind === 'exact' && u.entry.loinc).toBe('25428-4');
  });

  it('reports ambiguity instead of guessing', () => {
    const d = loadDictionary({
      entries: [
        { loinc: '1-1', display: 'a', text: 'a', category: 'other', valueType: 'qualitative', ucum: null, aliases: [{ vendor: 'quest', name: 'X' }] },
        { loinc: '2-2', display: 'b', text: 'b', category: 'other', valueType: 'qualitative', ucum: null, aliases: [{ vendor: 'quest', name: 'x' }] },
      ],
    });
    expect(d.match('quest', 'X').kind).toBe('ambiguous');
    expect(d.match('labcorp', 'X').kind).toBe('none');
  });
});
