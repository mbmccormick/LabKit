// Server-side card rules (SPEC §7.2), shared with the client so the review
// screen can fail early. Error messages must never echo patient data or
// result values: they name the rule and the JSON path only.
import { z } from 'zod';
import type { Dictionary } from './dictionary';
import {
  buildPayload,
  CATEGORY_SYSTEM,
  LOINC_SYSTEM,
  nbfFor,
  SHC_TYPES,
  SNOMED_SYSTEM,
  UCUM_SYSTEM,
  type JsonObject,
} from './fhir';
import type { CardInput, Comparator, ObservationInput, PatientInput } from './types';

export const LIMITS = {
  maxBodyBytes: 512 * 1024,
  maxCards: 12,
  maxObservationsPerCard: 400,
} as const;

export const EARLIEST_EFFECTIVE = Date.parse('1990-01-01T00:00:00Z');

const EFFECTIVE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TITER_RE = /^1:\d+$/;
const IMMUNIZATION_RESOURCE_RE = /^immunization/i;
const IMMUNIZATION_TYPE_RE = /#(immunization|covid19)/i;

const shortText = z.string().min(1).max(100);

// ---------- schemas ----------

const codingLab = z.strictObject({
  system: z.literal(CATEGORY_SYSTEM),
  code: z.literal('laboratory'),
  display: z.literal('Laboratory'),
});

const quantityRef = z.strictObject({ value: z.number(), unit: z.string() });

export const observationSchema = z.strictObject({
  resourceType: z.literal('Observation'),
  status: z.literal('final'),
  category: z.tuple([z.strictObject({ coding: z.tuple([codingLab]) })]),
  code: z.strictObject({
    coding: z.tuple([z.strictObject({ system: z.literal(LOINC_SYSTEM), code: z.string().max(20), display: z.string().max(300) })]),
    text: z.string().max(200),
  }),
  subject: z.strictObject({ reference: z.literal('resource:0') }),
  effectiveDateTime: z.string().regex(EFFECTIVE_RE, 'must be ISO 8601 UTC (YYYY-MM-DDThh:mm:ssZ)'),
  valueQuantity: z
    .strictObject({
      value: z.number(),
      unit: z.string().max(40),
      system: z.literal(UCUM_SYSTEM),
      code: z.string().max(40),
      comparator: z.enum(['<', '<=', '>', '>=']).optional(),
    })
    .optional(),
  valueCodeableConcept: z
    .strictObject({
      coding: z.tuple([z.strictObject({ system: z.literal(SNOMED_SYSTEM), code: z.string(), display: z.string() })]).optional(),
      text: z.string().min(1).max(64),
    })
    .optional(),
  referenceRange: z
    .array(z.strictObject({ low: quantityRef.optional(), high: quantityRef.optional() }))
    .max(1, 'at most one referenceRange element')
    .optional(),
});

export const patientSchema = z.strictObject({
  resourceType: z.literal('Patient'),
  name: z.tuple([z.strictObject({ family: shortText, given: z.array(shortText).min(1).max(5) })]),
  birthDate: z.string().regex(DATE_RE, 'must be YYYY-MM-DD'),
  gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
});

const entrySchema = z.strictObject({ fullUrl: z.string(), resource: z.record(z.string(), z.unknown()) });

export const payloadSchema = z.strictObject({
  iss: z.string(),
  nbf: z.number(),
  vc: z.strictObject({
    type: z.array(z.string()),
    credentialSubject: z.strictObject({
      fhirVersion: z.literal('4.0.1'),
      fhirBundle: z.strictObject({
        resourceType: z.literal('Bundle'),
        type: z.literal('collection'),
        entry: z.array(entrySchema).min(2, 'a card needs a Patient and at least one Observation'),
      }),
    }),
  }),
});

export const signRequestSchema = z.strictObject({
  turnstileToken: z.string().min(1).max(4096),
  cards: z.array(z.strictObject({ payload: z.unknown() })).min(1),
});

// ---------- results ----------

export type CardError = { path: string; message: string };
export type CardValidation = { ok: true; card: CardInput; payload: JsonObject } | { ok: false; error: CardError };

export type ValidationContext = {
  dictionary: Dictionary;
  issuer: string;
  now?: Date;
};

function fmtPath(parts: readonly PropertyKey[]): string {
  let out = '';
  for (const p of parts) {
    if (typeof p === 'number') out += `[${p}]`;
    else out += out ? `.${String(p)}` : String(p);
  }
  return out;
}

function join(base: string, rel: string): string {
  if (!rel) return base;
  if (!base) return rel;
  return rel.startsWith('[') ? base + rel : `${base}.${rel}`;
}

