// Parsed reports → review state → card payloads. Pure functions (unit tested).
//
// No typing anywhere: every value comes from the report. The user can only
// confirm or leave out rows (SPEC §12.5):
//   high            → included
//   medium / low    → pending until the user confirms or leaves it out
//   blocking issue  → left out and can't be included (implausible, unit
//                     mismatch, unreadable value, ambiguous test)
import {
  buildPayload,
  nbfFor,
  validateCardPayload,
  type CardInput,
  type Dictionary,
  type JsonObject,
  type ObservationInput,
  type ParsedRow,
  type PatientInput,
} from '@labkit/core';
import { isBlocking, type ExtractedReport } from '@labkit/parsers';

export type Decision = 'included' | 'pending' | 'excluded';
export type ReviewRow = { id: string; row: ParsedRow; decision: Decision; locked: boolean; reason?: string };
export type ReviewDraw = { id: string; collectedAt: string; timeFound: boolean; included: boolean; rows: ReviewRow[] };
export type ReviewModel = {
  patient?: PatientInput;
  patientProblem?: string;
  draws: ReviewDraw[];
  unmatched: { text: string; page: number; file: string }[];
  warnings: string[];
  files: { name: string; vendor: string; method: string }[];
};

export function blockReason(row: ParsedRow): string | undefined {
  if (!row.entry) return "We couldn't identify this test.";
  if (row.issues.includes('ambiguous_match')) return 'This name matches more than one test.';
  if (row.issues.includes('unit_mismatch')) return `The unit (${row.raw.unit ?? 'none'}) can't be used for this test.`;
  if (!row.value) return "We couldn't read this result.";
  if (row.issues.includes('implausible')) return 'This value is outside what is physiologically possible, so it was probably misread.';
  return undefined;
}

function samePerson(a: ExtractedReport['patient'], b: ExtractedReport['patient']): boolean {
  const n = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (a.birthDate && b.birthDate && a.birthDate !== b.birthDate) return false;
  if (a.family && b.family && n(a.family) !== n(b.family)) return false;
  if (a.given?.[0] && b.given?.[0] && n(a.given[0]) !== n(b.given[0])) return false;
  return true;
}

export function buildReview(reports: ExtractedReport[]): ReviewModel {
  let id = 0;
  const model: ReviewModel = { draws: [], unmatched: [], warnings: [], files: [] };

  // Patient: must be the same person across files; fields fill in from any file.
  const p: ExtractedReport['patient'] = {};
  for (const r of reports) {
    if (!samePerson(p, r.patient)) model.patientProblem = "These files seem to belong to different people. Upload one person's reports at a time.";
    p.family ??= r.patient.family;
    if (!p.given?.length && r.patient.given?.length) p.given = r.patient.given;
    p.birthDate ??= r.patient.birthDate;
    p.gender ??= r.patient.gender;
  }
  if (!model.patientProblem) {
    if (p.family && p.given?.length && p.birthDate) {
      model.patient = { family: p.family, given: p.given, birthDate: p.birthDate, ...(p.gender ? { gender: p.gender } : {}) };
    } else {
      const missing = [!p.family || !p.given?.length ? 'name' : '', !p.birthDate ? 'date of birth' : ''].filter(Boolean).join(' and ');
      model.patientProblem = `We couldn't find the patient's ${missing} in the report, so a card can't be created from it.`;
    }
  }

  const draws = new Map<string, ReviewDraw>();
  for (const r of reports) {
    model.files.push({ name: r.source.fileName, vendor: r.source.vendor, method: r.source.method });
    model.warnings.push(...r.warnings.map((w) => `${r.source.fileName}: ${w}`));
    model.unmatched.push(...r.unmatched.map((u) => ({ ...u, file: r.source.fileName })));
    for (const d of r.draws) {
      const draw = draws.get(d.collectedAt) ?? { id: `d${++id}`, collectedAt: d.collectedAt, timeFound: d.timeFound, included: true, rows: [] };
      for (const row of d.rows) draw.rows.push({ id: `r${++id}`, row, decision: 'included', locked: false });
      draws.set(d.collectedAt, draw);
    }
  }

  for (const draw of draws.values()) {
    // Re-flag duplicates: the same test can also come from two uploaded files.
    const counts = new Map<string, number>();
    for (const r of draw.rows) counts.set(r.row.entry!.loinc, (counts.get(r.row.entry!.loinc) ?? 0) + 1);
    for (const r of draw.rows) {
      if ((counts.get(r.row.entry!.loinc) ?? 0) > 1 && !r.row.issues.includes('duplicate')) {
        r.row = { ...r.row, issues: [...r.row.issues, 'duplicate'], confidence: 'low' };
      }
      const reason = blockReason(r.row);
      if (reason || isBlocking(r.row)) {
        r.decision = 'excluded';
        r.locked = true;
        r.reason = reason ?? "This result can't be signed.";
      } else {
        r.decision = r.row.confidence === 'high' ? 'included' : 'pending';
      }
    }
    model.draws.push(draw);
  }
  model.draws.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  return model;
}

