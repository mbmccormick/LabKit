// Randox Health "Discovery" layout (UK, SI units). Synthetic names and values only.
import { describe, expect, it } from 'vitest';
import { extractReport } from '../src/extract';
import { groupLines } from '../src/layout';
import type { Page, ParsedVital } from '../src/types';
import { pickTemplate } from '../src/vendors';
import { computeFlag, dedupeVitals, parseBand, randoxCollected, randoxPatient, randoxUnit, referenceBand, type Band } from '../src/vendors/randox';
import { dictionary } from './harness';

type Cell = [x: number, str: string];
const COLS = { name: 40, result: 270, units: 330, range: 410 };

/** A page of positioned items: [y, ...cells] per printed line (y grows downward). */
function page(n: number, rows: [number, ...Cell[]][], h = 9): Page {
  return { page: n, items: rows.flatMap(([y, ...cells]) => cells.map(([x, str]) => ({ str, x, y, w: str.length * 4.5, h, page: n }))) };
}
const hdr = (y: number): [number, ...Cell[]] => [y, [COLS.name, 'Test'], [COLS.result, 'Result'], [COLS.units, 'Units'], [COLS.range, 'Reference Range']];
const row = (y: number, name: string, val: string, unit: string, band = ''): [number, ...Cell[]] =>
  [y, ...([[COLS.name, name], [COLS.result, val], [COLS.units, unit], [COLS.range, band]] as Cell[]).filter((c) => c[1])];

const front = (collected = '14-May-2026 08:45'): Page[] => [
  page(1, [[40, [40, 'RANDOX HEALTH']], [200, [40, 'Discovery']], [770, [40, 'randoxhealth.com']]]),
  page(2, [
    [120, [40, 'Name'], [200, 'Mr Jordan Example']],
    [136, [40, 'DOB'], [200, '03/11/1979']],
    [152, [40, 'Gender'], [200, 'Male']],
    [168, [40, 'Sample Collection Date'], [200, collected]],
  ]),
  // The contents line names the section with a page number; it is not the section itself.
  page(3, [[130, [40, 'Results for your Doctor'], [500, '5']], [146, [40, 'Nutrition Guide'], [500, '9']]]),
  // Marketing bar graph before the results: never read.
  page(4, [hdr(100), row(120, 'Total Cholesterol', '6.1', 'mmol/l', 'Optimal')]),
];
const results = (rows: [number, ...Cell[]][]) => page(5, [[80, [40, 'Results for your Doctor']], hdr(106), ...rows, [770, [40, 'randoxhealth.com'], [560, '5']]]);
const tail = page(6, [[80, [40, 'Nutrition Guide']], hdr(106), row(126, 'Iron', '12.0', 'mg', '8.7 - 14.8 Optimal')]);

const run = (pages: Page[]) => extractReport(pages, { fileName: 'r.pdf', method: 'text', dictionary });
const rowsOf = (r: ReturnType<typeof run>) => r.draws.flatMap((d) => d.rows);

describe('Randox detection', () => {
  it('needs the logo, the results section and the website', () => {
    expect(pickTemplate('RANDOX HEALTH\nResults for your Doctor\nrandoxhealth.com').id).toBe('randox');
    expect(pickTemplate('RANDOX HEALTH\nrandoxhealth.com').id).toBe('generic');
  });

  it('accepts the name in mixed case (real reports draw the logo as an image)', () => {
    expect(pickTemplate('Randox Health\nResults for your Doctor\nrandoxhealth.com').id).toBe('randox');
    // The website alone doesn't count as the name.
    expect(pickTemplate('Results for your Doctor\nrandoxhealth.com').id).toBe('generic');
  });
});

describe('Randox header block', () => {
  it('reads the collection time as UK wall-clock time', () => {
    const at = (s: string) => randoxCollected(groupLines(front(s)))?.iso;
    expect(at('14-May-2026 08:45')).toBe('2026-05-14T07:45:00Z'); // BST
    expect(at('14-Jan-2026 08:45')).toBe('2026-01-14T08:45:00Z'); // GMT
    // Clocks go forward at 01:00 GMT on 29 March 2026.
    expect(at('29-Mar-2026 00:30')).toBe('2026-03-29T00:30:00Z');
    expect(at('29-Mar-2026 03:00')).toBe('2026-03-29T02:00:00Z');
  });

  it('reads the patient with a day-first date of birth', () => {
    expect(randoxPatient(groupLines(front()))).toEqual({ family: 'Example', given: ['Jordan'], birthDate: '1979-11-03', gender: 'male' });
  });
});

