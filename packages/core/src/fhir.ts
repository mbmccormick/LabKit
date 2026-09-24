// FHIR builders. Key insertion order here IS the card format (SPEC §8) and must
// mirror reference/shc_reference.py exactly; the golden test enforces it.
import type { CardInput, ObservationInput, PatientInput } from './types';

export const SHC_TYPES = ['https://smarthealth.cards#health-card', 'https://smarthealth.cards#laboratory'] as const;
export const LOINC_SYSTEM = 'http://loinc.org';
export const UCUM_SYSTEM = 'http://unitsofmeasure.org';
export const SNOMED_SYSTEM = 'http://snomed.info/sct';
export const CATEGORY_SYSTEM = 'http://terminology.hl7.org/CodeSystem/observation-category';

export const LAB_CATEGORY = {
  coding: [{ system: CATEGORY_SYSTEM, code: 'laboratory', display: 'Laboratory' }],
} as const;

export const QUAL_CODES: Record<string, { code: string; display: string }> = {
  negative: { code: '260385009', display: 'Negative' },
  positive: { code: '10828004', display: 'Positive' },
};

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

function category(): JsonObject {
  // fresh copy so callers can never mutate the shared constant
  return { coding: [{ system: CATEGORY_SYSTEM, code: 'laboratory', display: 'Laboratory' }] };
}

export function buildObservation(r: ObservationInput, effective: string): JsonObject {
  const obs: JsonObject = {
    resourceType: 'Observation',
    status: 'final',
    category: [category()],
    code: { coding: [{ system: LOINC_SYSTEM, code: r.loinc, display: r.display }], text: r.text },
    subject: { reference: 'resource:0' },
    effectiveDateTime: effective,
  };
  if (r.kind === 'quantity') {
    const q: JsonObject = { value: r.value, unit: r.unit, system: UCUM_SYSTEM, code: r.unit };
    if (r.comparator) q.comparator = r.comparator;
    obs.valueQuantity = q;
    const rr: JsonObject = {};
    if (r.low !== undefined && r.low !== null) rr.low = { value: r.low, unit: r.unit };
    if (r.high !== undefined && r.high !== null) rr.high = { value: r.high, unit: r.unit };
    if (Object.keys(rr).length > 0) obs.referenceRange = [rr];
  } else if (r.kind === 'titer') {
    obs.valueCodeableConcept = { text: `1:${r.value}` };
  } else {
    const text = String(r.value);
    const qual = QUAL_CODES[text.trim().toLowerCase()];
    const cc: JsonObject = {};
    if (qual) cc.coding = [{ system: SNOMED_SYSTEM, code: qual.code, display: qual.display }];
    cc.text = text;
    obs.valueCodeableConcept = cc;
  }
  return obs;
}

export function buildPatient(p: PatientInput): JsonObject {
  const patient: JsonObject = {
    resourceType: 'Patient',
    name: [{ family: p.family, given: [...p.given] }],
    birthDate: p.birthDate,
  };
  if (p.gender) patient.gender = p.gender;
  return patient;
}

export function buildPayload(input: CardInput): JsonObject {
  const entries: JsonObject[] = [{ fullUrl: 'resource:0', resource: buildPatient(input.patient) }];
  for (const r of input.results) {
    entries.push({ fullUrl: `resource:${entries.length}`, resource: buildObservation(r, input.effectiveDateTime) });
  }
  return {
    iss: input.issuer,
    nbf: input.nbf,
    vc: {
      type: [...SHC_TYPES],
      credentialSubject: {
        fhirVersion: '4.0.1',
        fhirBundle: { resourceType: 'Bundle', type: 'collection', entry: entries },
      },
    },
  };
}

/** SPEC §7.2 rule 9: nbf is the collection time in whole seconds. */
export function nbfFor(effectiveDateTime: string): number {
  return Math.floor(Date.parse(effectiveDateTime) / 1000);
}

/** Format a Date as the card's effectiveDateTime (second precision, UTC, "Z"). */
export function toEffectiveDateTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