/** Describe a zod issue without echoing the received value. */
function describeIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'unrecognized_keys':
      return `unknown key(s) not allowed: ${issue.keys.join(', ')}`;
    case 'invalid_type':
      return `expected ${issue.expected}`;
    case 'invalid_value':
      return `must be ${issue.values.map((v) => JSON.stringify(v)).join(' or ')}`;
    case 'too_small':
      return issue.message && !issue.message.startsWith('Too small') ? issue.message : `too small (minimum ${String(issue.minimum)})`;
    case 'too_big':
      return issue.message && !issue.message.startsWith('Too big') ? issue.message : `too large (maximum ${String(issue.maximum)})`;
    case 'invalid_format':
      return issue.message && !issue.message.startsWith('Invalid') ? issue.message : 'invalid format';
    default:
      return 'invalid';
  }
}

function zodError(err: z.ZodError, base: string): CardValidation {
  const issue = err.issues[0]!;
  return { ok: false, error: { path: join(base, fmtPath(issue.path)), message: describeIssue(issue) } };
}

function fail(path: string, message: string): CardValidation {
  return { ok: false, error: { path, message } };
}

/** SPEC §7.2 rule 11. Checked before anything else so the error is explicit. */
export function findImmunization(payload: unknown): string | undefined {
  const walk = (v: unknown, path: string): string | undefined => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const hit = walk(v[i], `${path}[${i}]`);
        if (hit) return hit;
      }
    } else if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        const p = path ? `${path}.${k}` : k;
        if (k === 'resourceType' && typeof child === 'string' && IMMUNIZATION_RESOURCE_RE.test(child)) return p;
        const hit = walk(child, p);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  const vcType = (payload as { vc?: { type?: unknown } } | null)?.vc?.type;
  if (Array.isArray(vcType)) {
    const i = vcType.findIndex((t) => typeof t === 'string' && IMMUNIZATION_TYPE_RE.test(t));
    if (i >= 0) return `vc.type[${i}]`;
  }
  return walk(payload, '');
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Deep equality ignoring object key order (array order matters). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(b)) {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameJson((a as Record<string, Json>)[k], (b as Record<string, Json>)[k]));
  }
  return false;
}

/**
 * Validate one card payload against every rule in SPEC §7.2. On success,
 * returns the card rebuilt through the shared builder (canonical key order,
 * nbf set from effectiveDateTime per rule 9) ready to sign.
 */
