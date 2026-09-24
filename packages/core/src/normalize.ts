import type { Comparator, DictionaryEntry } from './types';

// ---------- numbers ----------

/** Scaled values are rounded to 6 significant digits (SPEC §8). */
export function roundSig(x: number, digits = 6): number {
  if (!Number.isFinite(x) || x === 0) return x;
  return Number(x.toPrecision(digits));
}

const NUMBER_RE = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

export function parseNumber(s: string): number | undefined {
  const t = s.trim();
  if (!NUMBER_RE.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

// ---------- comparators ----------

const COMPARATOR_RE = /^(<\s*or\s*=|>\s*or\s*=|<=|>=|=<|=>|≤|≥|<|>)\s*/i;

export function normalizeComparator(s: string): Comparator | undefined {
  const t = s.replace(/\s+/g, '').toLowerCase();
  switch (t) {
    case '<':
      return '<';
    case '>':
      return '>';
    case '<=':
    case '=<':
    case '<or=':
    case '≤':
      return '<=';
    case '>=':
    case '=>':
    case '>or=':
    case '≥':
      return '>=';
    default:
      return undefined;
  }
}

// ---------- qualitative ----------

const KNOWN_QUALITATIVE = [
  'negative',
  'positive',
  'none seen',
  'not detected',
  'detected',
  'non-reactive',
  'nonreactive',
  'reactive',
  'clear',
  'hazy',
  'cloudy',
  'turbid',
  'yellow',
  'pale yellow',
  'dark yellow',
  'straw',
  'amber',
  'colorless',
  'trace',
  'few',
  'moderate',
  'many',
  'rare',
  'occasional',
  'normal',
  'abnormal',
  'equivocal',
  'indeterminate',
  'pattern a',
  'pattern b',
  'a',
  'b',
  'ab',
  'o',
] as const;

const UPPER_TOKENS = new Set(['a', 'b', 'ab', 'o', 'ana', 'rbc', 'wbc', 'hpf', 'lpf']);

/** "NONE SEEN" → "None seen", "ab" → "AB", "1+" stays "1+". */
export function normalizeQualitativeCase(s: string, answers?: readonly string[]): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (answers) {
    const hit = answers.find((a) => a.toLowerCase() === t.toLowerCase());
    if (hit) return hit;
  }
  const words = t.toLowerCase().split(' ');
  return words
    .map((w, i) => {
      if (UPPER_TOKENS.has(w)) return w.toUpperCase();
      if (w === 'rh') return 'Rh';
      if (w === 'rh(d)') return 'Rh(D)';
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(' ');
}

export function isKnownQualitative(s: string): boolean {
  const t = s.trim().replace(/\s+/g, ' ').toLowerCase();
  return (KNOWN_QUALITATIVE as readonly string[]).includes(t) || /^[1-4]\+$/.test(t);
}

// ---------- value grammar (SPEC §12.4) ----------

export type Cell =
  | { kind: 'quantity'; value: number; comparator?: Comparator }
  | { kind: 'titer'; text: string }
  | { kind: 'qualitative'; text: string };

export function parseCell(input: string): Cell | undefined {
  const s = input.trim().replace(/\s+/g, ' ');
  if (!s) return undefined;

  const titer = /^1\s*:\s*(\d+)$/.exec(s);
  if (titer) return { kind: 'titer', text: `1:${Number(titer[1])}` };

  const cmp = COMPARATOR_RE.exec(s);
  const rest = cmp ? s.slice(cmp[0].length) : s;
  const n = parseNumber(rest);
  if (n !== undefined) {
    const comparator = cmp ? normalizeComparator(cmp[1]!) : undefined;
    if (cmp && !comparator) return undefined;
    return comparator ? { kind: 'quantity', value: n, comparator } : { kind: 'quantity', value: n };
  }
  if (cmp) return undefined;

  if (isKnownQualitative(s)) return { kind: 'qualitative', text: normalizeQualitativeCase(s) };
  return undefined;
}

/** Titer from "1:40" or "40". */
export function parseTiter(input: string): string | undefined {
  const s = input.trim();
  const m = /^(?:1\s*:\s*)?(\d+)$/.exec(s);
  if (!m) return undefined;
  const d = Number(m[1]);
  return d > 0 ? `1:${d}` : undefined;
}

export const FLAGS = ['H', 'L', 'HH', 'LL', 'A', 'AA'] as const;
export type Flag = (typeof FLAGS)[number];
export function parseFlag(s: string): Flag | undefined {
  const t = s.trim().toUpperCase();
  return (FLAGS as readonly string[]).includes(t) ? (t as Flag) : undefined;
}

// ---------- reference ranges ----------

export type Range = { low?: number; high?: number };

export function parseRange(input: string): Range | { qualitative: string } | undefined {
  const s = input.trim().replace(/\s+/g, ' ');
  if (!s) return undefined;
  const between = /^((?:\d+(?:\.\d+)?|\.\d+)) ?[-–] ?((?:\d+(?:\.\d+)?|\.\d+))$/.exec(s);
  if (between) {
    const low = Number(between[1]);
    const high = Number(between[2]);
    return low <= high ? { low, high } : undefined;
  }
  const cmp = COMPARATOR_RE.exec(s);
  if (cmp) {
    const c = normalizeComparator(cmp[1]!);
    const n = parseNumber(s.slice(cmp[0].length));
    if (!c || n === undefined) return undefined;
    return c === '<' || c === '<=' ? { high: n } : { low: n };
  }
  if (isKnownQualitative(s)) return { qualitative: normalizeQualitativeCase(s) };
  return undefined;
}

// ---------- units (SPEC §6.3) ----------

/** Printed unit → UCUM. Keys are matched after `cleanUnit`. */
export const GLOBAL_UNIT_ALIASES: Readonly<Record<string, string>> = {
  'mg/dL': 'mg/dL',
  'mcg/dL': 'ug/dL',
  'ug/dL': 'ug/dL',
  'ng/mL': 'ng/mL',
  'pg/mL': 'pg/mL',
  'ng/dL': 'ng/dL',
  'mcg/L': 'ug/L',
  'ug/L': 'ug/L',
  'mg/L': 'mg/L',
  'nmol/L': 'nmol/L',
  'umol/L': 'umol/L',
  'mmol/L': 'mmol/L',
  'g/dL': 'g/dL',
  'U/L': 'U/L',
  'IU/L': 'U/L',
  'IU/mL': '[IU]/mL',
  'uIU/mL': 'u[IU]/mL',
  'mIU/mL': 'm[IU]/mL',
  'mIU/L': 'm[IU]/L',
  '%': '%',
  '% by wt': '%',
  'Thousand/uL': '10*3/uL',
  'K/uL': '10*3/uL',
  'x10E3/uL': '10*3/uL',
  'Million/uL': '10*6/uL',
  'M/uL': '10*6/uL',
  'x10E6/uL': '10*6/uL',
  'cells/uL': '/uL',
  '/uL': '/uL',
  fL: 'fL',
  pg: 'pg',
  'mL/min/1.73m2': 'mL/min/{1.73_m2}',
  Angstrom: 'Ao',
  'Å': 'Ao',
  ratio: '{ratio}',
  '(ratio)': '{ratio}',
  'specific gravity': '1',
  pH: '[pH]',
};

/** Strip trailing annotations such as "(calc)", unify micro signs and whitespace. */
export function cleanUnit(printed: string): string {
  return printed
    .normalize('NFKC')
    .replace(/[µμ]/g, 'u')
    .replace(/\s*\(?\b(?:calc|calculated|est|estimated)\b\)?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const FOLDED_GLOBAL = new Map(Object.entries(GLOBAL_UNIT_ALIASES).map(([k, v]) => [cleanUnit(k).toLowerCase(), v]));
// "M/uL" (million) and "m…" (milli) collide under case folding; only fold when unambiguous.
const CASE_SENSITIVE = new Set(['m/ul']);

export function printedToUcum(printed: string, entry?: DictionaryEntry): string | undefined {
  const c = cleanUnit(printed);
  if (entry?.unitAliases) {
    for (const [k, v] of Object.entries(entry.unitAliases)) if (cleanUnit(k) === c) return v;
  }
  for (const [k, v] of Object.entries(GLOBAL_UNIT_ALIASES)) if (cleanUnit(k) === c) return v;
  const folded = c.toLowerCase();
  if (!CASE_SENSITIVE.has(folded)) {
    const hit = FOLDED_GLOBAL.get(folded);
    if (hit) return hit;
  }
  return undefined;
}

export type UnitResolution =
  | { ok: true; ucum: string; factor: number; missing?: true }
  | { ok: false; reason: 'unit_mismatch' | 'not_quantity' };

const UNITLESS = new Set(['{ratio}', '1', '[pH]']);

/**
 * SPEC §6.2 rule 3: a match is valid only if the printed unit resolves to the
 * entry's ucum directly, via unitAliases, or via unitConversions.
 */
export function resolveUnit(printed: string | undefined, entry: DictionaryEntry): UnitResolution {
  if (entry.valueType !== 'quantity' || !entry.ucum) return { ok: false, reason: 'not_quantity' };
  const canonical = entry.ucum;
  if (printed === undefined || cleanUnit(printed) === '') {
    return UNITLESS.has(canonical) ? { ok: true, ucum: canonical, factor: 1 } : { ok: true, ucum: canonical, factor: 1, missing: true };
  }
  const c = cleanUnit(printed);
  const ucum = c === canonical ? canonical : printedToUcum(c, entry);
  if (ucum === undefined) return { ok: false, reason: 'unit_mismatch' };
  if (ucum === canonical) return { ok: true, ucum: canonical, factor: 1 };
  const conv = entry.unitConversions?.find((u) => u.from === ucum);
  if (conv) return { ok: true, ucum: canonical, factor: conv.factor };
  return { ok: false, reason: 'unit_mismatch' };
}

export function applyFactor(value: number, factor: number): number {
  return factor === 1 ? value : roundSig(value * factor);
}

export function isPlausible(value: number, entry: DictionaryEntry): boolean {
  if (!entry.plausible) return true;
  return value >= entry.plausible.min && value <= entry.plausible.max;
}

const UCUM_LABELS: Record<string, string> = {
  '10*3/uL': '×10³/µL',
  '10*6/uL': '×10⁶/µL',
  '/uL': 'cells/µL',
  'u[IU]/mL': 'µIU/mL',
  'm[IU]/mL': 'mIU/mL',
  'm[IU]/L': 'mIU/L',
  '[IU]/mL': 'IU/mL',
  'mL/min/{1.73_m2}': 'mL/min/1.73m²',
  '{ratio}': 'ratio',
  '1': '',
  '[pH]': 'pH',
  Ao: 'Å',
};

/** Human-readable label for a UCUM code (UI only; the card always carries UCUM). */
export function ucumLabel(ucum: string): string {
  if (ucum in UCUM_LABELS) return UCUM_LABELS[ucum]!;
  return ucum.replace(/^u(?=[a-zA-Z])/, 'µ');
}
