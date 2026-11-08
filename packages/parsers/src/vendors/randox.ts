// Randox Health "Discovery" report PDF (UK, SI units). Up to ~63 pages: marketing
// prose and bar graphs first, then the "Results for your Doctor" table
// (Test | Result | Units | Reference Range), then a "Nutrition Guide". Only the table is read.
//
// The table defeats the line-based reader in table.ts:
// - a test name that wraps straddles its value row (line 1 above the value's y, line 2 below);
// - multi-band reference ranges stack vertically ("≤95.0 Low" / "95.1 - 108.0 Optimal" / ">108.0 High"),
//   the value row aligned with one band and the others above and below with no test name;
// - "not detected" and its unit "mg/mmol creatinine" wrap across two lines.
// So rows are rebuilt from coordinates: every line with a Result cell anchors a row, and each
// fragment line (name, unit or band with no result) joins the row above or below it, split at the widest gap.
import { parseCell, VITAL_BOUNDS, VITAL_UNITS, type ParsedReport } from '@labkit/core';
import { parseStampText, zonedToUtc, type Stamp } from '../stamps';
import { detectHeader, type Column, type RawRow, type TableResult } from '../table';
import { COMMON_SKIP, type Template } from '../template';
import type { Line, ParsedVital, TextItem } from '../types';

const START = /^results for your doctor$/i;
const END = /^nutrition guide\b/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Printed when the report has no zone: Randox samples are collected in the UK. */
export const RANDOX_ZONE = 'Europe/London';

/**
 * Scores the report derives from other rows: risk scores (SPEC §11.6) and body fat, so they're left out.
 * eGFR is kept: Randox doesn't print the equation, so it maps to 69405-9 (no equation named), never to
 * the CKD-EPI 2021 code, and the row waits for the user to opt in (`formula_not_printed`).
 */
const DERIVED = /^(body fat|cardiovascular risk|qrisk|fib-?4|fibrosis-4)\b/i;

/**
 * Body measurements and vitals: not lab results, so never in the card (LabKit is lab-only). They're kept
 * apart as vitals for the HealthKit paths (vitals.json, CSV). First match wins: waist/hip ratio before waist.
 */
const VITAL_NAMES: [RegExp, ParsedVital['metric'] | 'bloodPressure'][] = [
  [/^waist\s*(?:\/|:|to)\s*hip\b/i, 'waistHipRatio'],
  [/^height\b/i, 'height'],
  [/^(?:body\s+)?weight\b/i, 'bodyMass'],
  [/^(?:body mass index|bmi)\b/i, 'bodyMassIndex'],
  [/^waist(?: circumference)?\b/i, 'waistCircumference'],
  [/^hip(?: circumference)?\b/i, 'hipCircumference'],
  [/^(?:pulse|heart rate|resting heart rate)\b/i, 'heartRate'],
  [/^(?:oxygen saturation|spo2|sp o2|blood oxygen)\b/i, 'oxygenSaturation'],
  [/^systolic\b/i, 'bloodPressureSystolic'],
  [/^diastolic\b/i, 'bloodPressureDiastolic'],
  [/^blood pressure\b/i, 'bloodPressure'],
];

/** Panel headings ("Heart Health", "Full Blood Count", "Iron Status"…); test names never end this way. */
const PANEL_NAME =
  /^(full blood count|metabolic syndrome|diabetes|urinalysis|urine analysis|immunity|inflammation|physical measurements|vital signs|.+ (health|status|profile|function|screen|screening|markers|count|panel|hormones|vitamins|minerals|measurements))$|^(vitamins|minerals|hormones)( .+)?$/i;

const SKIP: RegExp[] = [...COMMON_SKIP, /randoxhealth\.com/i, /^randox\b/i, /^\d{1,3}$/, /^results for your doctor$/i];

