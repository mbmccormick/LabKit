import { describe, expect, it } from 'vitest';
import { extractPatient } from '../src/stamps';

type L = { page: number; y: number; h: number; text: string; items: { str: string; x: number }[] };
const line = (page: number, y: number, ...cells: [number, string][]): L => ({
  page,
  y,
  h: 9,
  items: cells.map(([x, str]) => ({ str, x })),
  text: cells.map((c) => c[1]).join('  '),
});

describe('Labcorp unlabeled patient name', () => {
  const header = (p: number, name: string) => line(p, 30, [18, name], [186, 'DOB: 01/02/1990'], [313, 'Patient Report']);
  const details = (name: string) => [line(3, 89, [18, 'Patient Details'], [210, 'Physician Details']), line(3, 100, [18, name], [210, 'D Doctor']), line(3, 112, [18, '123 Main St'])];

  it('reads "FAMILY, GIVEN" from the DOB line and Patient Details', () => {
    expect(extractPatient([header(1, 'Example, Casey'), header(2, 'Example, Casey'), ...details('Example, Casey')])).toMatchObject({ family: 'Example', given: ['Casey'], birthDate: '1990-01-02' });
  });

  it('leaves the name out when the copies disagree', () => {
    expect(extractPatient([header(1, 'Example, Casey'), ...details('Other, Robin')]).family).toBeUndefined();
  });

  it('ignores a DOB line whose first cell is not a comma name', () => {
    expect(extractPatient([line(1, 30, [18, 'Patient ID: 12'], [186, 'DOB: 01/02/1990'])]).family).toBeUndefined();
  });
});