describe('Randox reference bands', () => {
  const b = (...xs: string[]) => xs.map(parseBand).filter((x): x is Band => !!x);

  it('parses every printed form', () => {
    expect(parseBand('95.1 - 108.0 Optimal')).toMatchObject({ low: 95.1, high: 108, label: 'Optimal' });
    expect(parseBand('≤95.0 Low')).toMatchObject({ high: 95, highInclusive: true, label: 'Low' });
    expect(parseBand('<0.30')).toMatchObject({ high: 0.3, highInclusive: false, label: '' });
    expect(parseBand('>108.0 High')).toMatchObject({ low: 108, lowInclusive: false });
    expect(parseBand('≥48 High')).toMatchObject({ low: 48, lowInclusive: true });
    expect(parseBand('Negative')).toMatchObject({ qualitative: 'Negative' });
    expect(parseBand('Not Detected')).toMatchObject({ qualitative: 'Not Detected' });
    expect(parseBand('N/A')).toBeUndefined();
  });

  it('uses the Optimal band as the reference range wherever it is printed', () => {
    expect(referenceBand(b('<25 Deficient', '25 - 50 Insufficient', '>50 Optimal'))).toMatchObject({ low: 50 });
    expect(referenceBand(b('<75.0'))).toMatchObject({ high: 75 });
    expect(referenceBand(b('<10 Low Risk', '10 - 20 Moderate Risk'))).toBeUndefined();
  });

  it('flags from the value, not from the band printed beside it', () => {
    const chloride = b('≤95.0 Low', '95.1 - 108.0 Optimal', '>108.0 High');
    expect(computeFlag('93.4', chloride)).toBe('L');
    expect(computeFlag('100', chloride)).toBeUndefined();
    expect(computeFlag('108.1', chloride)).toBe('H');
    expect(computeFlag('95.0', chloride)).toBe('L');
    expect(computeFlag('5.0', b('≤5.0 Optimal', '>5.0 High'))).toBeUndefined();
    expect(computeFlag('1.0', b('≤1.0 Low', '>1.0 Optimal'))).toBe('L');
  });

  it('flags a censored value only when its whole interval is out of range', () => {
    expect(computeFlag('<0.30', b('<1.00 Optimal', '1.00 - 3.00 Moderate', '>3.00 High'))).toBeUndefined();
    expect(computeFlag('<2', b('5 - 10 Optimal'))).toBe('L');
    expect(computeFlag('>90', b('≥60 Optimal'))).toBeUndefined();
  });

  it('flags a qualitative value that differs from the expected one', () => {
    expect(computeFlag('Negative', b('Negative'))).toBeUndefined();
    expect(computeFlag('Positive', b('Negative'))).toBe('A');
  });
});

describe('Randox units', () => {
  it('drops the "-" placeholder and the creatinine suffix', () => {
    expect(randoxUnit('-')).toBeUndefined();
    expect(randoxUnit('mg/mmol creatinine')).toBe('mg/mmol');
    expect(randoxUnit('10⁹/L')).toBe('10⁹/L');
  });
});

