// pnpm fixtures — writes synthetic lab reports (fake patients) + expected JSON
// into fixtures/synthetic/. Expected values come from the row definitions
// below, never from parser output.
import { mkdirSync, writeFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { ROOT } from './lib';

type Expect = {
  loinc: string;
  value: number | string;
  comparator?: string;
  ucum?: string;
  low?: number;
  high?: number;
  confidence: 'high' | 'medium' | 'low';
  issues?: string[];
};
type Row = { name: string; val: string; flag?: string; range?: string; unit?: string; prev?: string; prevDate?: string; wrap?: string; comment?: string[]; expect: Expect | 'unmatched' | null };
type Section = { panel?: string; stamp?: string; rows: Row[] };
type Collected = { utc: string } | { local: string };
type Fixture = {
  name: string;
  vendor: string;
  headerBlock: string[];
  sections: Section[];
  patient: Record<string, unknown>;
  draws: { collected: Collected; loincs: string[] }[];
};

const OUT = `${ROOT}fixtures/synthetic`;
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- data

const questSections: Section[] = [
  {
    panel: 'LIPID PANEL, STANDARD',
    stamp: 'Collected: 04/17/2026 01:40 PM',
    rows: [
      { name: 'CHOLESTEROL, TOTAL', val: '182', range: '<200', unit: 'mg/dL', prev: '201', prevDate: '10/23/2024', expect: { loinc: '2093-3', value: 182, ucum: 'mg/dL', high: 200, confidence: 'high' } },
      { name: 'HDL CHOLESTEROL', val: '58', range: '> OR = 40', unit: 'mg/dL', prev: '52', prevDate: '10/23/2024', expect: { loinc: '2085-9', value: 58, ucum: 'mg/dL', low: 40, confidence: 'high' } },
      { name: 'TRIGLYCERIDES', val: '162', flag: 'H', range: '<150', unit: 'mg/dL', prev: '99', prevDate: '10/23/2024', expect: { loinc: '2571-8', value: 162, ucum: 'mg/dL', high: 150, confidence: 'high' } },
      {
        name: 'LDL-CHOLESTEROL',
        val: '97',
        unit: 'mg/dL (calc)',
        prev: '120',
        prevDate: '10/23/2024',
        comment: ['Desirable range <100 mg/dL for primary prevention;', 'For patients with CHD or diabetic patients with', '<70 mg/dL for patients with CHD or diabetic patients'],
        expect: { loinc: '13457-7', value: 97, ucum: 'mg/dL', confidence: 'high', issues: ['no_range'] },
      },
    ],
  },
  {
    panel: 'CBC (INCLUDES DIFF/PLT)',
    rows: [
      { name: 'WHITE BLOOD CELL COUNT', val: '5.8', range: '3.8-10.8', unit: 'Thousand/uL', prev: '6.1', prevDate: '10/23/2024', expect: { loinc: '6690-2', value: 5.8, ucum: '10*3/uL', low: 3.8, high: 10.8, confidence: 'high' } },
      { name: 'HEMOGLOBIN', val: '13.9', range: '11.7-15.5', unit: 'g/dL', expect: { loinc: '718-7', value: 13.9, ucum: 'g/dL', low: 11.7, high: 15.5, confidence: 'high' } },
      { name: 'ABSOLUTE NEUTROPHILS', val: '3120', range: '1500-7800', unit: 'cells/uL', prev: '2890', prevDate: '10/23/2024', expect: { loinc: '751-8', value: 3.12, ucum: '10*3/uL', low: 1.5, high: 7.8, confidence: 'high' } },
      { name: 'NEUTROPHILS', val: '53.8', unit: '%', expect: { loinc: '770-8', value: 53.8, ucum: '%', confidence: 'high', issues: ['no_range'] } },
    ],
  },
  {
    panel: 'COMPREHENSIVE METABOLIC PANEL',
    rows: [
      { name: 'GLUCOSE', val: '88', range: '65-99', unit: 'mg/dL', prev: '101', prevDate: '10/23/2024', expect: { loinc: '2345-7', value: 88, ucum: 'mg/dL', low: 65, high: 99, confidence: 'high' } },
      { name: 'UREA NITROGEN (BUN)', val: '14', range: '7-25', unit: 'mg/dL', expect: { loinc: '3094-0', value: 14, ucum: 'mg/dL', low: 7, high: 25, confidence: 'high' } },
      { name: 'BUN/CREATININE RATIO', val: '12', range: '6-22', unit: '(calc)', expect: 'unmatched' },
      { name: 'SODIUM', val: '14', flag: 'L', range: '135-146', unit: 'mmol/L', expect: { loinc: '2951-2', value: 14, ucum: 'mmol/L', low: 135, high: 146, confidence: 'low', issues: ['implausible'] } },
      { name: 'EGFR', val: '98', range: '> OR = 60', unit: 'mL/min/1.73m2', expect: { loinc: '98979-8', value: 98, ucum: 'mL/min/{1.73_m2}', low: 60, confidence: 'high' } },
      { name: 'HS CRP', val: '<0.2', range: '<1.0', unit: 'mg/L', expect: { loinc: '30522-7', value: 0.2, comparator: '<', ucum: 'mg/L', high: 1, confidence: 'high' } },
      { name: 'VITAMIN D,25-OH,TOTAL,', wrap: 'IA', val: '45', range: '30-100', unit: 'ng/mL', expect: { loinc: '62292-8', value: 45, ucum: 'ng/mL', low: 30, high: 100, confidence: 'high' } },
    ],
  },
  {
    panel: 'URINALYSIS, COMPLETE',
    rows: [
      { name: 'COLOR', val: 'YELLOW', range: 'YELLOW', expect: { loinc: '5778-6', value: 'Yellow', confidence: 'high' } },
      { name: 'GLUCOSE', val: 'NEGATIVE', range: 'NEGATIVE', expect: { loinc: '25428-4', value: 'Negative', confidence: 'high' } },
      { name: 'SPECIFIC GRAVITY', val: '1.018', range: '1.001-1.035', expect: { loinc: '2965-2', value: 1.018, ucum: '1', low: 1.001, high: 1.035, confidence: 'high' } },
      { name: 'PH', val: '6.0', range: '5.0-8.0', expect: { loinc: '5803-2', value: 6, ucum: '[pH]', low: 5, high: 8, confidence: 'high' } },
    ],
  },
  {
    panel: 'HEMOGLOBIN A1c',
    stamp: 'Collected: 04/18/2026 08:05 AM',
    rows: [
      { name: 'HEMOGLOBIN A1c', val: '5.4', range: '<5.7', unit: '% of total Hgb', prev: '5.6', prevDate: '10/23/2024', expect: { loinc: '4548-4', value: 5.4, ucum: '%', high: 5.7, confidence: 'high' } },
      { name: 'ANA SCREEN, IFA', val: 'NEGATIVE', range: 'NEGATIVE', expect: { loinc: '8061-4', value: 'Negative', confidence: 'high' } },
      { name: 'TSH', val: '1.62', range: '0.40-4.50', unit: 'mIU/L', expect: { loinc: '3016-3', value: 1.62, ucum: 'm[IU]/L', low: 0.4, high: 4.5, confidence: 'high' } },
    ],
  },
];

const questPatient = { family: 'Example', given: ['Taylor', 'Q'], birthDate: '1990-03-04', gender: 'female' };
const loincsOf = (secs: Section[]) => secs.flatMap((s) => s.rows).flatMap((r) => (r.expect && r.expect !== 'unmatched' ? [r.expect.loinc] : []));

// ---------------------------------------------------------------- PDF helpers

type Col = { x: number; label: string };

class PdfWriter {
  page!: PDFPage;
  y = 0;
  pageNo = 0;
  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    readonly cols: Col[],
    readonly top: string[],
    readonly footer: (n: number) => string,
  ) {}
  newPage() {
    if (this.page) this.text(this.footer(this.pageNo), 36, 30);
    this.page = this.doc.addPage([612, 792]);
    this.pageNo++;
    this.y = 750;
    for (const t of this.top) this.line([[36, t]]);
    this.y -= 6;
    this.line(this.cols.map((c) => [c.x, c.label] as [number, string]), true);
  }
  text(s: string, x: number, y: number, b = false) {
    this.page.drawText(s, { x, y, size: 8.5, font: b ? this.bold : this.font });
  }
  line(cells: [number, string][], b = false) {
    if (!this.page || this.y < 60) this.newPage();
    for (const [x, s] of cells) if (s) this.text(s, x, this.y, b);
    this.y -= 12;
  }
  finish() {
    this.text(this.footer(this.pageNo), 36, 30);
  }
}

