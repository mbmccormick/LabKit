// Column reconstruction from a header line (SPEC §12.3 steps 3–7).
import { printedToUcum } from '@labkit/core';
import { parseStampText, type Stamp } from './stamps';
import type { Role, Template } from './template';
import { VALUE_ROLES } from './template';
import type { Line, TextItem } from './types';

export type Column = { role: Role; x0: number; x1: number };

export type RawRow = {
  name: string;
  value: string;
  flag?: string;
  range?: string;
  unit?: string;
  panel?: string;
  page: number;
  line: string;
  collected?: Stamp;
  /** Adjacent name-only lines: candidates for wrapped test names. */
  nameAbove?: string;
  nameBelow?: string;
  /** First of two lines in nameBelow, tried if the two-line join doesn't match. */
  nameBelowShort?: string;
  /** Text of the lines under this result, up to the next result or panel (the lab's comment block). */
  notes?: string[];
};

export type TableResult = { rows: RawRow[]; headerFound: boolean; stamps: Stamp[] };

/** Returns the header's columns if this line is a column header for the template. */
export function detectHeader(line: Line, t: Template): Column[] | undefined {
  const cols: Column[] = [];
  for (const it of line.items) {
    const text = it.str.trim().replace(/\s+/g, ' ');
    const h = t.header.find((c) => c.re.test(text));
    if (h && !cols.some((c) => c.role === h.role)) cols.push({ role: h.role, x0: it.x, x1: it.x + it.w });
  }
  const hasName = cols.some((c) => c.role === 'name');
  const hasValue = cols.some((c) => VALUE_ROLES.includes(c.role));
  // Require at least three recognised cells so ordinary prose can't pass as a header.
  return hasName && hasValue && cols.length >= 3 ? cols.sort((a, b) => a.x0 - b.x0) : undefined;
}

/**
 * Column for an item: the band from its header's left edge to the next
 * header's left edge. Start position, not overlap, so a long comment that
 * spills across columns stays in the column it starts in.
 */
export function assignColumn(it: TextItem, cols: Column[]): Column {
  const tol = 0.5 * it.h;
  let band = cols[0]!;
  for (const c of cols) if (c.x0 - tol <= it.x) band = c;
  return band;
}

/**
 * Refines the start-position band. Name-column text stays put (long names and
 * comments start there). Values are often right-aligned or centred under their
 * header, so any other item goes to the value/range column whose header centre
 * is nearest to its own centre. A right-aligned value that starts left of its
 * header ("NEGATIVE", "NONE SEEN") after the name also moves to its column.
 */
function realign(it: TextItem, band: Column, cols: Column[], hasNameAlready: boolean, hasValueAlready = false): Column {
  const center = it.x + it.w / 2;
  const nearest = () => {
    let best = band;
    let dist = Infinity;
    for (const c of cols) {
      if (c.role === 'name') continue;
      const d = Math.abs((c.x0 + c.x1) / 2 - center);
      if (d < dist) {
        best = c;
        dist = d;
      }
    }
    return best;
  };
  if (band.role !== 'name') {
    // Content beats position when columns are centred: "3.5-5.0" is a range and
    // "% by wt" a unit, never a result value.
    const text = it.str.trim();
    const rangeCol = cols.find((c) => c.role === 'range');
    const unitCol = cols.find((c) => c.role === 'units');
    const near = nearest();
    if (VALUE_ROLES.includes(near.role)) {
      if (rangeCol && /^\d*\.?\d+\s*-\s*\d*\.?\d+(\s|$)/.test(text)) return rangeCol;
      // "<150 nmol/L" after the result is the reference range, not a second value.
      if (rangeCol && hasValueAlready && /^(<|>|<=|>=|≤|≥|[<>]\s*or\s*=)\s*\d*\.?\d+\s+\S/i.test(text) && !/^\S+\s+(H|L|HH|LL|A|AA)$/i.test(text)) return rangeCol;
      if (!/\d/.test(text.replace(/[0-9]+\/[a-z]/gi, '')) && printedToUcum(text)) return unitCol ?? rangeCol ?? near;
    }
    return near;
  }
  if (!hasNameAlready) return band;
  const end = it.x + it.w;
  const slack = 1.5 * it.h;
  return cols.some((c) => c.role !== 'name' && end >= c.x0 && end <= c.x1 + slack) ? nearest() : band;
}