export const randox: Template = {
  id: 'randox',
  aliasVendor: 'randox',
  // Real reports print the name only as "Randox Health" (the logo is an image).
  detect: (t) => (/\brandox\b/i.test(t) && /results for your doctor/i.test(t) && /randoxhealth\.com/i.test(t) ? 20 : 0),
  header: [
    { role: 'name', re: /^tests?$/i },
    { role: 'result', re: /^results?$/i },
    { role: 'units', re: /^units?$/i },
    { role: 'range', re: /^reference ranges?$/i },
  ],
  collectedTz: 'local',
  skip: SKIP,
  maxConfidence: 'high',
  extractTable: randoxTable,
  patient: randoxPatient,
  // The same test repeats under several health areas. The Metabolic Syndrome panel prints its own
  // (tighter) cut-offs, so its range is used only when no other panel printed the test.
  dedupe: { preferRangeOver: /metabolic syndrome/i },
};

// ---------------------------------------------------------------- header block

/** "Label: value" or "Label" | "value" as separate items on one line. */
function labelValue(lines: readonly Line[], label: RegExp): string | undefined {
  const re = new RegExp(String.raw`^(?:${label.source})\s*(?::\s*(.*))?$`, 'i');
  for (const line of lines) {
    for (const [k, it] of line.items.entries()) {
      const m = re.exec(it.str.trim());
      if (!m) continue;
      const v = (m[1] ?? line.items[k + 1]?.str ?? '').trim();
      if (v) return v;
    }
  }
  return undefined;
}

/** "14-May-2026", "14 May 2026", "14/05/2026" (day first: UK) or "2026-05-14". */
function parseUkDate(s: string): { y: number; m: number; d: number; rest: string } | undefined {
  let m = /^(\d{1,2})[-\s/.]([A-Za-z]{3,9})\.?[-\s/.](\d{4})(.*)$/.exec(s.trim());
  if (m) {
    const mon = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    if (mon < 0) return undefined;
    return valid(Number(m[3]), mon + 1, Number(m[1]), m[4]!);
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/.exec(s.trim());
  if (m) return valid(Number(m[3]), Number(m[2]), Number(m[1]), m[4]!);
  m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(s.trim());
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]), m[4]!);
  return undefined;
}

function valid(y: number, m: number, d: number, rest: string) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? { y, m, d, rest } : undefined;
}

const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** "Sample Collection Date: 14-May-2026 08:45" (UK wall-clock time, no zone printed) → UTC. */
export function randoxCollected(lines: readonly Line[]): Stamp | undefined {
  const raw = labelValue(lines, /sample collection date(?:\s*(?:and|&|\/)\s*time)?/);
  if (!raw) return undefined;
  const d = parseUkDate(raw);
  if (!d) return parseStampText(`Collected: ${raw}`, 'local');
  const tm = /^[\s,T]*(?:at\s+)?(\d{1,2}):(\d{2})/.exec(d.rest);
  const h = tm ? Number(tm[1]) : 0;
  const mi = tm ? Number(tm[2]) : 0;
  if (h > 23 || mi > 59) return undefined;
  return { iso: iso(zonedToUtc(d.y, d.m - 1, d.d, h, mi, RANDOX_ZONE)), timeFound: !!tm, match: raw };
}

const TITLES = /^(mr|mrs|ms|miss|mx|dr|prof|sir|dame)\.?\s+/i;
const NAME = /^[\p{L}'’\-.]+(?: [\p{L}'’\-.]+)*$/u;
const title = (s: string) => s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