async function makePdf(f: Fixture, cols: Col[], render: (w: PdfWriter, r: Row) => void, footer: (n: number) => string, pageBreakAfter?: string) {
  const doc = await PDFDocument.create();
  doc.setTitle('Synthetic lab report');
  const w = new PdfWriter(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold), cols, f.headerBlock, footer);
  w.newPage();
  for (const s of f.sections) {
    if (s.panel === pageBreakAfter) w.y = 0; // force a page break before this panel
    if (s.panel) w.line([[cols[0]!.x, s.panel]], true);
    if (s.stamp) w.line([[cols[0]!.x, s.stamp]]);
    for (const r of s.rows) {
      render(w, r);
      if (r.wrap) w.line([[cols[0]!.x, r.wrap]]);
      for (const c of r.comment ?? []) w.line([[cols[0]!.x + 12, c]]);
    }
  }
  w.finish();
  if (f.vendor === 'quest') {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const cardio = doc.addPage([612, 792]);
    const t = (s: string, x: number, yy: number) => cardio.drawText(s, { x, y: yy, size: 8.5, font });
    t('Collected: 04/18/2026 08:05 AM', 39, 640);
    for (const [x, s] of [[39, 'Analyte Name'], [227, 'In Range'], [294, 'Out Range'], [404, 'Reference Range'], [553, 'Lab']] as const) t(s, x, 620);
    t('LDL SMALL', 39, 600);
    t('142', 237, 600);
    t('<162 nmol/L', 353, 600); // centred: starts nearer "Out Range" than "Reference Range"
    t('Z4M', 553, 600);
    t('LIPOPROTEIN (a)', 39, 586);
    t('<10', 237, 586);
    t('nmol/L', 404, 586);
    t('Z4M', 553, 586);
    t('Verified by repeat analysis.', 372, 576); // a note, not a wrapped unit
    // History table after the results: columns are earlier dates, so nothing here is current.
    const p = doc.addPage([612, 792]);
    p.drawText('PATIENT HISTORY REPORT', { x: 243, y: 596, size: 8.5, font });
    p.drawText('Test Name', { x: 37, y: 548, size: 8.5, font });
    p.drawText('10/23/2024', { x: 235, y: 548, size: 8.5, font });
    p.drawText('04/17/2026', { x: 298, y: 548, size: 8.5, font });
    // Values sit under the report's In Range / Out Of Range columns, as in real exports.
    p.drawText('LDL PATTERN', { x: 37, y: 509, size: 8.5, font });
    p.drawText('A', { x: 255, y: 509, size: 8.5, font });
    p.drawText('-', { x: 322, y: 509, size: 8.5, font });
    p.drawText('FERRITIN', { x: 37, y: 488, size: 8.5, font });
    p.drawText('88', { x: 252, y: 488, size: 8.5, font });
    p.drawText('91', { x: 318, y: 488, size: 8.5, font });
  }
  writeFileSync(`${OUT}/${f.name}`, await doc.save({ useObjectStreams: false }));
}