export function setDecision(model: ReviewModel, rowId: string, decision: 'included' | 'excluded'): ReviewModel {
  return {
    ...model,
    draws: model.draws.map((d) => ({ ...d, rows: d.rows.map((r) => (r.id === rowId && !r.locked ? { ...r, decision } : r)) })),
  };
}

export function setDrawIncluded(model: ReviewModel, drawId: string, included: boolean): ReviewModel {
  return { ...model, draws: model.draws.map((d) => (d.id === drawId ? { ...d, included } : d)) };
}

/** Why the Create button is disabled, or undefined when ready. */
export function readiness(model: ReviewModel): { ready: boolean; problems: string[] } {
  const problems: string[] = [];
  if (model.patientProblem) problems.push(model.patientProblem);
  const active = model.draws.filter((d) => d.included);
  const pending = active.reduce((n, d) => n + d.rows.filter((r) => r.decision === 'pending').length, 0);
  if (pending) problems.push(`${pending} result${pending === 1 ? '' : 's'} still need${pending === 1 ? 's' : ''} review.`);
  for (const d of active) {
    const t = Date.parse(d.collectedAt);
    if (t > Date.now() || t < Date.parse('1990-01-01T00:00:00Z')) problems.push('A collection date in this report looks wrong. Leave that collection out.');
    const seen = new Set<string>();
    for (const r of d.rows.filter((x) => x.decision === 'included')) {
      if (seen.has(r.row.entry!.loinc)) {
        problems.push(`${r.row.entry!.text} appears twice in one collection. Leave one out.`);
        break;
      }
      seen.add(r.row.entry!.loinc);
    }
  }
  const cards = active.filter((d) => d.rows.some((r) => r.decision === 'included'));
  if (!cards.length && !pending) problems.push('There are no results to add.');
  if (cards.length > 12) problems.push('At most 12 collections can be signed at once. Leave some out.');
  return { ready: problems.length === 0, problems };
}

export function toObservation(row: ParsedRow): ObservationInput {
  const e = row.entry!;
  const base = { loinc: e.loinc, display: e.display, text: e.text };
  const v = row.value!;
  if (v.kind === 'quantity') {
    const o: ObservationInput = { ...base, kind: 'quantity', value: v.value, unit: v.ucum };
    if (v.comparator) o.comparator = v.comparator;
    if (row.range?.low !== undefined) o.low = row.range.low;
    if (row.range?.high !== undefined) o.high = row.range.high;
    return o;
  }
  if (v.kind === 'titer') return { ...base, kind: 'titer', value: v.text.replace(/^1:/, '') };
  return { ...base, kind: 'qualitative', value: v.text };
}

export type CardDraft = { draw: ReviewDraw; card: CardInput; payload: JsonObject };

export function buildCards(model: ReviewModel, dictionary: Dictionary, issuer: string, now = new Date()): CardDraft[] {
  if (!model.patient) throw new Error(model.patientProblem ?? 'No patient');
  const out: CardDraft[] = [];
  for (const draw of model.draws.filter((d) => d.included)) {
    const rows = draw.rows.filter((r) => r.decision === 'included');
    if (!rows.length) continue;
    const card: CardInput = { issuer, nbf: nbfFor(draw.collectedAt), patient: model.patient, effectiveDateTime: draw.collectedAt, results: rows.map((r) => toObservation(r.row)) };
    const check = validateCardPayload(buildPayload(card), { dictionary, issuer, now });
    if (!check.ok) throw new Error(`A card would be rejected (${check.error.path}: ${check.error.message}).`);
    out.push({ draw, card, payload: check.payload });
  }
  return out;
}

export const localDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