export function randoxPatient(lines: Line[]): ParsedReport['patient'] {
  const head = lines.slice(0, Math.max(0, lines.findIndex((l) => START.test(l.text.trim()))) || lines.length);
  const out: ParsedReport['patient'] = {};
  const name = labelValue(head, /(?:patient\s+)?name/)?.replace(TITLES, '').trim();
  if (name) {
    const comma = /^([^,]+),\s*(.+)$/.exec(name);
    const [family, given] = comma ? [comma[1]!.trim(), comma[2]!.trim()] : [name.split(/\s+/).at(-1)!, name.split(/\s+/).slice(0, -1).join(' ')];
    if (given && NAME.test(family) && NAME.test(given)) {
      out.family = title(family);
      out.given = given.replace(/\./g, '').split(/\s+/).map(title);
    }
  }
  const dob = labelValue(head, /dob|d\.o\.b\.?|date of birth/);
  const d = dob && parseUkDate(dob);
  if (d && !d.rest.trim()) out.birthDate = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  const sex = labelValue(head, /sex|gender/);
  if (sex && /^(m|male|f|female)$/i.test(sex)) out.gender = /^m/i.test(sex) ? 'male' : 'female';
  return out;
}

// ---------------------------------------------------------------- reference bands

export type Band = { low?: number; high?: number; lowInclusive: boolean; highInclusive: boolean; qualitative?: string; label: string; text: string };

const NUM = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const BAND_RE = new RegExp(
  String.raw`^(?:(?<a>${NUM})\s*[-–]\s*(?<b>${NUM})|(?<cmp><=|>=|≤|≥|<|>)\s*(?<c>${NUM})|(?<q>negative|positive|not detected|detected|normal|n\/a))(?:\s+(?<label>\S.*))?$`,
  'i',
);

/** "95.1 - 108.0 Optimal", "≤95.0 Low", ">108.0 High", "Negative", "N/A". */
export function parseBand(text: string): Band | undefined {
  const s = text.trim().replace(/\s+/g, ' ');
  const m = BAND_RE.exec(s);
  if (!m) return undefined;
  const g = m.groups!;
  const label = (g.label ?? '').trim();
  if (g.a !== undefined) return { low: Number(g.a), high: Number(g.b), lowInclusive: true, highInclusive: true, label, text: s };
  if (g.cmp !== undefined) {
    const n = Number(g.c);
    switch (g.cmp) {
      case '<':
        return { high: n, lowInclusive: true, highInclusive: false, label, text: s };
      case '<=':
      case '≤':
        return { high: n, lowInclusive: true, highInclusive: true, label, text: s };
      case '>':
        return { low: n, lowInclusive: false, highInclusive: true, label, text: s };
      default:
        return { low: n, lowInclusive: true, highInclusive: true, label, text: s };
    }
  }
  if (/^n\/a$/i.test(g.q!)) return undefined;
  return { qualitative: g.q!, lowInclusive: true, highInclusive: true, label, text: s };
}

const NORMAL_LABEL = /^(optimal|normal|desirable|ideal|healthy|negative|in range|within range|reference)$/i;

/** The band that is the report's reference range: the one labelled Optimal/Normal, or the only band. */
export function referenceBand(bands: readonly Band[]): Band | undefined {
  return bands.find((b) => NORMAL_LABEL.test(b.label)) ?? (bands.length === 1 ? bands[0] : undefined);
}

/** Range text evaluateRow understands ("95.1-108", "<=5", ">1"). */
function bandRange(b: Band): string | undefined {
  if (b.qualitative) return b.qualitative;
  if (b.low !== undefined && b.high !== undefined) return `${b.low}-${b.high}`;
  if (b.high !== undefined) return `${b.highInclusive ? '<=' : '<'}${b.high}`;
  if (b.low !== undefined) return `${b.lowInclusive ? '>=' : '>'}${b.low}`;
  return undefined;
}

/**
 * H/L from the value itself. The band printed on the value line isn't trusted (out-of-range values are
 * marked only by colour, so the text never says), and the value may sit in a band printed above or below.
 */
