// Raw table rows → normalized, dictionary-matched ParsedRows with confidence
// (SPEC §12.4, §12.5).
import {
  applyFactor,
  cleanUnit,
  isPlausible,
  normalizeQualitativeCase,
  parseCell,
  parseRange,
  parseTiter,
  printedToUcum,
  resolveUnit,
  roundSig,
  type Cell,
  type Dictionary,
  type DictionaryEntry,
  type ParsedRow,
  type RowIssue,
  type Vendor,
} from '@labkit/core';
import type { RawRow } from './table';
import type { Method } from './types';

const FLAG_RE = /^(H|L|HH|LL|A|AA|High|Low|Abnormal|Abn|Critical|Crit|\*+)$/i;
const BLOCKING: readonly RowIssue[] = ['implausible', 'unit_mismatch', 'ambiguous_match'];
/** Informational only: a missing reference range says nothing about whether the value was read correctly. */
const INFO: readonly RowIssue[] = ['no_range'];

const NOTE_RANGE = /^\s*reference\s+range\s*:?\s+(.+?)\s*$/i;

/**
 * Quest often prints the reference range in the comment under a result
 * ("Reference range: <100") instead of the range column. Accept it only when
 * exactly one such labelled line exists, it parses as a range, and any unit on
 * it matches the result's unit. Risk tables and "Reference Ranges for …" (plural,
 * e.g. by time of day) are never used.
 */
export function rangeFromNotes(notes: readonly string[] | undefined, valueUnit: string | undefined, entry: DictionaryEntry): { low?: number; high?: number } | undefined {
  const hits = (notes ?? []).map((n) => NOTE_RANGE.exec(n.replace(/\s{2,}/g, ' '))?.[1]).filter((m): m is string => !!m);
  if (hits.length !== 1) return undefined;
  const { range, unit } = splitRangeCell(hits[0]!);
  if (!range || (range.low === undefined && range.high === undefined)) return undefined;
  if (unit && cleanUnit(unit) !== '') {
    const a = printedToUcum(unit, entry);
    const b = valueUnit ? printedToUcum(valueUnit, entry) : entry.ucum ?? undefined;
    if (!a || a !== b) return undefined;
  }
  return range;
}

/** Split a printed cell into value, trailing unit and flag: "105 H" → 105 / H, "88 mg/dL" → 88 / mg/dL. */
export function splitValueCell(text: string): { cell?: Cell; value: string; unit?: string; flag?: string } {
  let tokens = text.trim().split(/\s+/).filter(Boolean);
  let flag: string | undefined;
  const flagAt = tokens.findIndex((tok, i) => i > 0 && FLAG_RE.test(tok));
  if (flagAt > 0) {
    flag = tokens[flagAt]!;
    tokens = tokens.filter((_, i) => i !== flagAt);
  }
  for (let k = tokens.length; k >= 1; k--) {
    const head = tokens.slice(0, k).join(' ');
    const cell = parseCell(head);
    if (cell) {
      const rest = tokens.slice(k).join(' ');
      return { cell, value: head, ...(rest ? { unit: rest } : {}), ...(flag ? { flag } : {}) };
    }
  }
  return { value: tokens.join(' '), ...(flag ? { flag } : {}) };
}