export function validateCardPayload(input: unknown, ctx: ValidationContext): CardValidation {
  const now = (ctx.now ?? new Date()).getTime();

  const imm = findImmunization(input);
  if (imm !== undefined) return fail(imm, 'immunization records are not supported; LabKit signs lab results only');

  const top = payloadSchema.safeParse(input);
  if (!top.success) return zodError(top.error, '');
  const p = top.data;

  // rule 1
  if (p.iss !== ctx.issuer) return fail('iss', `must equal ${ctx.issuer}`);
  if (p.vc.type.length !== SHC_TYPES.length || p.vc.type.some((t, i) => t !== SHC_TYPES[i])) {
    return fail('vc.type', `must be exactly ${JSON.stringify(SHC_TYPES)}`);
  }

  const entries = p.vc.credentialSubject.fhirBundle.entry;
  const entryBase = 'vc.credentialSubject.fhirBundle.entry';

  // rule 3
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.fullUrl !== `resource:${i}`) return fail(`${entryBase}[${i}].fullUrl`, `must be "resource:${i}"`);
  }
  const patientParse = patientSchema.safeParse(entries[0]!.resource);
  if (!patientParse.success) return zodError(patientParse.error, `${entryBase}[0].resource`);
  const pt = patientParse.data;
  if (Date.parse(`${pt.birthDate}T00:00:00Z`) > now || Number.isNaN(Date.parse(`${pt.birthDate}T00:00:00Z`))) {
    return fail(`${entryBase}[0].resource.birthDate`, 'must be a valid past date');
  }
  const patient: PatientInput = { family: pt.name[0].family, given: pt.name[0].given, birthDate: pt.birthDate };
  if (pt.gender) patient.gender = pt.gender;

  if (entries.length - 1 > LIMITS.maxObservationsPerCard) return fail(entryBase, 'too many observations');

  const results: ObservationInput[] = [];
  const seen = new Set<string>();
  let effective: string | undefined;

  for (let i = 1; i < entries.length; i++) {
    const base = `${entryBase}[${i}].resource`;
    const res = entries[i]!.resource;
    if (res.resourceType !== 'Observation') return fail(`${base}.resourceType`, 'must be "Observation"');
    const parsed = observationSchema.safeParse(res);
    if (!parsed.success) return zodError(parsed.error, base);
    const o = parsed.data;

    // rule 5
    const coding = o.code.coding[0];
    const entry = ctx.dictionary.byLoinc.get(coding.code);
    if (!entry) return fail(`${base}.code.coding[0].code`, 'LOINC code is not in the LabKit dictionary');
    if (entry.excludeFromSigning) return fail(`${base}.code.coding[0].code`, 'this test cannot be signed');
    if (coding.display !== entry.display) return fail(`${base}.code.coding[0].display`, 'must equal the dictionary display name');
    if (o.code.text !== entry.text) return fail(`${base}.code.text`, 'must equal the dictionary label');

    // rule 10
    if (seen.has(entry.loinc)) return fail(`${base}.code.coding[0].code`, 'duplicate LOINC code in card');
    seen.add(entry.loinc);

    // rule 8
    if (effective === undefined) {
      effective = o.effectiveDateTime;
      const t = Date.parse(effective);
      if (Number.isNaN(t)) return fail(`${base}.effectiveDateTime`, 'invalid date');
      if (t > now) return fail(`${base}.effectiveDateTime`, 'must not be in the future');
      if (t < EARLIEST_EFFECTIVE) return fail(`${base}.effectiveDateTime`, 'must not be before 1990-01-01');
    } else if (o.effectiveDateTime !== effective) {
      return fail(`${base}.effectiveDateTime`, 'all observations in a card must share one effectiveDateTime');
    }

    // rule 6
    if ((o.valueQuantity === undefined) === (o.valueCodeableConcept === undefined)) {
      return fail(base, 'exactly one of valueQuantity or valueCodeableConcept is required');
    }
    const common = { loinc: entry.loinc, display: entry.display, text: entry.text };
    if (entry.valueType === 'quantity') {
      const q = o.valueQuantity;
      if (!q) return fail(`${base}.valueQuantity`, 'this test requires valueQuantity');
      if (q.unit !== entry.ucum || q.code !== entry.ucum) return fail(`${base}.valueQuantity.code`, `unit must be ${String(entry.ucum)}`);
      // rule 7
      const rr = o.referenceRange?.[0];
      if (rr) {
        if (!rr.low && !rr.high) return fail(`${base}.referenceRange[0]`, 'must have low or high');
        for (const side of ['low', 'high'] as const) {
          const v = rr[side];
          if (v && v.unit !== q.unit) return fail(`${base}.referenceRange[0].${side}.unit`, 'must match the value unit');
        }
      }
      const r: ObservationInput = { ...common, kind: 'quantity', value: q.value, unit: q.unit };
      if (q.comparator) r.comparator = q.comparator as Comparator;
      if (rr?.low) r.low = rr.low.value;
      if (rr?.high) r.high = rr.high.value;
      results.push(r);
    } else {
      const cc = o.valueCodeableConcept;
      if (!cc) return fail(`${base}.valueCodeableConcept`, 'this test requires valueCodeableConcept');
      if (o.referenceRange) return fail(`${base}.referenceRange`, 'not allowed for non-numeric results');
      if (entry.valueType === 'titer') {
        if (!TITER_RE.test(cc.text)) return fail(`${base}.valueCodeableConcept.text`, 'titer must look like 1:N');
        results.push({ ...common, kind: 'titer', value: cc.text.slice(2) });
      } else {
        if (entry.answers && !entry.answers.includes(cc.text)) {
          return fail(`${base}.valueCodeableConcept.text`, `must be one of ${entry.answers.join(', ')}`);
        }
        results.push({ ...common, kind: 'qualitative', value: cc.text });
      }
    }

    // Everything else (e.g. SNOMED coding presence) must be exactly what the
    // shared builder emits for this result.
  }

  const card: CardInput = { issuer: ctx.issuer, nbf: nbfFor(effective!), patient, effectiveDateTime: effective!, results };
  const rebuilt = buildPayload(card);

  const inEntries = entries;
  const outEntries = (rebuilt.vc as { credentialSubject: { fhirBundle: { entry: { resource: unknown }[] } } }).credentialSubject.fhirBundle.entry;
  for (let i = 0; i < inEntries.length; i++) {
    if (!sameJson(inEntries[i]!.resource, outEntries[i]!.resource)) {
      return fail(`${entryBase}[${i}].resource`, 'does not match the canonical card format');
    }
  }
  return { ok: true, card, payload: rebuilt };
}

export function countObservations(payload: unknown): number {
  const entry = (payload as { vc?: { credentialSubject?: { fhirBundle?: { entry?: unknown } } } } | null)?.vc?.credentialSubject?.fhirBundle?.entry;
  return Array.isArray(entry) ? Math.max(0, entry.length - 1) : 0;
}