describe('Randox results table', () => {
  it('reads only the results section, with evenly spaced lines and bands either side of the value', () => {
    // No row padding: every line 11pt apart, so rows split at the nearer value line.
    const r = run([
      ...front(),
      results([
        [126, [40, 'Kidney Health']],
        [140, [COLS.range, '≤95.0 Low']],
        row(151, 'Chloride', '93.4', 'mmol/l', '95.1 - 108.0 Optimal'),
        [162, [COLS.range, '>108.0 High']],
        [173, [COLS.range, '≤132 Low']],
        row(184, 'Sodium', '140', 'mmol/l', '133 - 146 Optimal'),
        [195, [COLS.range, '>146 High']],
        [206, [40, 'Mean Cell Haemoglobin']],
        [211.5, [COLS.result, '335'], [COLS.units, 'g/l'], [COLS.range, '320.1 - 360.0 Optimal']],
        [217, [40, 'Concentration (MCHC)']],
        [232, [40, 'Physical Measurements']],
        row(246, 'Body Mass Index (BMI)', '25.4', 'kg/m²', '18.5 - 24.9 Optimal'),
        row(257, 'Waist/Hip Ratio', '0.91', 'Ratio', '≤0.95 Optimal'),
      ]),
      tail,
    ]);
    expect(r.source.vendor).toBe('randox');
    const rows = rowsOf(r);
    expect(rows.map((x) => [x.entry?.loinc, x.value, x.range, x.raw.flag])).toEqual([
      ['2075-0', { kind: 'quantity', value: 93.4, ucum: 'mmol/L' }, { low: 95.1, high: 108 }, 'L'],
      ['2951-2', { kind: 'quantity', value: 140, ucum: 'mmol/L' }, { low: 133, high: 146 }, undefined],
      ['786-4', { kind: 'quantity', value: 33.5, ucum: 'g/dL' }, { low: 32.01, high: 36 }, undefined],
    ]);
    expect(r.unmatched).toEqual([]);
    // Body measurements are vitals, not results: out of the card, into the vitals export.
    expect(r.vitals?.rows.map((v) => [v.metric, v.value, v.unit])).toEqual([
      ['bodyMassIndex', 25.4, 'count'],
      ['waistHipRatio', 0.91, 'ratio'],
    ]);
  });

  it('keeps one row per test across panels, with the range from outside Metabolic Syndrome', () => {
    const r = run([
      ...front(),
      results([
        [126, [40, 'Metabolic Syndrome']],
        row(144, 'Triglycerides', '1.20', 'mmol/l', '≤1.70 Optimal'),
        row(161, 'HDL Cholesterol', '1.45', 'mmol/l', '>1.03 Optimal'),
        [184, [40, 'Heart Health']],
        row(202, 'Triglycerides', '1.20', 'mmol/l', '≤2.30 Optimal'),
        // A different value for the same test: both kept and flagged for the user to choose.
        row(219, 'HDL Cholesterol', '1.50', 'mmol/l', '>1.00 Optimal'),
      ]),
      tail,
    ]);
    const rows = rowsOf(r);
    const tg = rows.filter((x) => x.entry?.loinc === '2571-8');
    expect(tg).toHaveLength(1);
    expect(tg[0]).toMatchObject({ range: { high: 203.711 }, raw: { panel: 'Heart Health' }, issues: [] });
    expect(rows.filter((x) => x.entry?.loinc === '2085-9').map((x) => x.issues)).toEqual([['duplicate'], ['duplicate']]);
  });

  it('keeps eGFR under the code that names no equation, pending opt-in; still leaves out risk scores', () => {
    const r = run([
      ...front(),
      results([
        [126, [40, 'Kidney Health']],
        row(144, 'eGFR', '>90', 'ml/min/1.73m²', '≥90 Optimal'),
        row(161, 'FIB-4', '0.85', '-', '<1.30 Low Risk'),
      ]),
      tail,
    ]);
    const rows = rowsOf(r);
    expect(rows.map((x) => [x.entry?.loinc, x.value, x.range, x.issues, x.confidence])).toEqual([
      ['69405-9', { kind: 'quantity', value: 90, ucum: 'mL/min/{1.73_m2}', comparator: '>' }, { low: 90 }, ['formula_not_printed'], 'low'],
    ]);
    // Never the CKD-EPI 2021 code: a different equation would join the wrong trend.
    expect(rows.some((x) => x.entry?.loinc === '98979-8')).toBe(false);
    expect(r.warnings).toContain('Left out 1 calculated score (not lab results).');
  });

  it('keeps one copy of a test printed as "not detected" in two panels', () => {
    const r = run([
      ...front(),
      results([
        [126, [40, 'Diabetes Health']],
        row(144, 'Microalbumin / Creatinine Ratio', 'not detected', 'mg/mmol', 'Not Detected Normal'),
        [184, [40, 'Kidney Health']],
        row(202, 'Microalbumin / Creatinine Ratio', 'not detected', 'mg/mmol', 'Not Detected Normal'),
      ]),
      tail,
    ]);
    const acr = rowsOf(r).filter((x) => x.entry?.loinc === '30000-4');
    expect(acr).toHaveLength(1);
    expect(acr[0]?.issues).not.toContain('duplicate');
    // No number to carry, so it still can't go in the card.
    expect(acr[0]?.value).toBeUndefined();
  });

  it('matches names with the abbreviation dropped, but keeps "(Urine)"', () => {
    const r = run([
      ...front(),
      results([
        [126, [40, 'Liver Health']],
        row(144, 'Albumin (ALB)', '45', 'g/l', '35 - 50 Optimal'),
        [166, [40, 'Urinalysis']],
        row(184, 'Glucose (Urine)', 'Negative', '-', 'Negative'),
      ]),
      tail,
    ]);
    expect(rowsOf(r).map((x) => [x.entry?.loinc, x.value])).toEqual([
      ['1751-7', { kind: 'quantity', value: 4.5, ucum: 'g/dL' }],
      ['25428-4', { kind: 'qualitative', text: 'Negative' }],
    ]);
  });

  it('finds no table without the results section', () => {
    const r = run([...front(), tail]);
    expect(rowsOf(r)).toEqual([]);
  });
});