function expected(f: Fixture) {
  const byLoinc = new Map(f.sections.flatMap((s) => s.rows).flatMap((r) => (r.expect && r.expect !== 'unmatched' ? [[r.expect.loinc, r.expect] as const] : [])));
  return {
    vendor: f.vendor,
    patient: f.patient,
    draws: f.draws.map((d) => ({ collected: d.collected, rows: d.loincs.map((l) => ({ issues: [], ...byLoinc.get(l)! })) })),
    unmatched: f.sections.flatMap((s) => s.rows).filter((r) => r.expect === 'unmatched').map((r) => r.name),
  };
}

function save(f: Fixture) {
  writeFileSync(`${OUT}/${f.name}.expected.json`, JSON.stringify(expected(f), null, 2) + '\n');
}

// ---------------------------------------------------------------- Quest PDF

const quest: Fixture = {
  name: 'quest-sample.pdf',
  vendor: 'quest',
  headerBlock: ['Quest Diagnostics Incorporated        SYNTHETIC SAMPLE REPORT', 'Patient Name: EXAMPLE, TAYLOR Q', 'DOB: 03/04/1990     Sex: F', 'Report Status: FINAL'],
  sections: questSections,
  patient: questPatient,
  draws: [
    { collected: { utc: '2026-04-17T13:40:00Z' }, loincs: loincsOf(questSections.slice(0, 4)) },
    { collected: { utc: '2026-04-18T08:05:00Z' }, loincs: loincsOf(questSections.slice(4)) },
  ],
};
const questCols: Col[] = [
  { x: 36, label: 'Test Name' },
  { x: 250, label: 'In Range' },
  { x: 315, label: 'Out Of Range' },
  { x: 400, label: 'Reference Range' },
  { x: 545, label: 'Lab' },
];
await makePdf(
  quest,
  questCols,
  (w, r) =>
    w.line([
      [36, r.name],
      [r.flag ? 315 : 250, r.flag ? `${r.val} ${r.flag}` : r.val],
      [400, [r.range, r.unit].filter(Boolean).join(' ')],
      [545, 'Z4M'],
    ]),
  (n) => `Page ${n} of 2`,
  'URINALYSIS, COMPLETE',
);
save(quest);
{
  // Rows from the Cardio IQ page added in makePdf (second collection).
  const path = `${OUT}/${quest.name}.expected.json`;
  const e = JSON.parse((await import('node:fs')).readFileSync(path, 'utf8'));
  e.draws[1].rows.push(
    { issues: [], loinc: '43727-7', value: 142, ucum: 'nmol/L', high: 162, confidence: 'high' },
    { loinc: '43583-4', value: 10, comparator: '<', ucum: 'nmol/L', confidence: 'high', issues: ['no_range'] },
  );
  writeFileSync(path, JSON.stringify(e, null, 2) + '\n');
}