const COMMENT_NAME =
  /^(desirable|borderline|optimal|near optimal|moderate|very high|high|low|elevated|normal|high risk|low risk|average risk|risk|reference range|reference interval|interpretation|note|notes|comment|comments|for (adults|ages|patients)|see note|result reviewed)\b/i;
const PANEL_WORDS = /\b(panel|profile|cbc|metabolic|lipid|urinalysis|chemistry|hematology|thyroid|hormone|omegacheck|cardio ?iq)\b/i;
const HEADER_NAME = /^(tests?|test name|analyte( name)?|component)$/i;
/** Metadata printed in the table area that isn't a column value. */
const META_ITEM = /^(collected|received|reported|resulted|verified|released)\s*:/i;

function looksLikePanel(text: string): boolean {
  if (text.length > 80 || COMMENT_NAME.test(text)) return false;
  const letters = text.replace(/[^A-Za-z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return PANEL_WORDS.test(text) || (letters.length >= 4 && upper / letters.length > 0.8);
}

/** A collection stamp whose time wrapped onto the next line: "Collected: 04/17/2026" / "08:40 AM UTC". */
function stampFor(lines: Line[], idx: number, t: Template): Stamp | undefined {
  const line = lines[idx]!;
  const found = parseStampText(line.text, t.collectedTz);
  if (!found || found.timeFound) return found;
  const next = lines[idx + 1];
  if (!next || next.page !== line.page || !/^\s*\d{1,2}(:\d{2})?\s*([AP]\.?M\.?)?\b/i.test(next.text)) return found;
  const joined = /\d:\s*$/.test(line.text) ? line.text.replace(/\s+$/, '') + next.text.trimStart() : `${line.text} ${next.text}`;
  const both = parseStampText(joined, t.collectedTz);
  return both?.timeFound ? { ...both, match: found.match } : found;
}

/** Codes listed under a "Performing Labs" heading: "01: LITPP - Labcorp Itasca, ..." → "01". */
export function legendLabCodes(lines: readonly Line[]): Set<string> {
  const codes = new Set<string>();
  lines.forEach((line, i) => {
    if (!/^performing labs?:?$/i.test(line.text.trim())) return;
    for (const next of lines.slice(i + 1, i + 11)) {
      if (next.page !== line.page) break;
      const m = /^([0-9A-Z]{2}):\s+\S/.exec(next.items[0]?.str.trim() ?? '');
      if (m) codes.add(m[1]!);
    }
  });
  return codes;
}

/** "Calcium, Urine 01" → "Calcium, Urine" when 01 is a listed performing-lab code. */
export function stripLabCode(name: string, codes: ReadonlySet<string>): string {
  const m = /^(.*\S)\s+([0-9A-Z]{2})$/.exec(name);
  return m && codes.has(m[2]!) ? m[1]! : name;
}

type NameOnly = { idx: number; text: string; page: number; y: number; h: number };
type WorkRow = RawRow & { idx: number; y: number; h: number };

export function extractTable(lines: Line[], t: Template): TableResult {
  const rows: WorkRow[] = [];
  const nameOnly: NameOnly[] = [];
  const stamps: Stamp[] = [];
  let cols: Column[] | undefined;
  let headerFound = false;
  let stamp: Stamp | undefined;
  let panel: string | undefined;
  let lastRow: WorkRow | undefined;
  /** The result whose comment block the following lines belong to. */
  let noteRow: WorkRow | undefined;
  const addNote = (text: string) => {
    if (noteRow && (noteRow.notes ??= []).length < 15) noteRow.notes.push(text);
  };
  let colsPage = -1;
  const firstTableIdx = new Map<number, number>();
  const labCodes = t.labCodes ? legendLabCodes(lines) : new Set<string>();

  lines.forEach((line, idx) => {
    const found = stampFor(lines, idx, t);
    if (found) {
      stamp = found;
      stamps.push(found);
    }
    const header = detectHeader(line, t);
    if (header) {
      // Labcorp titles the panel on the line just above the column header ("Litholink 24Hr Urine Panel").
      const above = lines[idx - 1];
      if (above && above.page === line.page && above.items.length === 1 && line.y - above.y <= 3 * line.h && PANEL_WORDS.test(above.text) && looksLikePanel(above.text)) panel = above.text.trim();
      cols = header;
      colsPage = line.page;
      headerFound = true;
      lastRow = undefined;
      return;
    }
    // Columns never carry over to another page, and a header we don't recognise
    // (e.g. a history table whose columns are earlier dates) stops reading. Otherwise
    // previous results could be read as current ones (SPEC §12.3.6).
    if (cols && (line.page !== colsPage || line.items.slice(0, 2).some((i) => HEADER_NAME.test(i.str.trim())))) cols = undefined;
    if (!cols) return;
    if (t.skip.some((re) => re.test(line.text) || line.items.some((i) => re.test(i.str)))) return;

    if (!firstTableIdx.has(line.page)) firstTableIdx.set(line.page, idx);
    const nameCol = cols.find((c) => c.role === 'name')!;
    const cells = new Map<Role, string[]>();
    let nameX: number | undefined;
    for (const it of line.items) {
      let str = it.str;
      if (found && str.includes(found.match)) str = str.replace(found.match, '').trim();
      if (!str || META_ITEM.test(str)) continue;
      // Drop the time/zone tail of a wrapped stamp ("08:40 AM UTC").
      if (/^\d{1,2}(:\d{2})?\s*([AP]M)?\s*(UTC|GMT)?$/i.test(str) && !cells.size) continue;
      const hasValue = VALUE_ROLES.some((r) => cells.has(r));
      const band = realign(it, assignColumn(it, cols), cols, cells.has('name'), hasValue);
      if (band.role === 'name' && nameX === undefined) nameX = it.x;
      cells.set(band.role, [...(cells.get(band.role) ?? []), { ...it, str }.str]);
    }
    const get = (r: Role) => (cells.get(r) ?? []).join(' ').trim();
    const name = stripLabCode(get('name').replace(/[:\s]+$/, ''), labCodes);
    const value = get('outOfRange') || get('inRange') || get('result');
    const adjacent = lastRow && lastRow.page === line.page && lastRow.idx === idx - 1 && Math.abs(line.y - lastRow.y) <= 1.8 * lastRow.h;
    // Interpretive text is indented well past where test names start.
    const indented = nameX !== undefined && nameX > nameCol.x0 + 3 * line.h;

    if (!value) {
      if (found) noteRow = undefined; // a new panel heading ends the previous comment block
      else addNote(line.text);
      // Continuation of the row above: a wrapped unit ("/uL", "/1.73m2") and/or name ("COUNT").
      const extraRange = get('range');
      const extraUnit = get('units');
      // Only unit fragments ("/uL", "73m2") continue a row; sentences ("Verified by repeat analysis.") are notes.
      const fragment = (t: string) => !t || (!/\s/.test(t) && t.length <= 12);
      if (adjacent && lastRow && (extraRange || extraUnit) && !indented && fragment(extraRange) && fragment(extraUnit)) {
        const join = (a: string | undefined, b: string) => (a ? (b.startsWith('/') || /[/.]$/.test(a) ? a + b : `${a} ${b}`) : b);
        if (extraRange) lastRow.range = join(lastRow.range, extraRange);
        if (extraUnit) lastRow.unit = join(lastRow.unit, extraUnit);
      }
      if (name && !indented && !get('flag')) {
        nameOnly.push({ idx, text: name, page: line.page, y: line.y, h: line.h });
        // A heading with a Collected stamp (same or next line) is always a panel; otherwise a line directly under
        // a result is more likely a wrapped name ("ESTERASE" under "LEUKOCYTE") than a new panel.
        const stampNext = lines[idx + 1] && parseStampText(lines[idx + 1]!.text, t.collectedTz);
        const hasLab = get('lab') !== '';
        if (found || stampNext || (looksLikePanel(name) && (!adjacent || hasLab || PANEL_WORDS.test(name)) && !extraRange)) panel = name;
      }
      return;
    }
    if (indented || COMMENT_NAME.test(name)) {
      addNote(line.text);
      return;
    }
    if (!name && adjacent && lastRow && !get('range') && !get('units') && /^[A-Za-z]/.test(lastRow.value) && /^[A-Za-z]/.test(value)) {
      // A qualitative result that wraps onto the next line ("RH(D)" / "POSITIVE").
      lastRow.value = `${lastRow.value} ${value}`;
      lastRow.line = `${lastRow.line}  ${value}`;
      return;
    }
    if (!name) {
      // A value with no name: the name may be on the line directly above.
      const above = nameOnly.at(-1);
      if (above && above.idx === idx - 1 && above.page === line.page) {
        if (panel === above.text) panel = undefined;
        lastRow = mkRow(above.text);
        noteRow = lastRow;
        rows.push(lastRow);
      } else addNote(line.text);
      return;
    }
    lastRow = mkRow(name);
    noteRow = lastRow;
    rows.push(lastRow);

    function mkRow(n: string): WorkRow {
      const r: WorkRow = { name: n, value, page: line.page, line: line.text, idx, y: line.y, h: line.h };
      const flag = get('flag');
      const range = get('range');
      const unit = get('units');
      if (flag) r.flag = flag;
      if (range) r.range = range;
      if (unit) r.unit = unit;
      if (panel) r.panel = panel;
      if (stamp) r.collected = stamp;
      return r;
    }
  });

  // Wrapped names: name-only lines directly above/below a result row. Below may be
  // up to two lines ("THYROID" / "PEROXIDASE" / "ANTIBODIES"), and a name that wraps
  // across a page break continues on the next page's first table line. Candidates
  // only count if the joined name is an exact dictionary alias (see rows.ts).
  const byIdx = new Map(nameOnly.map((n) => [n.idx, n]));
  const near = (a: { page: number; y: number }, b: { page: number; y: number }, h: number) => a.page === b.page && Math.abs(a.y - b.y) <= 1.8 * h;
  rows.forEach((r, i) => {
    const above = byIdx.get(r.idx - 1);
    if (above && near(above, r, r.h)) r.nameAbove = above.text;
    const b1 = byIdx.get(r.idx + 1);
    if (b1 && near(b1, r, r.h)) {
      const b2 = byIdx.get(r.idx + 2);
      r.nameBelow = b2 && near(b2, b1, r.h) ? `${b1.text} ${b2.text}` : b1.text;
      if (b2 && near(b2, b1, r.h)) r.nameBelowShort = b1.text;
      return;
    }
    const next = rows[i + 1];
    const lastOnPage = !next || next.page !== r.page;
    const first = firstTableIdx.get(r.page + 1);
    const carry = first !== undefined ? byIdx.get(first) : undefined;
    if (lastOnPage && carry && !nameOnly.some((n) => n.page === r.page && n.idx > r.idx)) r.nameBelow = carry.text;
  });
  return { rows: rows.map(({ idx: _i, y: _y, h: _h, ...r }) => r), headerFound, stamps };
}