export function computeFlag(value: string, bands: readonly Band[]): 'H' | 'L' | 'A' | undefined {
  const cell = parseCell(value);
  const ref = referenceBand(bands);
  if (!cell) return undefined;
  if (cell.kind !== 'quantity') {
    if (ref?.qualitative) return cell.text.toLowerCase() === ref.qualitative.toLowerCase() ? undefined : 'A';
    return undefined;
  }
  const v = cell.value;
  const below = (b: Band) => b.low !== undefined && (v < b.low || (v === b.low && !b.lowInclusive));
  const above = (b: Band) => b.high !== undefined && (v > b.high || (v === b.high && !b.highInclusive));
  if (ref && !ref.qualitative) {
    // A censored value ("<0.30") is only out of range when its whole interval is.
    if (cell.comparator === '<' || cell.comparator === '<=') return ref.low !== undefined && v <= ref.low ? 'L' : undefined;
    if (cell.comparator === '>' || cell.comparator === '>=') return ref.high !== undefined && v >= ref.high ? 'H' : undefined;
    return below(ref) ? 'L' : above(ref) ? 'H' : undefined;
  }
  if (cell.comparator) return undefined;
  const hit = bands.find((b) => !b.qualitative && !below(b) && !above(b));
  if (hit && /\b(high|raised|elevated)\b/i.test(hit.label)) return 'H';
  if (hit && /\b(low|deficien|insufficien)/i.test(hit.label)) return 'L';
  return undefined;
}

// ---------------------------------------------------------------- table

type Cells = { name: string[]; result: string[]; units: string[]; range: string[] };
type TLine = { page: number; y: number; h: number; text: string; cells: Cells };
type Anchor = TLine & { names: { y: number; text: string }[]; units: { y: number; text: string }[]; bands: { y: number; band: Band }[]; panel?: string };

function cellsOf(line: Line, cols: Column[]): Cells {
  const c: Cells = { name: [], result: [], units: [], range: [] };
  const x = (r: string) => cols.find((k) => k.role === r)!.x0;
  for (const it of line.items) c[columnOf(it, x('result'), x('units'), x('range'))].push(it.str.trim());
  // One band per printed line, even when its bounds and label are separate items.
  return { ...c, range: c.range.length ? [join(c.range)] : [] };
}

/** Start position decides the column; values may sit a little left of their (left-aligned) header. */
function columnOf(it: TextItem, result: number, units: number, range: number): keyof Cells {
  const tol = 1.5 * it.h;
  if (it.x >= range - tol) return 'range';
  if (it.x >= units - tol) return 'units';
  if (it.x >= result - tol) return 'result';
  return 'name';
}

const join = (xs: string[]) => xs.join(' ').replace(/\s+/g, ' ').trim();

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 1;
}