/** "65-99 mg/dL" → range + unit. */
export function splitRangeCell(text: string): { range?: { low?: number; high?: number }; unit?: string } {
  const tokens = text
    .replace(/\bsee note:?/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (let k = tokens.length; k >= 1; k--) {
    const r = parseRange(tokens.slice(0, k).join(' '));
    if (r && !('qualitative' in r)) {
      const rest = tokens.slice(k).join(' ');
      return { range: r, ...(rest ? { unit: rest } : {}) };
    }
    if (r) return {};
  }
  // No range at all: the column may hold just a unit ("mg/dL (calc)").
  return tokens.length ? { unit: tokens.join(' ') } : {};
}

const cleanName = (s: string) =>
  s
    .replace(/\s*\((?:calc|calculated)\)\s*$/i, '')
    .replace(/[\s*†‡#]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

const fuzzyKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]/g, '');

export type MatchResult = { entry?: DictionaryEntry; fuzzy: boolean; ambiguous: boolean; name: string };

export function makeMatcher(dictionary: Dictionary) {
  // Fuzzy index over every alias and label. Panel-scoped aliases only count inside that panel.
  const index = new Map<string, Set<DictionaryEntry>>();
  const scoped = new Map<string, Set<DictionaryEntry>>();
  const put = (m: Map<string, Set<DictionaryEntry>>, k: string, e: DictionaryEntry) => {
    if (!k) return;
    m.set(k, (m.get(k) ?? new Set()).add(e));
  };
  for (const e of dictionary.entries) {
    put(index, fuzzyKey(e.text), e);
    for (const a of e.aliases) put(a.panel ? scoped : index, a.panel ? `${a.panel}|${fuzzyKey(a.name)}` : fuzzyKey(a.name), e);
  }

  return function match(vendor: Vendor, raw: RawRow, panel: string | undefined): MatchResult {
    // Longest wrapped form first: "ARACHIDONIC ACID" + "/EPA RATIO" must not stop at arachidonic acid.
    const candidates: string[] = [];
    if (raw.nameAbove && raw.nameBelow) candidates.push(`${raw.nameAbove} ${raw.name} ${raw.nameBelow}`);
    if (raw.nameBelow) candidates.push(`${raw.name} ${raw.nameBelow}`);
    if (raw.nameBelowShort) candidates.push(`${raw.name} ${raw.nameBelowShort}`);
    if (raw.nameAbove) candidates.push(`${raw.nameAbove} ${raw.name}`);
    candidates.push(raw.name);
    for (const c of candidates.map(cleanName)) {
      const m = dictionary.match(vendor, c, panel);
      if (m.kind === 'exact') return { entry: m.entry, fuzzy: false, ambiguous: false, name: c };
      if (m.kind === 'ambiguous') return { fuzzy: false, ambiguous: true, name: c };
    }
    const name = cleanName(raw.name);
    const k = fuzzyKey(name);
    const hits = new Set<DictionaryEntry>([...(panel ? (scoped.get(`${panel}|${k}`) ?? []) : []), ...(panel ? [] : (index.get(k) ?? []))]);
    if (panel && hits.size === 0) for (const e of index.get(k) ?? []) hits.add(e);
    if (hits.size === 1) return { entry: [...hits][0]!, fuzzy: true, ambiguous: false, name };
    return { fuzzy: false, ambiguous: hits.size > 1, name };
  };
}

/** Alias scope for a printed panel heading. Timed (24-hour) urine tests share names with spot urine tests, so they get their own. */
export function panelKey(panel: string | undefined): string | undefined {
  if (!panel) return undefined;
  if (/urin/i.test(panel) && /\b24[\s-]*(h|hr|hrs|hour|hours)\b/i.test(panel)) return '24h urine';
  return /urin|\bUA\b/i.test(panel) ? 'urinalysis' : undefined;
}

export function isBlocking(row: ParsedRow): boolean {
  return !row.entry || !row.value || row.issues.some((i) => BLOCKING.includes(i));
}

export type EvaluateContext = { vendor: Vendor; method: Method; maxConfidence: 'high' | 'medium'; match: ReturnType<typeof makeMatcher> };

export function evaluateRow(raw: RawRow, ctx: EvaluateContext): ParsedRow | undefined {
  const panel = panelKey(raw.panel);
  const m = ctx.match(ctx.vendor, raw, panel);
  const split = splitValueCell(raw.value);
  const rangeSplit = raw.range ? splitRangeCell(raw.range) : {};
  const flag = raw.flag ?? split.flag;
  const out: ParsedRow = {
    raw: {
      name: m.name,
      value: split.value,
      page: raw.page,
      line: raw.line,
      ...(flag ? { flag } : {}),
      ...(raw.range ? { range: raw.range } : {}),
      ...((raw.unit ?? split.unit ?? rangeSplit.unit) ? { unit: raw.unit ?? split.unit ?? rangeSplit.unit } : {}),
      ...(raw.panel ? { panel: raw.panel } : {}),
    },
    confidence: 'high',
    issues: [],
  };
  if (!m.entry) {
    // Not in the dictionary. Only result-like lines are worth reporting.
    if (!split.cell && !m.ambiguous) return undefined;
    if (m.ambiguous) out.issues.push('ambiguous_match');
    out.confidence = 'low';
    return out;
  }

  const e = m.entry;
  out.entry = e;
  const issues = new Set<RowIssue>();
  let soft = m.fuzzy ? 1 : 0;

  // Never let a urinalysis row land on a serum analyte (or vice versa via fuzzy match).
  if ((panel === 'urinalysis') !== (e.category === 'urinalysis') && !/urin/i.test(e.text) && (panel === 'urinalysis' || m.fuzzy)) issues.add('ambiguous_match');

  if (e.valueType === 'quantity') {
    if (split.cell?.kind === 'quantity') {
      const printed = raw.unit ?? split.unit ?? rangeSplit.unit;
      const unit = resolveUnit(printed, e);
      if (!unit.ok) {
        issues.add('unit_mismatch');
      } else {
        if (unit.missing) soft++;
        const value = applyFactor(split.cell.value, unit.factor);
        out.value = { kind: 'quantity', value, ucum: unit.ucum, ...(split.cell.comparator ? { comparator: split.cell.comparator } : {}) };
        if (!isPlausible(value, e)) issues.add('implausible');
        const r = rangeSplit.range;
        // A range printed in a different unit than the value can't be trusted.
        const rp = rangeSplit.unit;
        const sameUnit = !rp || !printed || cleanUnit(rp) === cleanUnit(printed) || printedToUcum(rp, e) === printedToUcum(printed, e);
        const noted = r && sameUnit ? undefined : rangeFromNotes(raw.notes, printed, e);
        const use = r && sameUnit ? r : noted;
        if (use) {
          out.range = {};
          if (use.low !== undefined) out.range.low = unit.factor === 1 ? use.low : roundSig(use.low * unit.factor);
          if (use.high !== undefined) out.range.high = unit.factor === 1 ? use.high : roundSig(use.high * unit.factor);
          out.rangeSource = noted ? 'note' : 'column';
        } else {
          issues.add('no_range');
        }
      }
    }
  } else if (e.valueType === 'titer') {
    const t = parseTiter(split.value);
    if (t) out.value = { kind: 'titer', text: t };
  } else {
    const normalized = normalizeQualitativeCase(split.cell?.kind === 'qualitative' ? split.cell.text : split.value, e.answers);
    if (normalized && normalized.length <= 64 && (!e.answers || e.answers.includes(normalized))) {
      out.value = { kind: 'qualitative', text: normalized };
    }
  }

  if (ctx.method === 'ocr') issues.add('ocr');
  out.issues = [...issues];
  const hard = out.issues.some((i) => !INFO.includes(i));
  out.confidence = hard || !out.value ? 'low' : soft > 0 || ctx.maxConfidence === 'medium' ? 'medium' : 'high';
  return out;
}
