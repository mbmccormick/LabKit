import type { ParsedReport } from '@labkit/core';

export type Stamp = { iso: string; timeFound: boolean; match: string };

/** Zone printed after a stamp: Quest's own reports print the performing site's US zone ("11:00 EDT"). */
const ZONE = String.raw`(?:local|utc|gmt|[ECMP][SD]?T|AK[SD]T|H[SD]T)\b`;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Label, then one date form: "04/17/2026", "2026-04-17" or "Apr 17, 2026". Then an optional time,
// after spaces/comma/T, " / " (Quest: "09/29/2020 / 11:00 EDT") or " at ".
const COLLECTED_RE = new RegExp(
  String.raw`\b(?:collected|collection(?: date)?(?:\s*\/\s*time| (?:and )?time)?|date(?:\s*\/\s*time)? collected|(?:specimen|sample) collected|date of collection|drawn|draw date)\s*(?:(?:on|at|date)\s*)?(?::\s*)?` +
    String.raw`(?:(?<um>\d{1,2})\/(?<ud>\d{1,2})\/(?<uy>\d{4}|\d{2})|(?<iy>\d{4})-(?<im>\d{2})-(?<id>\d{2})|(?<mn>${MONTHS.join('|')})[a-z]*\.?\s+(?<md>\d{1,2}),?\s+(?<my>\d{4}))(?!\d)` +
    String.raw`(?:(?:\s*\/\s*|\s+at\s+|[\s,T]+)(?<h>\d{1,2}):?(?<mi>\d{2})(?::\d{2})?\s*(?:(?<ap>[AP]\.?M\.?)(?:\s*${ZONE})?|${ZONE})?|\s*${ZONE})?`,
  'i',
);
const ZONE_AT_END = new RegExp(String.raw`(?:^|\s|\d)(${ZONE.replace(String.raw`\b`, '')})\s*$`, 'i');

/** Fixed US offsets in hours; the generic "ET"/"PT" forms follow DST through their IANA zone. */
const ZONE_OFFSETS: Record<string, number> = { EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, AKST: -9, AKDT: -8, HST: -10, HDT: -9 };
const ZONE_IANA: Record<string, string> = { ET: 'America/New_York', CT: 'America/Chicago', MT: 'America/Denver', PT: 'America/Los_Angeles' };

/** Wall-clock time in an IANA zone → epoch ms. */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, zone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
  const wall = Date.UTC(y, mo, d, h, mi);
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!) - t;
  };
  const first = wall - offsetAt(wall);
  return wall - offsetAt(first);
}

/**
 * "Collected: 04/17/2026 01:40 PM" → ISO UTC. tz says how to read a wall-clock
 * time with no zone on it; a zone printed on the stamp always wins. A date with
 * no time is midnight local (or in the printed zone): reading it as UTC would show
 * the previous day anywhere in the Americas.
 */
