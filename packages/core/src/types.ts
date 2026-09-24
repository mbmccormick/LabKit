export const CATEGORIES = [
  'lipids',
  'cbc',
  'metabolic',
  'kidney_liver_electrolytes',
  'thyroid',
  'hormones',
  'inflammation_autoimmune',
  'nutrients_minerals',
  'toxins',
  'urinalysis',
  'blood_type',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const VENDORS = ['quest', 'labcorp', 'function', 'generic'] as const;
export type Vendor = (typeof VENDORS)[number];

export type ValueType = 'quantity' | 'qualitative' | 'titer';

export type DictionaryEntry = {
  loinc: string;
  /** LOINC Long Common Name, verbatim. FROZEN after release. */
  display: string;
  /** Short label shown in Health. FROZEN after release. */
  text: string;
  category: Category;
  valueType: ValueType;
  /** Canonical UCUM unit written to the card (quantity only). */
  ucum: string | null;
  unitAliases?: Record<string, string>;
  unitConversions?: { from: string; factor: number; note?: string }[];
  answers?: string[];
  plausible?: { min: number; max: number };
  aliases: { vendor: Vendor; name: string; panel?: string }[];
  excludeFromSigning?: boolean;
};

export type DictionaryFile = {
  schemaVersion: 1;
  note?: string;
  entries: DictionaryEntry[];
};

export type Comparator = '<' | '<=' | '>' | '>=';

export type PatientInput = {
  family: string;
  given: string[];
  /** FHIR date: YYYY-MM-DD */
  birthDate: string;
  gender?: 'male' | 'female' | 'other' | 'unknown';
};

/**
 * One result, in the shape the reference encoder takes
 * (reference/shc_reference.py `observation(r)`).
 */
export type ObservationInput =
  | {
      loinc: string;
      display: string;
      text: string;
      kind: 'quantity';
      value: number;
      unit: string;
      comparator?: Comparator;
      low?: number;
      high?: number;
    }
  | { loinc: string; display: string; text: string; kind: 'qualitative'; value: string }
  | { loinc: string; display: string; text: string; kind: 'titer'; value: number | string };

export type CardInput = {
  issuer: string;
  nbf: number;
  patient: PatientInput;
  /** ISO 8601 UTC, e.g. 2026-04-17T13:40:00Z */
  effectiveDateTime: string;
  results: ObservationInput[];
};

export type ParsedValue =
  | { kind: 'quantity'; value: number; comparator?: Comparator; ucum: string }
  | { kind: 'qualitative' | 'titer'; text: string };

export type RowIssue = 'ocr' | 'unit_mismatch' | 'implausible' | 'ambiguous_match' | 'duplicate' | 'no_range';

export type ParsedRow = {
  raw: { name: string; value: string; flag?: string; range?: string; unit?: string; panel?: string; page: number; line: string };
  entry?: DictionaryEntry;
  value?: ParsedValue;
  range?: { low?: number; high?: number };
  /** 'note': taken from a single "Reference range: …" line in the lab's comment under the result. */
  rangeSource?: 'column' | 'note';
  confidence: 'high' | 'medium' | 'low';
  issues: RowIssue[];
};

export type ParsedReport = {
  source: { vendor: 'quest-healthgorilla' | 'quest' | 'labcorp' | 'function' | 'generic'; fileName: string; method: 'text' | 'ocr' };
  patient: { family?: string; given?: string[]; birthDate?: string; gender?: 'male' | 'female' };
  draws: { collectedAt: string; rows: ParsedRow[] }[];
  unmatched: { text: string; page: number }[];
};