/** "-" means no unit; "mg/mmol creatinine" is mg/mmol of creatinine. */
export function randoxUnit(u: string): string | undefined {
  const t = u
    .replace(/\s*\bcreatinine\b\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return !t || /^[-–—]$/.test(t) ? undefined : t;
}

export function randoxTable(lines: Line[]): TableResult {
  const stamp = randoxCollected(lines);
  const stamps = stamp ? [stamp] : [];
  const start = lines.findIndex((l) => START.test(l.text.trim()));
  if (start < 0) return { rows: [], headerFound: false, stamps };
  const endRel = lines.slice(start + 1).findIndex((l) => END.test(l.text.trim()));
  const section = lines.slice(start, endRel < 0 ? undefined : start + 1 + endRel);

  // Table lines, page by page, below each page's repeated column header.
  const table: TLine[] = [];
  let headerFound = false;
  for (const page of new Set(section.map((l) => l.page))) {
    const onPage = section.filter((l) => l.page === page);
    const hIdx = onPage.findIndex((l) => detectHeader(l, randox));
    if (hIdx < 0) continue;
    headerFound = true;
    const cols = detectHeader(onPage[hIdx]!, randox)!;
    if (!['name', 'result', 'units', 'range'].every((r) => cols.some((c) => c.role === r))) continue;
    for (const l of onPage.slice(hIdx + 1)) {
      // Whole lines only: a result such as "148" must not pass for a page number.
      if (SKIP.some((re) => re.test(l.text.trim()))) continue;
      table.push({ page: l.page, y: l.y, h: l.h, text: l.text, cells: cellsOf(l, cols) });
    }
  }
  const hMed = median(table.map((l) => l.h));

  // "not" / "detected": a result that only parses joined with the next result line's (a band may sit between).
  const merged: TLine[] = [];
  const used = new Set<TLine>();
  for (const [i, a] of table.entries()) {
    if (used.has(a)) continue;
    const ra = join(a.cells.result);
    const b = ra && !parseCell(ra) ? table.slice(i + 1).find((x) => x.page === a.page && x.y - a.y <= 1.6 * hMed && x.cells.result.length) : undefined;
    if (b && parseCell(`${ra} ${join(b.cells.result)}`)) {
      used.add(b);
      merged.push({
        ...a,
        y: (a.y + b.y) / 2,
        text: `${a.text}  ${b.text}`,
        cells: { name: [...a.cells.name, ...b.cells.name], result: [ra, ...b.cells.result], units: [...a.cells.units, ...b.cells.units], range: [...a.cells.range, ...b.cells.range] },
      });
    } else merged.push(a);
  }

  // Anchors (lines with a result) and panel headings.
  const isAnchor = (l: TLine) => l.cells.result.length > 0;
  const anchorLines = merged.filter(isAnchor);
  const nearest = (l: { page: number; y: number }) => {
    let best: TLine | undefined;
    for (const o of anchorLines) if (o.page === l.page && (!best || Math.abs(o.y - l.y) < Math.abs(best.y - l.y))) best = o;
    return best;
  };
  const panels = new Set<TLine>();
  for (const l of merged) {
    if (isAnchor(l) || !l.cells.name.length || l.cells.units.length || l.cells.range.length) continue;
    const near = nearest(l);
    // A heading: a known panel name, a bigger font, or no row close enough for it to be a wrapped name.
    if (PANEL_NAME.test(join(l.cells.name)) || l.h >= 1.15 * hMed || !near || Math.abs(near.y - l.y) > 1.5 * hMed) panels.add(l);
  }
  const anchors: Anchor[] = [];
  const byLine = new Map<TLine, Anchor>();
  let panel: string | undefined;
  for (const l of merged) {
    if (panels.has(l)) panel = join(l.cells.name);
    else if (isAnchor(l)) {
      const own = l.cells.range.map(parseBand).filter((b): b is Band => !!b);
      const a: Anchor = { ...l, names: [], units: [], bands: own.map((band) => ({ y: l.y, band })), ...(panel ? { panel } : {}) };
      anchors.push(a);
      byLine.set(l, a);
    }
  }
  // Rows never interleave, so the fragments between two rows split at one point: the widest gap (row
  // padding). With no clear widest gap (evenly spaced lines), each fragment joins the nearer row.
  const give = (a: Anchor, l: TLine) => {
    if (l.cells.name.length) a.names.push({ y: l.y, text: join(l.cells.name) });
    if (l.cells.units.length) a.units.push({ y: l.y, text: join(l.cells.units) });
    const band = l.cells.range.length ? parseBand(join(l.cells.range)) : undefined;
    if (band) a.bands.push({ y: l.y, band });
  };
  const split = (a: Anchor, frs: TLine[], b: Anchor) => {
    const ys = [a.y, ...frs.map((f) => f.y), b.y];
    const gaps = ys.slice(1).map((y, i) => y - ys[i]!);
    const order = [...gaps.keys()].sort((i, j) => gaps[j]! - gaps[i]!);
    const clear = gaps.length === 1 || gaps[order[0]!]! > gaps[order[1]!]! + 0.25 * hMed;
    frs.forEach((f, i) => give(clear ? (i < order[0]! ? a : b) : Math.abs(f.y - a.y) <= Math.abs(f.y - b.y) ? a : b, f));
  };
  let prev: Anchor | undefined;
  let between: TLine[] = [];
  merged.forEach((l, i) => {
    if (i > 0 && merged[i - 1]!.page !== l.page) {
      if (prev) between.forEach((f) => give(prev!, f));
      prev = undefined;
      between = [];
    }
    if (panels.has(l)) {
      if (prev) between.forEach((f) => give(prev!, f));
      prev = undefined;
      between = [];
    } else if (isAnchor(l)) {
      const a = byLine.get(l)!;
      if (prev) split(prev, between, a);
      else between.forEach((f) => give(a, f));
      prev = a;
      between = [];
    } else between.push(l);
  });
  if (prev) between.forEach((f) => give(prev!, f));

  const rows: RawRow[] = [];
  const vitals: ParsedVital[] = [];
  let excluded = 0;
  for (const a of anchors) {
    const above = join(a.names.filter((n) => n.y < a.y).sort((x, y) => x.y - y.y).map((n) => n.text));
    const own = join(a.cells.name);
    const below = join(a.names.filter((n) => n.y > a.y).sort((x, y) => x.y - y.y).map((n) => n.text));
    const full = join([above, own, below]);
    if (DERIVED.test(full) || DERIVED.test(own)) {
      excluded++;
      continue;
    }
    const value = join(a.cells.result);
    const unit = randoxUnit(join([...a.units, { y: a.y, text: join(a.cells.units) }].sort((x, y) => x.y - y.y).map((u) => u.text)));
    const vital = VITAL_NAMES.find(([re]) => re.test(full) || re.test(own))?.[1];
    if (vital) {
      // Vital bands (BMI, BP…) are irrelevant to HealthKit: only the value and unit are kept.
      const raw = { name: full, value, ...(unit ? { unit } : {}), ...(a.panel ? { panel: a.panel } : {}), page: a.page, line: [full, value, unit].filter(Boolean).join('  ') };
      vitals.push(...toVitals(vital, value, unit, raw));
      continue;
    }
    const bands = a.bands.sort((x, y) => x.y - y.y).map((b) => b.band);
    const ref = referenceBand(bands);
    const range = ref && bandRange(ref);
    const flag = computeFlag(value, bands);
    const line = [full, value, unit, bands.map((b) => b.text).join(' / ')].filter(Boolean).join('  ');
    // The whole wrapped name is tried first. A line above that has a name of its own may instead be a
    // heading that sat close to the row, so "own + below" is the only fallback: a fragment alone
    // ("Mean Cell Haemoglobin" out of "… Concentration (MCHC)") could name a different test.
    const row: RawRow = above && own ? { name: join([own, below]), nameAbove: above, value, page: a.page, line } : { name: full, value, page: a.page, line };
    if (flag) row.flag = flag;
    if (range) row.range = range;
    if (unit) row.unit = unit;
    if (a.panel) row.panel = a.panel;
    if (stamp) row.collected = stamp;
    rows.push(row);
  }
  const warnings = excluded ? [`Left out ${excluded} calculated score${excluded === 1 ? '' : 's'} (not lab results).`] : [];
  const head = lines.slice(0, start);
  const fasting = labelValue(head, /fasted for|fasting(?: duration)?/);
  const fm = fasting && /^(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:and\s*)?(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*$/i.exec(fasting.trim());
  const fastingMinutes = fm && (fm[1] || fm[2]) ? Number(fm[1] ?? 0) * 60 + Number(fm[2] ?? 0) : undefined;
  const programme = labelValue(head, /programme|program/);
  const sampleId = labelValue(head, /sample id/);
  return {
    rows,
    headerFound,
    stamps,
    warnings,
    vitals: {
      lab: 'Randox Health',
      zone: RANDOX_ZONE,
      ...(stamp ? { collectedAt: stamp.iso } : {}),
      ...(programme ? { programme } : {}),
      ...(sampleId ? { sampleId } : {}),
      ...(fastingMinutes !== undefined ? { fastingMinutes } : {}),
      rows: dedupeVitals(vitals),
    },
  };
}

// ---------------------------------------------------------------- vitals

/** Printed unit → factor to the metric's canonical unit (VITAL_UNITS). Missing entries: unit can't be used. */
const VITAL_UNIT_FACTORS: Record<ParsedVital['metric'], Record<string, number>> = {
  height: { m: 1, cm: 0.01, mm: 0.001 },
  bodyMass: { kg: 1, kgs: 1, lb: 0.45359237, lbs: 0.45359237 },
  bodyMassIndex: { '': 1, 'kg/m2': 1, 'kg/m²': 1 },
  waistCircumference: { cm: 1, m: 100, mm: 0.1, in: 2.54 },
  hipCircumference: { cm: 1, m: 100, mm: 0.1, in: 2.54 },
  heartRate: { '': 1, bpm: 1, 'beats/min': 1, '/min': 1, 'count/min': 1 },
  oxygenSaturation: { '%': 1 },
  bloodPressureSystolic: { mmhg: 1 },
  bloodPressureDiastolic: { mmhg: 1 },
  waistHipRatio: { '': 1, ratio: 1 },
};

const sig = (x: number) => Number(x.toPrecision(6));

function toVitals(metric: ParsedVital['metric'] | 'bloodPressure', value: string, unit: string | undefined, raw: ParsedVital['raw']): ParsedVital[] {
  if (metric === 'bloodPressure') {
    // One row printed as "128/80".
    const m = /^(\d{2,3})\s*\/\s*(\d{2,3})$/.exec(value);
    if (!m) return [{ metric: 'bloodPressureSystolic', raw, issues: ['unreadable'] }];
    return [toVital('bloodPressureSystolic', m[1]!, unit, raw), toVital('bloodPressureDiastolic', m[2]!, unit, raw)];
  }
  return [toVital(metric, value, unit, raw)];
}

function toVital(metric: ParsedVital['metric'], value: string, unit: string | undefined, raw: ParsedVital['raw']): ParsedVital {
  const n = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : undefined;
  if (n === undefined) return { metric, raw, issues: ['unreadable'] };
  const key = (unit ?? '').normalize('NFC').replace(/\s+/g, '').toLowerCase();
  const factor = VITAL_UNIT_FACTORS[metric][key];
  if (factor === undefined) return { metric, raw, issues: ['unit'] };
  const v = factor === 1 ? n : sig(n * factor);
  const out: ParsedVital = { metric, value: v, unit: metric === 'waistHipRatio' ? 'ratio' : VITAL_UNITS[metric], raw, issues: [] };
  if (metric !== 'waistHipRatio' && (v < VITAL_BOUNDS[metric].min || v > VITAL_BOUNDS[metric].max)) out.issues.push('implausible');
  return out;
}

/**
 * One row per metric. Height, weight, BMI, waist and BP repeat under Metabolic Syndrome: the copy from any
 * other panel (Personal Health Measurements) is kept. Copies that disagree are flagged for review.
 */
export function dedupeVitals(all: ParsedVital[]): ParsedVital[] {
  const out: ParsedVital[] = [];
  for (const metric of new Set(all.map((v) => v.metric))) {
    const copies = all.filter((v) => v.metric === metric);
    const keep = { ...(copies.find((v) => !/metabolic syndrome/i.test(v.raw.panel ?? '')) ?? copies[0]!) };
    keep.issues = [...keep.issues];
    if (copies.some((c) => c.value !== keep.value)) keep.issues.push('conflict');
    out.push(keep);
  }
  const sys = out.find((v) => v.metric === 'bloodPressureSystolic');
  const dia = out.find((v) => v.metric === 'bloodPressureDiastolic');
  if (sys?.value !== undefined && dia?.value !== undefined && !(sys.value > dia.value)) {
    sys.issues.push('order');
    dia.issues.push('order');
  }
  return out;
}
