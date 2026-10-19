// Labcorp's older boxed report form (labels above values), and PDF text layers
// that need cleaning before they can be read. Synthetic values only.
import { describe, expect, it } from 'vitest';
import { looksScanned, pdfTextPages, type PdfDocLike } from '../src/pdftext';
import { extractPatient } from '../src/stamps';
import { extractTable } from '../src/table';
import type { Line } from '../src/types';
import { labcorpPdf } from '../src/vendors/labcorp-pdf';

const line = (page: number, y: number, ...cells: [number, string][]): Line => ({
  page,
  y,
  h: 9,
  items: cells.map(([x, str]) => ({ str, x, y, w: str.length * 4, h: 9, page })),
  text: cells.map((c) => c[1]).join('  '),
});

const header = (sex = 'F', first = 'CASEY') => [
  line(1, 100, [144, 'Patient Last Name'], [410, 'Account Address']),
  line(1, 110, [43, 'EXAMPLE'], [317, 'Synthetic Account']),
  line(1, 120, [68, 'Patient First Name'], [202, 'Patient Middle Name']),
  line(1, 129, [43, first], [205, 'Q']),
  line(1, 160, [52, 'Age (Y/M/D)'], [130, 'Date of Birth'], [202, 'Sex'], [251, 'Fasting']),
  line(1, 169, [43, '36/09/15'], [122, '01/02/90'], [205, sex]),
  line(1, 200, [47, 'Date and Time Collected'], [143, 'Date Entered'], [210, 'Date and Time Reported'], [315, 'Physician Name']),
  line(1, 209, [45, '04/17/26'], [93, '08:05'], [140, '04/18/26'], [210, '04/19/26'], [255, '06:10']),
];

describe('Labcorp boxed header', () => {
  it('reads the patient from the boxes under each label', () => {
    expect(extractPatient(header())).toEqual({ family: 'Example', given: ['Casey', 'Q'], birthDate: '1990-01-02', gender: 'female' });
  });

  it('leaves out a name that is not a name', () => {
    const p = extractPatient(header('M', '004259'));
    expect(p.family).toBeUndefined();
    expect(p).toMatchObject({ birthDate: '1990-01-02', gender: 'male' });
  });

  it('dates results from the box under "Date and Time Collected", not the one beside it', () => {
    const table = extractTable(
      [
        ...header(),
        line(1, 240, [108, 'TESTS'], [234, 'RESULT'], [309, 'FLAG'], [380, 'UNITS'], [439, 'REFERENCE INTERVAL'], [554, 'LAB']),
        line(1, 252, [36, 'TSH'], [255, '0.555'], [376, 'uIU/mL'], [449, '0.450 - 4.500'], [554, '01']),
      ],
      labcorpPdf,
    );
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]!.collected).toMatchObject({ iso: new Date(2026, 3, 17, 8, 5).toISOString().replace('.000', ''), timeFound: true });
  });
});

describe('PDF text layer', () => {
  const doc = (...strs: string[]): PdfDocLike => ({
    numPages: 1,
    getPage: async () => ({
      getViewport: () => ({ width: 612, height: 792 }),
      getTextContent: async () => ({ items: strs.map((str, i) => ({ str, transform: [9, 0, 0, 9, 36, 700 - i * 12], width: str.length * 4, height: 9 })) }),
    }),
  });

  it('reads U+2212 MINUS SIGN as a hyphen', async () => {
    const { pages } = await pdfTextPages(doc('Vitamin D, 25−Hydroxy', '30.0 − 100.0'));
    expect(pages[0]!.items.map((i) => i.str)).toEqual(['Vitamin D, 25-Hydroxy', '30.0 - 100.0']);
  });

  it('counts a layer of unmapped glyph codes as no text, so the file is read like a scan', async () => {
    const garbled = await pdfTextPages(doc(...Array.from({ length: 20 }, () => '\u0005\u0004\u000e AB\u0007')));
    expect(garbled.chars).toBe(0);
    expect(looksScanned(garbled.chars, 1)).toBe(true);
    const readable = await pdfTextPages(doc(...Array.from({ length: 20 }, () => 'Glucose 88 mg/dL'), '\u0005'));
    expect(looksScanned(readable.chars, 1)).toBe(false);
  });
});
