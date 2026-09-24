import { describe, expect, it } from 'vitest';
import { legendLabCodes, stripLabCode } from '../src/table';
import type { Line } from '../src/types';

const line = (page: number, y: number, ...strs: string[]): Line => ({
  page,
  y,
  h: 9,
  items: strs.map((str, i) => ({ str, x: 18 + i * 200, y, w: str.length * 4, h: 9, page })),
  text: strs.join('  '),
});

describe('Labcorp performing-lab codes', () => {
  const legend = [line(1, 600, 'Performing Labs'), line(1, 612, '01: BN - Labcorp Burlington, 1447 York Court'), line(1, 624, 'For inquiries, the physician may contact Branch: 800-000-0000')];

  it('reads codes from the Performing Labs legend', () => {
    expect([...legendLabCodes(legend)]).toEqual(['01']);
  });

  it('strips only listed codes', () => {
    const codes = legendLabCodes(legend);
    expect(stripLabCode('Calcium, Urine 01', codes)).toBe('Calcium, Urine');
    expect(stripLabCode('Apolipoprotein B 02', codes)).toBe('Apolipoprotein B 02');
    expect(stripLabCode('Vitamin B12', codes)).toBe('Vitamin B12');
  });

  it('strips nothing without a legend', () => {
    expect(stripLabCode('Glucose 01', legendLabCodes([line(1, 100, 'Glucose 01', '88')]))).toBe('Glucose 01');
  });

  it('ignores code-like lines on another page', () => {
    expect(legendLabCodes([line(1, 700, 'Performing Labs'), line(2, 40, '01: BN - Labcorp Burlington')]).size).toBe(0);
  });
});
