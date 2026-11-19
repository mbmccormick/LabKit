// Vitals that a lab-only card can't carry (Randox body measurements, pulse, SpO₂,
// blood pressure). They never leave the browser: the web app offers them as a
// `labkit-vitals` JSON file (format defined below) and as
// a CSV for Health CSV Importer. No patient identity goes in either file.

/** HealthKit-shaped metric names (HKQuantityTypeIdentifier without the prefix). */
export const VITAL_METRICS = [
  'height',
  'bodyMass',
  'bodyMassIndex',
  'waistCircumference',
  'hipCircumference',
  'heartRate',
  'oxygenSaturation',
  'bloodPressureSystolic',
  'bloodPressureDiastolic',
] as const;
export type VitalMetric = (typeof VITAL_METRICS)[number];

/** Canonical unit per metric (HKUnit unit strings). SpO₂ is a percentage here; HealthKit stores it as a fraction. */
export const VITAL_UNITS: Record<VitalMetric, string> = {
  height: 'm',
  bodyMass: 'kg',
  bodyMassIndex: 'count',
  waistCircumference: 'cm',
  hipCircumference: 'cm',
  heartRate: 'count/min',
  oxygenSaturation: '%',
  bloodPressureSystolic: 'mmHg',
  bloodPressureDiastolic: 'mmHg',
};

/** Outside these a value is flagged for review (canonical units). */
export const VITAL_BOUNDS: Record<VitalMetric, { min: number; max: number }> = {
  height: { min: 1.0, max: 2.5 },
  bodyMass: { min: 20, max: 300 },
  bodyMassIndex: { min: 10, max: 80 },
  waistCircumference: { min: 40, max: 200 },
  hipCircumference: { min: 40, max: 200 },
  heartRate: { min: 25, max: 250 },
  oxygenSaturation: { min: 50, max: 100 },
  bloodPressureSystolic: { min: 50, max: 260 },
  bloodPressureDiastolic: { min: 30, max: 160 },
};

export const VITAL_LABELS: Record<VitalMetric | 'waistHipRatio', string> = {
  height: 'Height',
  bodyMass: 'Weight',
  bodyMassIndex: 'Body Mass Index',
  waistCircumference: 'Waist Circumference',
  hipCircumference: 'Hip Circumference',
  heartRate: 'Pulse',
  oxygenSaturation: 'Oxygen Saturation',
  bloodPressureSystolic: 'Systolic Blood Pressure',
  bloodPressureDiastolic: 'Diastolic Blood Pressure',
  waistHipRatio: 'Waist/Hip Ratio',
};

export type VitalEntry =
  | { metric: Exclude<VitalMetric, 'bloodPressureSystolic' | 'bloodPressureDiastolic'>; value: number; unit: string }
  | { metric: 'bloodPressure'; systolic: number; diastolic: number; unit: 'mmHg' };

export type VitalsFile = {
  format: 'labkit-vitals';
  version: 1;
  source: { lab: string; programme?: string; reportId: string };
  /** ISO 8601 with the collection site's UTC offset, e.g. 2026-05-14T08:45:00+01:00. */
  collectedAt: string;
  fastingMinutes?: number;
  vitals: VitalEntry[];
};

export const VITALS_EXTENSION = 'labkit-vitals';
export const VITALS_UTTYPE = 'health.labkit.vitals';
export const VITALS_MIME = 'application/vnd.labkit.vitals+json';