export function parseStampText(text: string, tz: 'utc' | 'local'): Stamp | undefined {
  const m = COLLECTED_RE.exec(text);
  if (!m) return undefined;
  const g = m.groups!;
  let year: number;
  let month: number;
  let day: number;
  if (g.uy !== undefined) [year, month, day] = [Number(g.uy), Number(g.um), Number(g.ud)];
  else if (g.iy !== undefined) [year, month, day] = [Number(g.iy), Number(g.im), Number(g.id)];
  else [year, month, day] = [Number(g.my), MONTHS.indexOf(g.mn!.toLowerCase()) + 1, Number(g.md)];
  if (year < 100) year += 2000;
  const timeFound = g.h !== undefined;
  let hour = timeFound ? Number(g.h) : 0;
  const minute = g.mi !== undefined ? Number(g.mi) : 0;
  const ampm = g.ap?.replace(/\./g, '').toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined;

  const zone = ZONE_AT_END.exec(m[0])?.[1]?.toUpperCase();
  let t: number;
  if (zone && zone in ZONE_OFFSETS) t = Date.UTC(year, month - 1, day, hour, minute) - ZONE_OFFSETS[zone]! * 3_600_000;
  else if (zone && zone in ZONE_IANA) t = zonedToUtc(year, month - 1, day, hour, minute, ZONE_IANA[zone]!);
  else if (zone === 'UTC' || zone === 'GMT' || (tz === 'utc' && timeFound && zone !== 'LOCAL')) t = Date.UTC(year, month - 1, day, hour, minute);
  else t = new Date(year, month - 1, day, hour, minute).getTime();
  // Rejects impossible dates (04/31) that Date would roll over.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(t) || check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return undefined;
  return { iso: new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z'), timeFound, match: m[0] };
}

// ---------- patient ----------

function titleCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

// `\s` not `\s+` before the labels: two or more spaces already stop at `\s{2,}`.
const NAME_STOP = /\s{2,}|\s(?:DOB|D\.O\.B|Date of Birth|Birth ?Date|Sex|Gender|Age|ID|MRN|Phone|Acct|Account)\b|$/i;

function parseDate(m: string): string | undefined {
  const us = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(m);
  if (us) return `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(m);
  if (iso) return iso[0];
  const named = new RegExp(String.raw`^(${MONTHS.join('|')})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$`, 'i').exec(m);
  if (!named) return undefined;
  const month = MONTHS.indexOf(named[1]!.toLowerCase()) + 1;
  return `${named[3]}-${String(month).padStart(2, '0')}-${named[2]!.padStart(2, '0')}`;
}

type LineLike = { page: number; y: number; h: number; text: string; items: { str: string; x: number }[] };

/**
 * Boxed headers (Labcorp's older report form) print a row of labels and the values on
 * the line below: "Date and Time Collected  Date Entered" / "11/28/16 00:00  11/29/16".
 * Returns the text under `label`: the next line's items whose nearest label is this one.
 */
export function valueBelow(lines: readonly LineLike[], idx: number, label: { x: number }): string | undefined {
  const line = lines[idx]!;
  const next = lines[idx + 1];
  if (!next || next.page !== line.page || next.y - line.y > 2.5 * line.h) return undefined;
  const nearest = (x: number) => line.items.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
  const text = next.items
    .filter((it) => nearest(it.x) === label)
    .map((it) => it.str.trim())
    .join(' ')
    .trim();
  return text || undefined;
}

/** "01/11/90" in a boxed header: a two-digit birth year is in the past century unless that would be in the future. */
function parseShortDob(s: string): string | undefined {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s);
  if (!m) return undefined;
  const yy = Number(m[3]);
  const year = yy <= new Date().getUTCFullYear() % 100 ? 2000 + yy : 1900 + yy;
  return `${year}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
}

/** Patient fields from a boxed header (labels above values). */
function boxedPatient(lines: readonly LineLike[]): ParsedReport['patient'] {
  const field: Record<'last' | 'first' | 'middle' | 'dob' | 'sex', string | undefined> = { last: undefined, first: undefined, middle: undefined, dob: undefined, sex: undefined };
  const LABELS: [keyof typeof field, RegExp][] = [
    ['last', /^patient last name$/i],
    ['first', /^patient first name$/i],
    ['middle', /^patient middle name$/i],
    ['dob', /^date of birth$/i],
    ['sex', /^sex$/i],
  ];
  lines.forEach((line, idx) => {
    for (const it of line.items) {
      const key = LABELS.find(([, re]) => re.test(it.str.trim()))?.[0];
      if (key && field[key] === undefined) field[key] = valueBelow(lines, idx, it);
    }
  });
  const out: ParsedReport['patient'] = {};
  if (field.last && field.first && NAME_PART.test(field.last) && NAME_PART.test(field.first)) {
    out.family = titleCase(field.last);
    out.given = splitGiven(field.middle && NAME_PART.test(field.middle) ? `${field.first} ${field.middle}` : field.first);
  }
  const dob = field.dob && (parseDate(field.dob) ?? parseShortDob(field.dob));
  if (dob) out.birthDate = dob;
  if (field.sex && /^(m|male|f|female)$/i.test(field.sex)) out.gender = /^m/i.test(field.sex) ? 'male' : 'female';
  return out;
}

const NAME_PART = /^[\p{L}'’\-.]+(?: [\p{L}'’\-.]+)*$/u;
// Given names start after the spaces `\s*` took, so the two can't trade spaces.
const COMMA_NAME = /^([\p{L}'’\- ]+),\s*([\p{L}'’\-.][\p{L}'’\-. ]*)$/u;

type Name = { family: string; given: string[] };
const splitGiven = (s: string) => s.replace(/\./g, '').trim().split(/\s+/).map(titleCase);

/**
 * Names printed with no "Name:" field. Quest prints "FAMILY, GIVEN" under a
 * "Patient Information" label; Health Gorilla prints the given name(s) on one
 * line and the family name on the next. Labcorp prints "FAMILY, GIVEN" first on
 * the "DOB:" line of every page's header, and again under "Patient Details".
 */
function blockNames(lines: LineLike[]): { comma: Name[]; twoLine: Name[] } {
  const comma: Name[] = [];
  const twoLine: Name[] = [];
  lines.forEach((line, i) => {
    const dob = line.items.findIndex((it) => /^(DOB|D\.O\.B\.?|Date of Birth)\s*:/i.test(it.str.trim()));
    const lead = dob > 0 ? COMMA_NAME.exec(line.items[0]!.str.trim()) : null;
    if (lead) comma.push({ family: titleCase(lead[1]!), given: splitGiven(lead[2]!) });
    const label = line.items.find((it) => /^patient\s+(information|details):?$/i.test(it.str.trim()));
    if (!label) return;
    const below: string[] = [];
    for (const next of lines.slice(i + 1, i + 8)) {
      if (next.page !== line.page || next.y - line.y > 8 * line.h) break;
      const it = next.items.find((x) => Math.abs(x.x - label.x) <= 1.5 * line.h);
      if (!it) continue;
      const text = it.str.trim();
      if (/:/.test(text) || /\d/.test(text)) break; // next labelled field (DOB:, Phone:, ...)
      below.push(text);
    }
    const first = below[0];
    const m = first && COMMA_NAME.exec(first);
    if (m) comma.push({ family: titleCase(m[1]!), given: splitGiven(m[2]!) });
    else if (below.length >= 2 && NAME_PART.test(below[0]!) && NAME_PART.test(below[1]!) && !/\s/.test(below[1]!)) {
      twoLine.push({ family: titleCase(below[1]!), given: splitGiven(below[0]!) });
    }
  });
  return { comma, twoLine };
}

const sameName = (a: Name, b: Name) => a.family.toLowerCase() === b.family.toLowerCase() && a.given[0]?.toLowerCase() === b.given[0]?.toLowerCase();

const DOB_RE = new RegExp(String.raw`\b(?:DOB|D\.O\.B\.?|Date of Birth|Birth ?Date)\s*(?::\s*)?(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|(?:${MONTHS.join('|')})[a-z]*\.?\s+\d{1,2},?\s+\d{4})`, 'i');

/** Patient name, DOB and sex from the report's header block. */
export function extractPatient(lines: LineLike[]): ParsedReport['patient'] {
  const out: ParsedReport['patient'] = {};
  for (const { text: line } of lines) {
    if (!out.family) {
      const m = /\b(?:patient(?:\s+name)?|name)\s*:\s*(\S.*)$/i.exec(line);
      if (m) {
        const nameText = m[1]!.split(NAME_STOP)[0]!.trim();
        const comma = COMMA_NAME.exec(nameText);
        const plain = /^([\p{L}'’\-.]+(?: [\p{L}'’\-.]+)*) ([\p{L}'’\-]+)$/u.exec(nameText);
        if (comma) {
          out.family = titleCase(comma[1]!);
          out.given = splitGiven(comma[2]!);
        } else if (plain) {
          out.family = titleCase(plain[2]!);
          out.given = splitGiven(plain[1]!);
        }
      }
    }
    if (!out.birthDate) {
      const m = DOB_RE.exec(line);
      const d = m && parseDate(m[1]!);
      if (d) out.birthDate = d;
    }
    if (!out.gender) {
      const m = /\b(?:Sex|Gender)\s*(?:\/\s*\w+\s*)?(?::\s*)?(Male|Female|M|F)\b/i.exec(line);
      if (m) out.gender = /^m/i.test(m[1]!) ? 'male' : 'female';
    }
  }
  if (!out.family) {
    const { comma, twoLine } = blockNames(lines);
    const all = [...comma, ...twoLine];
    // Every form found must agree; otherwise leave the name out rather than guess.
    const pick = comma[0] ?? twoLine[0];
    if (pick && all.every((n) => sameName(n, pick))) {
      out.family = pick.family;
      out.given = pick.given;
    }
  }
  if (!out.family || !out.birthDate || !out.gender) {
    const boxed = boxedPatient(lines);
    if (!out.family && boxed.family) {
      out.family = boxed.family;
      out.given = boxed.given;
    }
    if (!out.birthDate && boxed.birthDate) out.birthDate = boxed.birthDate;
    if (!out.gender && boxed.gender) out.gender = boxed.gender;
  }
  return out;
}
