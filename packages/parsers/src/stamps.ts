import type { ParsedReport } from '@labkit/core';

export type Stamp = { iso: string; timeFound: boolean; match: string };

const COLLECTED_RE =
  /\b(?:collected|collection(?: date)?(?:\s*\/\s*time)?|date collected|specimen collected|date of collection|drawn)\s*(?:(?:on|at|date)\s*)?(?::\s*)?(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)(?:[\s,T]+(\d{1,2}):?(\d{2})(?::\d{2})?\s*([AP]\.?M\.?)?)?(?:\s*(?:local|utc|gmt|[ECMP][SD]T))?/i;

/** "Collected: 04/17/2026 01:40 PM" → ISO UTC. tz says how to read the wall-clock time. */
export function parseStampText(text: string, tz: 'utc' | 'local'): Stamp | undefined {
  const m = COLLECTED_RE.exec(text);
  if (!m) return undefined;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  let hour = m[4] !== undefined ? Number(m[4]) : 0;
  const minute = m[5] !== undefined ? Number(m[5]) : 0;
  const ampm = m[6]?.replace(/\./g, '').toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined;
  // An explicit zone on the stamp wins over the template's assumption.
  if (/\b(utc|gmt)\b/i.test(m[0])) tz = 'utc';
  const d = tz === 'utc' ? new Date(Date.UTC(year, month - 1, day, hour, minute)) : new Date(year, month - 1, day, hour, minute);
  if (Number.isNaN(d.getTime()) || (tz === 'utc' ? d.getUTCDate() : d.getDate()) !== day) return undefined;
  return { iso: d.toISOString().replace(/\.\d{3}Z$/, 'Z'), timeFound: m[4] !== undefined, match: m[0] };
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
  return iso ? iso[0] : undefined;
}

type LineLike = { page: number; y: number; h: number; text: string; items: { str: string; x: number }[] };

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
      const m = /\b(?:DOB|D\.O\.B\.?|Date of Birth|Birth ?Date)\s*(?::\s*)?(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i.exec(line);
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
  return out;
}