/** UTC instant → the same instant written with `zone`'s offset at that moment: "2026-05-14T08:45:00+01:00". */
export function toZonedIso(utcIso: string, zone: string): string {
  const t = Date.parse(utcIso);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const off = Math.round((wall - Math.floor(t / 1000) * 1000) / 60000);
  const sign = off < 0 ? '-' : '+';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${hh}:${mm}`;
}

/** Lower-case hex SHA-256 (WebCrypto: browser, Worker and Node). */
export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type VitalsInput = {
  lab: string;
  programme?: string;
  /** Only hashed; never written to the file. */
  sampleId?: string;
  collectedAtUtc: string;
  zone: string;
  fastingMinutes?: number;
  values: Partial<Record<VitalMetric, number>>;
};

/** The `labkit-vitals` file. Blood pressure is written only when both values are present (one correlation). */
export async function buildVitalsFile(input: VitalsInput): Promise<VitalsFile> {
  const v = input.values;
  const vitals: VitalEntry[] = [];
  for (const m of VITAL_METRICS) {
    if (m === 'bloodPressureSystolic' || m === 'bloodPressureDiastolic') continue;
    const value = v[m];
    if (value !== undefined) vitals.push({ metric: m, value, unit: VITAL_UNITS[m] });
  }
  if (v.bloodPressureSystolic !== undefined && v.bloodPressureDiastolic !== undefined) {
    vitals.push({ metric: 'bloodPressure', systolic: v.bloodPressureSystolic, diastolic: v.bloodPressureDiastolic, unit: 'mmHg' });
  }
  // The report's own sample ID identifies the draw without identifying the person; hashed so it can't be read back.
  const reportId = await sha256Hex(input.sampleId ?? `${input.lab}|${input.collectedAtUtc}`);
  const file: VitalsFile = {
    format: 'labkit-vitals',
    version: 1,
    source: { lab: input.lab, ...(input.programme ? { programme: input.programme } : {}), reportId },
    collectedAt: toZonedIso(input.collectedAtUtc, input.zone),
    ...(input.fastingMinutes !== undefined ? { fastingMinutes: input.fastingMinutes } : {}),
    vitals,
  };
  return file;
}

/**
 * Health CSV Importer columns (developer's type catalog, checked 2026-11-07): a start-date column and one
 * column per type, header "<type> (<unit>)". Blood pressure must have systolic and diastolic in the same
 * file. Hip circumference has no importer type, so it is left out of the CSV.
 */
const CSV_COLUMNS: { metric: VitalMetric; header: string }[] = [
  { metric: 'height', header: 'height (m)' },
  { metric: 'bodyMass', header: 'weight (kg)' },
  { metric: 'bodyMassIndex', header: 'body mass index (count)' },
  { metric: 'waistCircumference', header: 'waist circumference (cm)' },
  { metric: 'heartRate', header: 'heart rate (count/min)' },
  { metric: 'oxygenSaturation', header: 'oxygen (%)' },
  { metric: 'bloodPressureSystolic', header: 'systolic (mmHg)' },
  { metric: 'bloodPressureDiastolic', header: 'diastolic (mmHg)' },
];

/** One row: "Start Date,End Date,height (m),…" with the collection time (start = end) in ISO 8601 with offset. */
export function vitalsCsv(file: VitalsFile): string {
  const values: Partial<Record<VitalMetric, number>> = {};
  for (const e of file.vitals) {
    if (e.metric === 'bloodPressure') {
      values.bloodPressureSystolic = e.systolic;
      values.bloodPressureDiastolic = e.diastolic;
    } else values[e.metric] = e.value;
  }
  const cols = CSV_COLUMNS.filter((c) => values[c.metric] !== undefined);
  if (!cols.length) return '';
  const header = ['Start Date', 'End Date', ...cols.map((c) => c.header)].join(',');
  const row = [file.collectedAt, file.collectedAt, ...cols.map((c) => String(values[c.metric]))].join(',');
  return `${header}\r\n${row}\r\n`;
}

/** Problems that stop a file from being saved at all (for any app that reads this format). */
export function validateVitalsFile(f: unknown): string[] {
  const errs: string[] = [];
  const o = f as Partial<VitalsFile> | null;
  if (!o || typeof o !== 'object') return ['not an object'];
  if (o.format !== 'labkit-vitals') errs.push('format');
  if (o.version !== 1) errs.push('version');
  if (!o.source || typeof o.source.reportId !== 'string' || !/^[0-9a-f]{64}$/.test(o.source.reportId)) errs.push('source.reportId');
  if (typeof o.collectedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(o.collectedAt) || Number.isNaN(Date.parse(o.collectedAt))) errs.push('collectedAt');
  if (!Array.isArray(o.vitals) || !o.vitals.length) errs.push('vitals');
  const seen = new Set<string>();
  for (const [i, e] of (o.vitals ?? []).entries()) {
    if (seen.has(e.metric)) errs.push(`vitals[${i}] duplicate`);
    seen.add(e.metric);
    if (e.metric === 'bloodPressure') {
      const s = VITAL_BOUNDS.bloodPressureSystolic;
      const d = VITAL_BOUNDS.bloodPressureDiastolic;
      if (e.unit !== 'mmHg' || !(e.systolic >= s.min && e.systolic <= s.max) || !(e.diastolic >= d.min && e.diastolic <= d.max) || !(e.systolic > e.diastolic)) errs.push(`vitals[${i}]`);
    } else if (!(VITAL_METRICS as readonly string[]).includes(e.metric) || e.unit !== VITAL_UNITS[e.metric] || !Number.isFinite(e.value)) errs.push(`vitals[${i}]`);
    else if (e.value < VITAL_BOUNDS[e.metric].min || e.value > VITAL_BOUNDS[e.metric].max) errs.push(`vitals[${i}] out of bounds`);
  }
  return errs;
}