// ---------------------------------------------------------------- Health Gorilla ZIP (Function "results of record")

const hg: Fixture = { ...quest, name: 'function-results-of-record.pdf', vendor: 'quest-healthgorilla' };
{
  const widths = [40, 12, 14, 26, 18, 12, 6];
  const pad = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('').trimEnd();
  const pages: string[][] = [[]];
  const header = pad(['Test', 'In Range', 'Out Of Range', 'Reference Range', 'Previous Result', 'Date', 'Lab']);
  const begin = (p: string[]) => p.push(...hg.headerBlock.map((l) => l.replace('Quest Diagnostics Incorporated', 'Quest Diagnostics')), '', header);
  begin(pages[0]!);
  for (const s of hg.sections) {
    if (s.panel === 'URINALYSIS, COMPLETE') {
      pages[0]!.push('', 'Printed from Health Gorilla. Confidential health information.', 'Page 1 of 2');
      pages.push([]);
      begin(pages[1]!);
    }
    const p = pages.at(-1)!;
    if (s.panel) p.push(s.panel);
    if (s.stamp) p.push(s.stamp);
    for (const r of s.rows) {
      p.push(pad([r.name, r.flag ? '' : r.val, r.flag ? `${r.val} ${r.flag}` : '', [r.range, r.unit].filter(Boolean).join(' '), r.prev ?? '', r.prevDate ?? '', 'Z4M']));
      if (r.wrap) p.push(r.wrap);
      for (const c of r.comment ?? []) p.push(`  ${c}`);
    }
  }
  pages.at(-1)!.push('', 'Printed from Health Gorilla. Confidential health information.', 'Page 2 of 2');
  const files: Record<string, Uint8Array> = {};
  pages.forEach((p, i) => (files[`${i + 1}.txt`] = strToU8(p.join('\n') + '\n')));
  // Deliberately a ".pdf" name: Function's downloads are ZIPs with a .pdf extension.
  writeFileSync(`${OUT}/${hg.name}`, zipSync(files));
  save(hg);
}

// ---------------------------------------------------------------- Labcorp PDF

