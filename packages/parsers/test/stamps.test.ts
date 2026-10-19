// Collection stamps as printed by US labs and portals (SPEC §12.3.5).
import { describe, expect, it } from 'vitest';
import { splitValueCell } from '../src/rows';
import { extractPatient, parseStampText } from '../src/stamps';

const iso = (s: string, tz: 'utc' | 'local' = 'utc') => parseStampText(s, tz)?.iso;
const local = (...a: [number, number, number, number?, number?]) => new Date(a[0], a[1] - 1, a[2], a[3] ?? 0, a[4] ?? 0).toISOString().replace('.000', '');

describe('collection stamps', () => {
  it('reads Quest\'s own "date / time zone" form in the printed US zone', () => {
    expect(parseStampText('Collected: 09/29/2020 / 11:00 EDT', 'utc')).toEqual({ iso: '2020-09-29T15:00:00Z', timeFound: true, match: 'Collected: 09/29/2020 / 11:00 EDT' });
    expect(iso('Collected: 02/19/2021 / 03:00 EST')).toBe('2021-02-19T08:00:00Z');
    expect(iso('Collected: 01/10/2026 / 14:05 PST')).toBe('2026-01-10T22:05:00Z');
    expect(iso('Collected: 07/10/2026 / 08:30 CDT')).toBe('2026-07-10T13:30:00Z');
    expect(iso('Collected: 07/10/2026 / 08:30 MDT')).toBe('2026-07-10T14:30:00Z');
    expect(iso('Collected: 07/10/2026 / 08:30 HST')).toBe('2026-07-10T18:30:00Z');
  });

  it('follows DST for the generic US zones', () => {
    expect(iso('Collected: 01/15/2026 09:00 ET')).toBe('2026-01-15T14:00:00Z');
    expect(iso('Collected: 07/15/2026 09:00 ET')).toBe('2026-07-15T13:00:00Z');
    expect(iso('Collected: 07/15/2026 9:00 AM PT')).toBe('2026-07-15T16:00:00Z');
  });

  it('keeps explicit UTC and "Local" stamps', () => {
    expect(iso('Collected: 04/17/2026 01:40 PM UTC', 'local')).toBe('2026-04-17T13:40:00Z');
    expect(iso('Date Collected: 10/17/2025 0905 Local', 'utc')).toBe(local(2025, 10, 17, 9, 5));
    // No zone: the template's assumption.
    expect(iso('Collected: 04/17/2026 01:40 PM', 'utc')).toBe('2026-04-17T13:40:00Z');
    expect(iso('Collected: 04/17/2026 01:40 PM', 'local')).toBe(local(2026, 4, 17, 13, 40));
  });

  it('reads portal labels and date forms', () => {
    expect(iso('Collection Time: 04/17/2026 8:05 AM', 'local')).toBe(local(2026, 4, 17, 8, 5));
    expect(iso('Collection Date and Time: 04/17/2026 08:05', 'local')).toBe(local(2026, 4, 17, 8, 5));
    expect(iso('Date/Time Collected: 04/17/2026 08:05', 'local')).toBe(local(2026, 4, 17, 8, 5));
    expect(iso('Sample Collected: 2026-04-17 08:05', 'local')).toBe(local(2026, 4, 17, 8, 5));
    expect(iso('Draw Date: 2026-04-17', 'local')).toBe(local(2026, 4, 17));
    expect(iso('Collected: Apr 17, 2026 at 8:05 AM CDT')).toBe('2026-04-17T13:05:00Z');
    expect(iso('Collected on September 3, 2026', 'local')).toBe(local(2026, 9, 3));
    expect(iso('Collected: 2026-04-17T08:05', 'local')).toBe(local(2026, 4, 17, 8, 5));
  });

  it('rejects impossible dates and non-stamps', () => {
    expect(parseStampText('Collected: 04/31/2026', 'local')).toBeUndefined();
    expect(parseStampText('Collected: Foo 17, 2026', 'local')).toBeUndefined();
    expect(parseStampText('Reported: 04/17/2026 / 11:00 EDT', 'local')).toBeUndefined();
  });

  it('does not take a word starting with a zone as the zone', () => {
    expect(parseStampText('Collected: 04/17/2026 01:40 ESTIMATED', 'utc')).toMatchObject({ iso: '2026-04-17T01:40:00Z' });
  });
});

describe('patient header dates', () => {
  it('reads month-name birth dates', () => {
    expect(extractPatient([{ page: 1, y: 1, h: 9, text: 'DOB: Jan 2, 1985', items: [] }]).birthDate).toBe('1985-01-02');
    expect(extractPatient([{ page: 1, y: 1, h: 9, text: 'Date of Birth: September 30, 1979', items: [] }]).birthDate).toBe('1979-09-30');
  });
});

describe('value cell flags', () => {
  it.each([
    ['5.4 (H)', '5.4', '(H)'],
    ['3.1 (L)', '3.1', '(L)'],
    ['1310 ↑', '1310', '↑'],
    ['105 ▲ High', '105', '▲ High'],
    ['88 mg/dL', '88', undefined],
  ])('%s', (cell, value, flag) => {
    const r = splitValueCell(cell);
    expect(r.value).toBe(value);
    expect(r.flag).toBe(flag);
  });
});