describe('Randox vitals', () => {
  const vitalsOf = (rows: [number, ...Cell[]][]) => run([...front(), results(rows), tail]);

  it('converts units, keeps Glucose a lab result and leaves out scores', () => {
    const r = vitalsOf([
      [126, [40, 'Personal Health Measurements']],
      row(144, 'Height', '172.5', 'cm'),
      row(161, 'Weight', '176', 'lbs'),
      row(178, 'Blood Pressure', '128/80', 'mmHg'),
      row(195, 'Cardiovascular Risk Score', '4.2', '%'),
      [216, [40, 'Diabetes']],
      row(234, 'Glucose', '5.2', 'mmol/l', '3.9 - 5.5 Optimal'),
    ]);
    expect(r.vitals?.rows.map((v) => [v.metric, v.value, v.unit, v.issues])).toEqual([
      ['height', 1.725, 'm', []],
      ['bodyMass', 79.8323, 'kg', []],
      ['bloodPressureSystolic', 128, 'mmHg', []],
      ['bloodPressureDiastolic', 80, 'mmHg', []],
    ]);
    expect(rowsOf(r).map((x) => x.entry?.loinc)).toEqual(['2345-7']);
    expect(r.warnings).toContain('Left out 1 calculated score (not lab results).');
  });

  it('flags implausible values, unusable units and values that are not numbers', () => {
    const r = vitalsOf([
      [126, [40, 'Personal Health Measurements']],
      row(144, 'Pulse', '300', 'BPM'),
      row(161, 'Height', '5.8', 'ft'),
      row(178, 'Oxygen Saturation', 'N/A', '%'),
    ]);
    expect(r.vitals?.rows.map((v) => [v.metric, v.issues])).toEqual([
      ['heartRate', ['implausible']],
      ['height', ['unit']],
      ['oxygenSaturation', ['unreadable']],
    ]);
  });

  const v = (metric: ParsedVital['metric'], value: number, panel: string): ParsedVital => ({ metric, value, unit: 'x', raw: { name: metric, value: String(value), panel, page: 5, line: '' }, issues: [] });

  it('keeps one copy per metric, from outside Metabolic Syndrome, and flags copies that disagree', () => {
    const out = dedupeVitals([v('bodyMassIndex', 27.1, 'Metabolic Syndrome'), v('bodyMassIndex', 27, 'Personal Health Measurements'), v('waistCircumference', 92, 'Personal Health Measurements')]);
    expect(out.map((x) => [x.metric, x.value, x.raw.panel, x.issues])).toEqual([
      ['bodyMassIndex', 27, 'Personal Health Measurements', ['conflict']],
      ['waistCircumference', 92, 'Personal Health Measurements', []],
    ]);
  });

  it('flags blood pressure whose systolic is not above diastolic', () => {
    const out = dedupeVitals([v('bloodPressureSystolic', 80, 'P'), v('bloodPressureDiastolic', 120, 'P')]);
    expect(out.map((x) => x.issues)).toEqual([['order'], ['order']]);
  });
});
