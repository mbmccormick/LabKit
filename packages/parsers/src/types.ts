import type { ParsedReport, VitalMetric } from '@labkit/core';

/** A run of text with its position. y grows downward; units are PDF points, pixels or characters. */
export type TextItem = { str: string; x: number; y: number; w: number; h: number; page: number };

export type Page = { page: number; items: TextItem[] };

export type Method = ParsedReport['source']['method'];
export type SourceVendor = ParsedReport['source']['vendor'];

export type Line = { page: number; y: number; h: number; items: TextItem[]; text: string };

/** Review issues on a vital: value outside VITAL_BOUNDS, unusable unit, unreadable value, copies that disagree, systolic ≤ diastolic. */
export type VitalIssue = 'implausible' | 'unit' | 'unreadable' | 'conflict' | 'order';

/** A body measurement or vital sign (not a lab result: never in a card). Waist/hip ratio is display-only. */
export type ParsedVital = {
  metric: VitalMetric | 'waistHipRatio';
  /** In the metric's canonical unit (VITAL_UNITS). */
  value?: number;
  unit?: string;
  raw: { name: string; value: string; unit?: string; panel?: string; page: number; line: string };
  issues: VitalIssue[];
};

/** Vitals found in a report, with what the export needs. sampleId is held in memory only and hashed on export. */
export type ReportVitals = {
  lab: string;
  zone: string;
  collectedAt?: string;
  programme?: string;
  sampleId?: string;
  fastingMinutes?: number;
  rows: ParsedVital[];
};
