import { describe, expect, it } from 'vitest';
import {
  cleanUnit,
  normalizeQualitativeCase,
  parseCell,
  parseFlag,
  parseRange,
  parseTiter,
  printedToUcum,
  resolveUnit,
  roundSig,
  applyFactor,
  isPlausible,
  ucumLabel,
} from '../src/normalize';
import { dictionary } from './helpers';

const entry = (loinc: string) => dictionary.byLoinc.get(loinc)!;

describe('value grammar (SPEC §12.4)', () => {
  it.each([
    ['88', { kind: 'quantity', value: 88 }],
    ['47.0', { kind: 'quantity', value: 47 }],
    ['0.80', { kind: 'quantity', value: 0.8 }],
    ['.5', { kind: 'quantity', value: 0.5 }],
    ['<0.2', { kind: 'quantity', value: 0.2, comparator: '<' }],
    ['< 0.2', { kind: 'quantity', value: 0.2, comparator: '<' }],
    ['<=10', { kind: 'quantity', value: 10, comparator: '<=' }],
    ['>=60', { kind: 'quantity', value: 60, comparator: '>=' }],
    ['> 90', { kind: 'quantity', value: 90, comparator: '>' }],
    ['< OR = 0.2', { kind: 'quantity', value: 0.2, comparator: '<=' }],
    ['> OR = 60', { kind: 'quantity', value: 60, comparator: '>=' }],
    ['<or=5', { kind: 'quantity', value: 5, comparator: '<=' }],
    ['1:40', { kind: 'titer', text: '1:40' }],
    ['1 : 320', { kind: 'titer', text: '1:320' }],
    ['NEGATIVE', { kind: 'qualitative', text: 'Negative' }],
    ['positive', { kind: 'qualitative', text: 'Positive' }],
    ['NONE SEEN', { kind: 'qualitative', text: 'None seen' }],
    ['NOT DETECTED', { kind: 'qualitative', text: 'Not detected' }],
    ['CLEAR', { kind: 'qualitative', text: 'Clear' }],
    ['YELLOW', { kind: 'qualitative', text: 'Yellow' }],
    ['1+', { kind: 'qualitative', text: '1+' }],
    ['AB', { kind: 'qualitative', text: 'AB' }],
  ])('parses %s', (input, expected) => {
    expect(parseCell(input)).toEqual(expected);
  });

  it.each(['', 'abc', '1.2.3', '<', '< OR =', '12a', '-5', '1,234', 'H'])('rejects %j', (input) => {
    expect(parseCell(input)).toBeUndefined();
  });

  it('flags', () => {
    expect(parseFlag('H')).toBe('H');
    expect(parseFlag('ll')).toBe('LL');
    expect(parseFlag('X')).toBeUndefined();
  });

  it('titers from either form', () => {
    expect(parseTiter('40')).toBe('1:40');
    expect(parseTiter('1:80')).toBe('1:80');
    expect(parseTiter('0')).toBeUndefined();
    expect(parseTiter('1:4.5')).toBeUndefined();
  });
});

describe('ranges', () => {
  it.each([
    ['3.5-5.0', { low: 3.5, high: 5 }],
    ['3.5 - 5.0', { low: 3.5, high: 5 }],
    ['<90', { high: 90 }],
    ['< OR = 90', { high: 90 }],
    ['>40', { low: 40 }],
    ['> OR = 40', { low: 40 }],
    ['NEGATIVE', { qualitative: 'Negative' }],
  ])('parses %s', (input, expected) => {
    expect(parseRange(input)).toEqual(expected);
  });
  it('rejects inverted ranges and junk', () => {
    expect(parseRange('5-3')).toBeUndefined();
    expect(parseRange('see note')).toBeUndefined();
  });
});

describe('qualitative casing', () => {
  it('normalizes to sentence case and respects entry answers', () => {
    expect(normalizeQualitativeCase('NOT  DETECTED')).toBe('Not detected');
    expect(normalizeQualitativeCase('negative', ['Negative', 'Positive'])).toBe('Negative');
    expect(normalizeQualitativeCase('o')).toBe('O');
    expect(normalizeQualitativeCase('RH POSITIVE')).toBe('Rh positive');
  });
});

