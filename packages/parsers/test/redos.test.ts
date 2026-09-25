// Regexes that run on report text must stay linear: a long run of spaces or
// digits in a garbled or crafted line used to hang the tab (CodeQL
// js/polynomial-redos). Each group checks the adversarial case finishes quickly
// and that ordinary lines still parse as before.
import { describe, expect, it } from 'vitest';
import { rangeFromNotes } from '../src/rows';
import { extractPatient, parseStampText } from '../src/stamps';
import { COMPARATOR_RANGE_CELL, RANGE_CELL, STAMP_TAIL, UNIT_DIGITS } from '../src/table';
import { dictionary } from './harness';

const N = 50_000;
const spaces = ' '.repeat(N);
const digits = '0'.repeat(N);

/** The old patterns took about a second (quadratic) or minutes (cubic) on these inputs. */
function fast(f: () => unknown) {
  const t = performance.now();
  f();
  expect(performance.now() - t).toBeLessThan(100);
}

const line = (text: string) => ({ page: 1, y: 10, h: 9, text, items: [{ str: text, x: 18 }] });
const glucose = dictionary.byLoinc.get('2345-7')!;

describe('table cell patterns', () => {
  it('stay linear on long digit and space runs', () => {
    fast(() => RANGE_CELL.test(digits + 'x'));
    fast(() => RANGE_CELL.test('0-' + digits + 'x'));
    fast(() => COMPARATOR_RANGE_CELL.test('<' + digits + 'x'));
    fast(() => (digits + 'x').replace(UNIT_DIGITS, ''));
    fast(() => STAMP_TAIL.test('1' + spaces + 'x'));
  });

  it('match what they matched before', () => {
    for (const s of ['3.5-5.0', '.5 - 10 mg/dL', '10-20']) expect(RANGE_CELL.test(s), s).toBe(true);
    for (const s of ['3.5', '1.-2', '3.5-5.0x', '-5']) expect(RANGE_CELL.test(s), s).toBe(false);
    for (const s of ['<150 nmol/L', '< OR = 5.0 mg/dL', '>=.5 x', '≤ 40 U/L']) expect(COMPARATOR_RANGE_CELL.test(s), s).toBe(true);
    for (const s of ['<150', '150 mg', '< .  5 x']) expect(COMPARATOR_RANGE_CELL.test(s), s).toBe(false);
    expect('10*3/uL'.replace(UNIT_DIGITS, '')).toBe('10*L');
    expect('12/hpf 3/lpf'.replace(UNIT_DIGITS, '')).toBe('pf pf');
    for (const s of ['08:40 AM UTC', '8 PM', '08:40', '08:40UTC', '8:40 pm gmt']) expect(STAMP_TAIL.test(s), s).toBe(true);
    for (const s of ['08:40 AM UTC x', '123', 'AM']) expect(STAMP_TAIL.test(s), s).toBe(false);
  });
});

describe('collection stamps', () => {
  it('stay linear on long space runs', () => {
    fast(() => parseStampText('Collected' + spaces + 'x', 'utc'));
    fast(() => parseStampText('Collected date' + spaces + ':' + spaces + 'x', 'utc'));
    fast(() => parseStampText('Collected 04/17/2026 01:40' + spaces + 'x', 'utc'));
  });

  it('parse as before', () => {
    expect(parseStampText('Collected: 04/17/2026 01:40 PM', 'utc')).toEqual({ iso: '2026-04-17T13:40:00Z', timeFound: true, match: 'Collected: 04/17/2026 01:40 PM' });
    expect(parseStampText('Collection Date/Time: 4/17/26 13:40 UTC', 'local')).toEqual({ iso: '2026-04-17T13:40:00Z', timeFound: true, match: 'Collection Date/Time: 4/17/26 13:40 UTC' });
    expect(parseStampText('Date collected on: 04/17/2026 Page 2', 'utc')).toEqual({ iso: '2026-04-17T00:00:00Z', timeFound: false, match: 'Date collected on: 04/17/2026' });
    expect(parseStampText('Specimen collected at  :  04/17/2026, 8:05 A.M.', 'utc')).toEqual({ iso: '2026-04-17T08:05:00Z', timeFound: true, match: 'Specimen collected at  :  04/17/2026, 8:05 A.M.' });
    expect(parseStampText('Collected: 13/17/2026', 'utc')).toBeUndefined();
  });
});

describe('patient header', () => {
  it('stays linear on long space runs', () => {
    fast(() => extractPatient([line('Name:' + spaces + '\n')]));
    fast(() => extractPatient([line('Name: Doe,' + spaces + '1')]));
    fast(() => extractPatient([line('DOB' + spaces + 'x')]));
    fast(() => extractPatient([line('Sex' + spaces + 'x')]));
    fast(() => extractPatient([line('Sex' + spaces + '/' + spaces + 'a' + spaces + ':' + spaces + 'x')]));
  });

  it('reads the same fields as before', () => {
    expect(extractPatient([line('Patient Name: DOE, JANE A  DOB: 01/02/1990  Sex: F')])).toEqual({ family: 'Doe', given: ['Jane', 'A'], birthDate: '1990-01-02', gender: 'female' });
    expect(extractPatient([line('Name: Jane Q. Public Age: 36'), line('Gender/Sex : Male'), line('Date of Birth 1990-01-02')])).toEqual({ family: 'Public', given: ['Jane', 'Q'], birthDate: '1990-01-02', gender: 'male' });
    expect(extractPatient([line("Patient: O'Neil, Mary-Kate")])).toEqual({ family: "O'Neil", given: ['Mary-Kate'] });
    expect(extractPatient([line('Name:   ')])).toEqual({});
  });
});

describe('reference range in the comment', () => {
  it('stays linear on long space runs', () => {
    fast(() => rangeFromNotes(['Reference range' + spaces + 'a' + spaces + 'a\nb'], 'mg/dL', glucose));
  });

  it('reads the same ranges as before', () => {
    expect(rangeFromNotes(['Reference range: 65-99'], 'mg/dL', glucose)).toEqual({ low: 65, high: 99 });
    expect(rangeFromNotes(['  Reference   range   <100  mg/dL  '], 'mg/dL', glucose)).toEqual({ high: 100 });
    expect(rangeFromNotes(['Reference range:'], 'mg/dL', glucose)).toBeUndefined();
    expect(rangeFromNotes(['Reference ranges: 65-99'], 'mg/dL', glucose)).toBeUndefined();
  });
});