const labcorpSections: Section[] = [
  {
    rows: [
      { name: 'Glucose', val: '105', flag: 'High', unit: 'mg/dL', range: '70-99', prev: '95 04/01/2025', expect: { loinc: '2345-7', value: 105, ucum: 'mg/dL', low: 70, high: 99, confidence: 'high' } },
      { name: 'Hemoglobin A1c', val: '5.4', unit: '%', range: '4.8-5.6', prev: '5.5 04/01/2025', expect: { loinc: '4548-4', value: 5.4, ucum: '%', low: 4.8, high: 5.6, confidence: 'high' } },
      { name: 'Cholesterol, Total', val: '182', unit: 'mg/dL', range: '100-199', expect: { loinc: '2093-3', value: 182, ucum: 'mg/dL', low: 100, high: 199, confidence: 'high' } },
      { name: 'LDL Chol Calc (NIH)', val: '97', unit: 'mg/dL', range: '0-99', prev: '130 04/01/2025', expect: { loinc: '13457-7', value: 97, ucum: 'mg/dL', low: 0, high: 99, confidence: 'high' } },
      { name: 'WBC', val: '5.8', unit: 'x10E3/uL', range: '3.4-10.8', expect: { loinc: '6690-2', value: 5.8, ucum: '10*3/uL', low: 3.4, high: 10.8, confidence: 'high' } },
      { name: 'Neutrophils (Absolute)', val: '3.1', unit: 'x10E3/uL', range: '1.4-7.0', expect: { loinc: '751-8', value: 3.1, ucum: '10*3/uL', low: 1.4, high: 7, confidence: 'high' } },
      { name: 'Lymphs', val: '30', unit: '%', range: 'Not Estab.', expect: { loinc: '736-9', value: 30, ucum: '%', confidence: 'high', issues: ['no_range'] } },
      { name: 'Vitamin B12', val: '612', unit: 'pg/mL', range: '232-1245', expect: 'unmatched' },
      { name: 'Cholesterol, Total', val: '5.2', unit: 'mmol/L', range: '2.6-5.2', expect: null },
    ],
  },
];
const labcorp: Fixture = {
  name: 'labcorp-sample.pdf',
  vendor: 'labcorp',
  headerBlock: ['Labcorp    SYNTHETIC SAMPLE REPORT', 'Patient Name: Sample, Morgan', 'DOB: 11/22/1982   Sex: Male', 'Date Collected: 10/17/2025 0905 Local'],
  sections: labcorpSections,
  patient: { family: 'Sample', given: ['Morgan'], birthDate: '1982-11-22', gender: 'male' },
  draws: [{ collected: { local: '2025-10-17T09:05' }, loincs: loincsOf(labcorpSections) }],
};
await makePdf(
  labcorp,
  [
    { x: 36, label: 'Test' },
    { x: 200, label: 'Current Result and Flag' },
    { x: 310, label: 'Previous Result and Date' },
    { x: 420, label: 'Units' },
    { x: 480, label: 'Reference Interval' },
  ],
  (w, r) =>
    w.line([
      [36, r.name],
      [200, r.flag ? `${r.val}   ${r.flag}` : r.val],
      [310, r.prev ?? ''],
      [420, r.unit ?? ''],
      [480, r.range ?? ''],
    ]),
  (n) => `Page ${n} of 1   © Laboratory Corporation of America Holdings`,
);
// The duplicate Cholesterol row (in mmol/L) makes the first one a duplicate too.
{
  const e = expected(labcorp);
  const chol = e.draws[0]!.rows.find((r) => r.loinc === '2093-3')!;
  chol.confidence = 'low';
  chol.issues = ['duplicate'];
  // mmol/L can't be converted (no molar/mass conversions), so it has no value.
  e.draws[0]!.rows.push({ loinc: '2093-3', confidence: 'low', issues: ['unit_mismatch', 'duplicate'] } as never);
  writeFileSync(`${OUT}/${labcorp.name}.expected.json`, JSON.stringify(e, null, 2) + '\n');
}

// ---------------------------------------------------------------- generic PDF

const genericSections: Section[] = [
  {
    rows: [
      { name: 'Ferritin', val: '85', unit: 'ng/mL', range: '16-232', expect: { loinc: '2276-4', value: 85, ucum: 'ng/mL', low: 16, high: 232, confidence: 'medium' } },
      { name: 'Vitamin D, 25-Hydroxy', val: '45', unit: 'ng/mL', range: '30-100', expect: { loinc: '62292-8', value: 45, ucum: 'ng/mL', low: 30, high: 100, confidence: 'medium' } },
      { name: 'hs-CRP', val: '0.6', unit: 'mg/L', range: '<1.0', expect: { loinc: '30522-7', value: 0.6, ucum: 'mg/L', high: 1, confidence: 'medium' } },
      { name: 'Mystery Marker', val: '12', unit: 'U/L', range: '1-20', expect: 'unmatched' },
    ],
  },
];
const genericFx: Fixture = {
  name: 'generic-sample.pdf',
  vendor: 'generic',
  headerBlock: ['Your Lab Results (synthetic sample)', 'Name: Riley Placeholder', 'Date of Birth: 1975-07-07', 'Collection Date: 03/01/2026 7:15 AM'],
  sections: genericSections,
  patient: { family: 'Placeholder', given: ['Riley'], birthDate: '1975-07-07' },
  draws: [{ collected: { local: '2026-03-01T07:15' }, loincs: loincsOf(genericSections) }],
};
await makePdf(
  genericFx,
  [
    { x: 36, label: 'Biomarker' },
    { x: 220, label: 'Result' },
    { x: 300, label: 'Units' },
    { x: 380, label: 'Reference Range' },
  ],
  (w, r) =>
    w.line([
      [36, r.name],
      [220, r.val],
      [300, r.unit ?? ''],
      [380, r.range ?? ''],
    ]),
  (n) => `Page ${n}`,
);
save(genericFx);