describe('units (SPEC §6.3)', () => {
  it.each([
    ['mg/dL', 'mg/dL'],
    ['mcg/dL', 'ug/dL'],
    ['mcg/L', 'ug/L'],
    ['umol/L', 'umol/L'],
    ['µmol/L', 'umol/L'],
    ['μmol/L', 'umol/L'],
    ['IU/mL', '[IU]/mL'],
    ['uIU/mL', 'u[IU]/mL'],
    ['µIU/mL', 'u[IU]/mL'],
    ['mIU/mL', 'm[IU]/mL'],
    ['mIU/L', 'm[IU]/L'],
    ['% by wt', '%'],
    ['Thousand/uL', '10*3/uL'],
    ['K/uL', '10*3/uL'],
    ['x10E3/uL', '10*3/uL'],
    ['Million/uL', '10*6/uL'],
    ['M/uL', '10*6/uL'],
    ['x10E6/uL', '10*6/uL'],
    ['cells/uL', '/uL'],
    ['mL/min/1.73m2', 'mL/min/{1.73_m2}'],
    ['Angstrom', 'Ao'],
    ['Å', 'Ao'],
    ['mg/dL (calc)', 'mg/dL'],
    ['MG/DL', 'mg/dL'],
  ])('%s → %s', (printed, ucum) => {
    expect(printedToUcum(printed)).toBe(ucum);
  });

  it('does not case-fold M/uL into milli', () => {
    expect(printedToUcum('m/uL')).toBeUndefined();
  });

  it('strips annotations', () => {
    expect(cleanUnit(' mg/dL  (calc) ')).toBe('mg/dL');
  });

  it('resolves to the canonical unit directly', () => {
    expect(resolveUnit('mg/dL', entry('1884-6'))).toEqual({ ok: true, ucum: 'mg/dL', factor: 1 });
  });

  it('applies exact conversions: cells/uL → 10*3/uL ×0.001', () => {
    const r = resolveUnit('cells/uL', entry('751-8'));
    expect(r).toEqual({ ok: true, ucum: '10*3/uL', factor: 0.001 });
    expect(applyFactor(3120, 0.001)).toBe(3.12);
    expect(applyFactor(1234.5678, 0.001)).toBe(1.23457);
  });

  it('reports unit mismatch (no molar/mass conversion)', () => {
    expect(resolveUnit('mmol/L', entry('2093-3'))).toEqual({ ok: false, reason: 'unit_mismatch' });
    expect(resolveUnit('furlongs', entry('2093-3'))).toEqual({ ok: false, reason: 'unit_mismatch' });
  });

  it('flags a missing unit unless the canonical unit is unitless', () => {
    expect(resolveUnit(undefined, entry('2093-3'))).toEqual({ ok: true, ucum: 'mg/dL', factor: 1, missing: true });
    expect(resolveUnit('', entry('9830-1'))).toEqual({ ok: true, ucum: '{ratio}', factor: 1 });
  });

  it('qualitative entries have no unit', () => {
    expect(resolveUnit('mg/dL', entry('8061-4'))).toEqual({ ok: false, reason: 'not_quantity' });
  });

  it('plausibility uses the canonical unit', () => {
    expect(isPlausible(3.12, entry('751-8'))).toBe(true);
    expect(isPlausible(3120, entry('751-8'))).toBe(false);
  });

  it('rounds to 6 significant digits', () => {
    expect(roundSig(0.1 + 0.2)).toBe(0.3);
    expect(roundSig(123456789)).toBe(123457000);
  });

  it('labels UCUM for humans', () => {
    expect(ucumLabel('10*3/uL')).toBe('×10³/µL');
    expect(ucumLabel('ug/dL')).toBe('µg/dL');
    expect(ucumLabel('mg/dL')).toBe('mg/dL');
  });
});
