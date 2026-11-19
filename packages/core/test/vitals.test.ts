import { describe, expect, it } from 'vitest';
import { buildVitalsFile, sha256Hex, toZonedIso, validateVitalsFile, vitalsCsv, type VitalsInput } from '../src/vitals';

const input: VitalsInput = {
  lab: 'Randox Health',
  programme: 'Discovery (male)',
  sampleId: 'S0000000',
  collectedAtUtc: '2026-05-14T07:45:00Z',
  zone: 'Europe/London',
  fastingMinutes: 615,
  values: {
    height: 1.725,
    bodyMass: 80.4,
    bodyMassIndex: 27,
    waistCircumference: 92,
    hipCircumference: 101,
    heartRate: 64,
    oxygenSaturation: 98,
    bloodPressureSystolic: 128,
    bloodPressureDiastolic: 80,
  },
};

describe('vitals export', () => {
  it('writes the instant with the zone offset in force', () => {
    expect(toZonedIso('2026-05-14T07:45:00Z', 'Europe/London')).toBe('2026-05-14T08:45:00+01:00');
    expect(toZonedIso('2026-01-14T08:45:00Z', 'Europe/London')).toBe('2026-01-14T08:45:00+00:00');
    expect(toZonedIso('2026-01-14T08:45:00Z', 'America/New_York')).toBe('2026-01-14T03:45:00-05:00');
  });

  it('builds labkit-vitals v1 with a hashed report id and blood pressure as one entry', async () => {
    const f = await buildVitalsFile(input);
    expect(f).toEqual({
      format: 'labkit-vitals',
      version: 1,
      source: { lab: 'Randox Health', programme: 'Discovery (male)', reportId: await sha256Hex('S0000000') },
      collectedAt: '2026-05-14T08:45:00+01:00',
      fastingMinutes: 615,
      vitals: [
        { metric: 'height', value: 1.725, unit: 'm' },
        { metric: 'bodyMass', value: 80.4, unit: 'kg' },
        { metric: 'bodyMassIndex', value: 27, unit: 'count' },
        { metric: 'waistCircumference', value: 92, unit: 'cm' },
        { metric: 'hipCircumference', value: 101, unit: 'cm' },
        { metric: 'heartRate', value: 64, unit: 'count/min' },
        { metric: 'oxygenSaturation', value: 98, unit: '%' },
        { metric: 'bloodPressure', systolic: 128, diastolic: 80, unit: 'mmHg' },
      ],
    });
    // The raw sample ID never appears in the file.
    expect(JSON.stringify(f)).not.toContain('S0000000');
    expect(validateVitalsFile(f)).toEqual([]);
  });

  it('writes blood pressure only with both values', async () => {
    const f = await buildVitalsFile({ ...input, values: { bloodPressureSystolic: 128, heartRate: 64 } });
    expect(f.vitals).toEqual([{ metric: 'heartRate', value: 64, unit: 'count/min' }]);
  });

  it('writes one Health CSV Importer row; hip circumference has no importer type', async () => {
    const csv = vitalsCsv(await buildVitalsFile(input));
    expect(csv).toBe(
      'Start Date,End Date,height (m),weight (kg),body mass index (count),waist circumference (cm),heart rate (count/min),oxygen (%),systolic (mmHg),diastolic (mmHg)\r\n' +
        '2026-05-14T08:45:00+01:00,2026-05-14T08:45:00+01:00,1.725,80.4,27,92,64,98,128,80\r\n',
    );
    expect(vitalsCsv(await buildVitalsFile({ ...input, values: { hipCircumference: 101 } }))).toBe('');
  });

  it('rejects files that break the rules', async () => {
    const f = await buildVitalsFile(input);
    expect(validateVitalsFile({ ...f, format: 'x' })).toContain('format');
    expect(validateVitalsFile({ ...f, collectedAt: '2026-05-14 08:45' })).toContain('collectedAt');
    expect(validateVitalsFile({ ...f, vitals: [{ metric: 'bloodPressure', systolic: 80, diastolic: 90, unit: 'mmHg' }] })).toEqual(['vitals[0]']);
    expect(validateVitalsFile({ ...f, vitals: [{ metric: 'heartRate', value: 400, unit: 'count/min' }] })).toEqual(['vitals[0] out of bounds']);
    expect(validateVitalsFile({ ...f, vitals: [{ metric: 'bloodGlucose', value: 5, unit: 'mmol/L' }] })).toEqual(['vitals[0]']);
  });
});