console.log('Wrote synthetic fixtures to fixtures/synthetic/');

// ---------------------------------------------------------------- Function Health PDF (Health Gorilla render + Quest appendix)
// Geometry modelled on a real export: right-aligned values, stamps on panel
// lines, wrapped names/units, unlabelled two-line patient name, and an appendix
// that repeats the results (Quest layout) plus a history table of EARLIER
// results. Only the Health Gorilla pages may be read; the history never.
{
  const doc = await PDFDocument.create();
  doc.setTitle('Synthetic Function Health results of record');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = 8.5;
  let page = doc.addPage([612, 792]);
  let y = 0;
  const top = (fromTop: number) => 792 - fromTop;
  const at = (s: string, x: number, yy: number, b = false) => page.drawText(s, { x, y: yy, size, font: b ? bold : font });
  const right = (s: string, x1: number, yy: number) => at(s, x1 - font.widthOfTextAtSize(s, size), yy);
  const hgFooter = () => at('Printed from Health Gorilla Secure Clinical Network. Copyright (c) 2026 Health Gorilla Inc.', 119, top(691));

  // Page 1: Health Gorilla render
  at('PATIENT INFORMATION:', 43, top(51), true);
  at('ORDERING PHYSICIAN:', 412, top(51), true);
  at('TAYLOR', 43, top(71));
  at('DR. SAMPLE DOCTOR', 412, top(71));
  at('EXAMPLE', 43, top(90));
  at('Collection Date:', 206, top(100));
  at('04/17/2026 01:40 PM', 299, top(100));
  at('DOB:', 43, top(117));
  at('03/04/1990', 96, top(117));
  at('Gender:', 43, top(128));
  at('Female Age: 36', 96, top(128));
  const header = (yy: number) => {
    for (const [x, s] of [[42, 'Test'], [181, 'In Range'], [235, 'Out Of Range'], [330, 'Reference Range'], [420, 'Previous Result'], [511, 'Date'], [550, 'Lab']] as const) at(s, x, yy, true);
  };
  header(top(206));
  y = 258;
  const panel = (name: string, collected: string) => {
    at(name, 42, top(y), true);
    at(`Collected: ${collected} UTC`, 42 + bold.widthOfTextAtSize(name, size) + 12, top(y));
    at('Received: 04/17/2026 06:10 PM', 380, top(y));
    y += 11;
    at('UTC', 42, top(y)); // the Received stamp's zone wraps onto its own line
    y += 12;
  };
  const row = (name: string, val: string, range: string, prev?: string, opts: { out?: boolean; wrap?: string; unitWrap?: string } = {}) => {
    at(name, 46, top(y));
    if (opts.out) right(val, 312, top(y));
    else right(val, 223, top(y));
    at(range, 330, top(y));
    if (prev) right(prev, 544, top(y));
    at('KS', 556, top(y));
    y += 11;
    if (opts.wrap || opts.unitWrap) {
      if (opts.wrap) at(opts.wrap, 46, top(y));
      if (opts.unitWrap) at(opts.unitWrap, 330, top(y));
      y += 11;
    }
  };
  panel('LIPID PANEL, STANDARD', '04/17/2026 01:40 PM');
  row('CHOLESTEROL,', '182', '<200 mg/dL', '201.0 10/23/2024', { wrap: 'TOTAL' });
  at('Desirable range <100 mg/dL for primary prevention;', 80, top(y));
  y += 11;
  panel('URINALYSIS, COMPLETE', '04/17/2026 01:40 PM');
  row('GLUCOSE', 'NEGATIVE', 'NEGATIVE');
  row('WBC', 'NONE SEEN', '< OR = 5 /HPF');
  panel('CBC (INCLUDES DIFF/PLT)', '04/17/2026 01:40 PM');
  row('WHITE BLOOD CELL', '5.8', '3.8-10.8 Thousand', '6.1 10/23/2024', { wrap: 'COUNT', unitWrap: '/uL' });
  panel('COMPREHENSIVE METABOLIC PANEL', '04/17/2026 01:40 PM');
  row('EGFR', '98', '> OR = 60 mL/min/1.', '101.0 10/23/2024', { unitWrap: '73m2' });
  // Interpretive risk table, indented: never a result.
  at('Risk:', 115, top(y));
  y += 11;
  at('Optimal', 115, top(y));
  at('< or = 18.4', 214, top(y));
  y += 11;
  at('High', 115, top(y));
  at('>25.0', 214, top(y));
  y += 14;
  panel('OMEGACHECK(R)', '04/17/2026 01:40 PM');
  row('ARACHIDONIC ACID', '10.2', '3.7-40.7', '12.0 10/23/2024', { wrap: '/EPA RATIO' });
  row('ARACHIDONIC ACID', '11.8', '8.6-15.6 % by wt', '10.9 10/23/2024');
  panel('LIPOPROTEIN FRACTIONATION', '04/17/2026 01:40 PM');
  // Last row on the page; its name continues ("NUMBER") at the top of the next page.
  y = Math.max(y, 640);
  row('LDL PARTICLE', '1200', '<1138 nmol/L', '1350.0 H 10/23/2024');
  hgFooter();

  // Page 2: Health Gorilla render, continued.
  page = doc.addPage([612, 792]);
  header(top(200));
  y = 212;
  at('NUMBER', 46, top(y));
  y += 20;
  panel('LIPID PANEL, STANDARD', '04/17/2026 01:40 PM');
  row('CHOL/HDLC RATIO', '3.1', '<5.0 calc', '3.4 10/23/2024');
  panel('ALBUMIN, URINE', '04/17/2026 01:40 PM');
  row('ALBUMIN, URINE', '<0.2', 'See Note: mg/dL');
  at('Reference Range:', 80, top(y));
  y += 20;
  panel('CORTISOL, TOTAL, LC/MS', '04/17/2026 01:40 PM');
  row('CORTISOL, TOTAL, LC', '12.3', 'mcg/dL', '11.0 10/23/2024', { wrap: '/MS' });
  panel('THYROID PEROXIDASE ANTIBODIES', '04/17/2026 01:40 PM');
  row('THYROID', '<1', '<9 IU/mL', undefined, { wrap: 'PEROXIDASE' });
  at('ANTIBODIES', 46, top(y));
  y += 20;
  panel('ABO GROUP AND RH TYPE', '04/17/2026 01:40 PM');
  row('ABO GROUP', 'O', '');
  at('RH TYPE', 46, top(y));
  right('RH(D)', 220, top(y));
  at('KS', 556, top(y));
  y += 13;
  right('POSITIVE', 223, top(y)); // a qualitative result that wraps onto the next line
  y += 20;
  hgFooter();

  // Page 3: reference ranges printed in the comment under a result (range column empty).
  page = doc.addPage([612, 792]);
  header(top(200));
  y = 222;
  panel('APOLIPOPROTEIN B', '04/17/2026 01:40 PM');
  row('APOLIPOPROTEIN B', '88', 'mg/dL');
  at('Reference Range: <90', 80, top(y)); // accepted
  y += 11;
  at('Risk Category:', 80, top(y));
  y += 20;
  panel('LIPOPROTEIN (a)', '04/17/2026 01:40 PM');
  row('LIPOPROTEIN (a)', '<10', 'nmol/L');
  at('Verified by repeat analysis.', 80, top(y));
  y += 20;
  at('Reference Range', 91, top(y)); // accepted: label and value in separate cells
  at('<75', 191, top(y));
  y += 20;
  panel('INSULIN', '04/17/2026 01:40 PM');
  row('INSULIN', '5.2', 'uIU/mL');
  at('Reference Range', 115, top(y)); // accepted; the risk table below is ignored
  at('< or = 18.4', 214, top(y));
  y += 11;
  at('Risk:', 115, top(y));
  y += 11;
  at('Optimal', 115, top(y));
  at('< or = 18.4', 214, top(y));
  y += 11;
  at('High', 115, top(y));
  at('>25.0', 214, top(y));
  y += 20;
  panel('HOMOCYSTEINE', '04/17/2026 01:40 PM');
  row('HOMOCYSTEINE', '9.1', 'umol/L');
  at('Reference range: <11.4', 80, top(y)); // rejected: two candidate lines
  y += 11;
  at('Reference range: <10.4', 80, top(y));
  y += 20;
  panel('GLUCOSE', '04/17/2026 01:40 PM');
  row('GLUCOSE', '88', 'mg/dL');
  at('Reference range: <5.6 mmol/L', 80, top(y)); // rejected: unit doesn't match the result
  y += 20;
  hgFooter();

  // Page 2: Quest "Enhanced PDF Report" appendix repeating the same results.
  page = doc.addPage([612, 792]);
  at('Patient Information', 36, top(99), true);
  at('EXAMPLE, TAYLOR', 36, top(119));
  at('Collected:', 236, top(156));
  at('04/17/2026', 289, top(156));
  for (const [x, s] of [[43, 'Test Name'], [248, 'In Range'], [321, 'Out Of Range'], [406, 'Reference Range'], [568, 'Lab']] as const) at(s, x, top(235), true);
  at('LIPID PANEL, STANDARD', 43, top(245), true);
  at('CHOLESTEROL, TOTAL', 53, top(255));
  at('182', 248, top(255));
  at('<200 mg/dL', 406, top(255));
  at('Enhanced PDF Report', 36, top(700));

  // Page 3: history table. Columns are dates; every value here is an EARLIER result.
  page = doc.addPage([612, 792]);
  at('PATIENT HISTORY REPORT', 243, top(196), true);
  for (const [x, s] of [[37, 'Test Name'], [235, '10/23/2024'], [298, '04/17/2026']] as const) at(s, x, top(244), true);
  at('LDL PARTICLE NUMBER', 37, top(283));
  at('1234', 235, top(283));
  at('-', 313, top(283));
  at('LDL PATTERN', 37, top(304));
  at('A', 235, top(304));
  at('-', 313, top(304));
  at('HDL CHOLESTEROL', 37, top(326));
  at('52', 235, top(326));
  at('-', 313, top(326));

  writeFileSync(`${OUT}/function-healthgorilla-sample.pdf`, await doc.save({ useObjectStreams: false }));
  const r = (loinc: string, value: number | string, extra: Partial<Expect> = {}) => ({ loinc, value, confidence: 'high', issues: [], ...extra });
  writeFileSync(
    `${OUT}/function-healthgorilla-sample.pdf.expected.json`,
    JSON.stringify(
      {
        vendor: 'quest-healthgorilla',
        patient: { birthDate: '1990-03-04', gender: 'female', family: 'Example', given: ['Taylor'] },
        draws: [
          {
            collected: { utc: '2026-04-17T13:40:00Z' },
            rows: [
              r('2093-3', 182, { ucum: 'mg/dL', high: 200 }),
              r('25428-4', 'Negative'),
              r('5821-4', 'None seen'),
              r('6690-2', 5.8, { ucum: '10*3/uL', low: 3.8, high: 10.8 }),
              r('98979-8', 98, { ucum: 'mL/min/{1.73_m2}', low: 60 }),
              r('90909-3', 10.2, { ucum: '{ratio}', low: 3.7, high: 40.7 }),
              r('90916-8', 11.8, { ucum: '%', low: 8.6, high: 15.6 }),
              r('54434-6', 1200, { ucum: 'nmol/L', high: 1138 }),
              r('9830-1', 3.1, { ucum: '{ratio}', high: 5 }),
              r('1754-1', 0.2, { comparator: '<', ucum: 'mg/dL', confidence: 'high', issues: ['no_range'] }),
              r('2143-6', 12.3, { ucum: 'ug/dL', confidence: 'high', issues: ['no_range'] }),
              r('8099-4', 1, { comparator: '<', ucum: '[IU]/mL', high: 9 }),
              r('883-9', 'O'),
              r('10331-7', 'Rh(D) positive'),
              r('1884-6', 88, { ucum: 'mg/dL', high: 90 }),
              r('43583-4', 10, { comparator: '<', ucum: 'nmol/L', high: 75 }),
              r('20448-7', 5.2, { ucum: 'u[IU]/mL', high: 18.4 }),
              r('13965-9', 9.1, { ucum: 'umol/L', issues: ['no_range'] }),
              r('2345-7', 88, { ucum: 'mg/dL', issues: ['no_range'] }),
            ],
          },
        ],
        unmatched: [],
      },
      null,
      2,
    ) + '\n',
  );
}
