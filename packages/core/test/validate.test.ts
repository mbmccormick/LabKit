import { describe, expect, it } from 'vitest';
import { buildPayload } from '../src/fhir';
import { findImmunization, validateCardPayload, type CardValidation } from '../src/validate';
import { dictionary, referencePayload, REF_EFFECTIVE, REF_ISSUER, REF_PATIENT } from './helpers';

const NOW = new Date('2026-09-23T00:00:00Z');
const ctx = { dictionary, issuer: REF_ISSUER, now: NOW };

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const obs = (p: Any, i: number) => p.vc.credentialSubject.fhirBundle.entry[i].resource;
const mutate = (fn: (p: Any) => void) => {
  const p = structuredClone(referencePayload()) as Any;
  fn(p);
  return validateCardPayload(p, ctx);
};
const errorOf = (r: CardValidation) => {
  expect(r.ok).toBe(false);
  return r.ok ? undefined : r.error;
};
const E = 'vc.credentialSubject.fhirBundle.entry';

describe('validateCardPayload (SPEC §7.2)', () => {
  it('accepts the reference payload and rebuilds it identically', () => {
    const r = validateCardPayload(referencePayload(), ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.payload)).toBe(JSON.stringify(referencePayload()));
  });

  it('canonicalizes key order and sets nbf from effectiveDateTime (rule 9)', () => {
    const p = referencePayload() as Any;
    const shuffled = { vc: p.vc, nbf: 0, iss: p.iss };
    const r = validateCardPayload(shuffled, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.payload)).toEqual(['iss', 'nbf', 'vc']);
      expect(r.payload.nbf).toBe(Math.floor(Date.parse(REF_EFFECTIVE) / 1000));
    }
  });

  // rule 1
  it('rejects a foreign issuer', () => {
    expect(errorOf(mutate((p) => (p.iss = 'https://labkit.health')))?.path).toBe('iss');
    expect(errorOf(mutate((p) => (p.iss = REF_ISSUER + '/')))?.path).toBe('iss');
  });
  it('rejects a wrong vc.type', () => {
    expect(errorOf(mutate((p) => p.vc.type.pop()))?.path).toBe('vc.type');
    expect(errorOf(mutate((p) => p.vc.type.reverse()))?.path).toBe('vc.type');
  });

  // rule 2
  it('rejects wrong fhirVersion and bundle type', () => {
    expect(errorOf(mutate((p) => (p.vc.credentialSubject.fhirVersion = '4.0.0')))?.path).toBe('vc.credentialSubject.fhirVersion');
    expect(errorOf(mutate((p) => (p.vc.credentialSubject.fhirBundle.type = 'batch')))?.path).toBe('vc.credentialSubject.fhirBundle.type');
  });

  // rule 3
  it('requires the Patient first with only name/birthDate/gender', () => {
    expect(errorOf(mutate((p) => (p.vc.credentialSubject.fhirBundle.entry[0].resource.telecom = [])))?.message).toMatch(/unknown key/);
    expect(errorOf(mutate((p) => (p.vc.credentialSubject.fhirBundle.entry[0].resource.name[0].prefix = ['Dr'])))?.path).toBe(`${E}[0].resource.name[0]`);
    const swapped = errorOf(
      mutate((p) => {
        const e = p.vc.credentialSubject.fhirBundle.entry;
        [e[0].resource, e[1].resource] = [e[1].resource, e[0].resource];
      }),
    );
    expect(swapped?.path).toMatch(new RegExp(`^${E.replace(/\./g, '\\.')}\\[0\\]`));
  });
  it('requires fullUrl resource:N in order', () => {
    expect(errorOf(mutate((p) => (p.vc.credentialSubject.fhirBundle.entry[2].fullUrl = 'resource:9')))?.path).toBe(`${E}[2].fullUrl`);
  });
  it('rejects non-Observation resources after the Patient', () => {
    expect(errorOf(mutate((p) => (obs(p, 1).resourceType = 'DiagnosticReport')))?.path).toBe(`${E}[1].resource.resourceType`);
  });

  // rule 4
  it('rejects id, meta, text and extensions anywhere', () => {
    expect(errorOf(mutate((p) => (obs(p, 1).id = 'x')))?.message).toMatch(/unknown key/);
    expect(errorOf(mutate((p) => (obs(p, 1).meta = {})))?.message).toMatch(/unknown key/);
    expect(errorOf(mutate((p) => (obs(p, 1).text = { status: 'generated' })))?.message).toMatch(/unknown key/);
    expect(errorOf(mutate((p) => (obs(p, 1).valueQuantity.extension = [])))?.path).toBe(`${E}[1].resource.valueQuantity`);
    expect(errorOf(mutate((p) => (p.vc.extra = 1)))?.path).toBe('vc');
    expect(errorOf(mutate((p) => (p.jti = 'x')))?.message).toMatch(/unknown key/);
  });

  // rule 5
  it('requires status final, the laboratory category and subject resource:0', () => {
    expect(errorOf(mutate((p) => (obs(p, 1).status = 'preliminary')))?.path).toBe(`${E}[1].resource.status`);
    expect(errorOf(mutate((p) => (obs(p, 1).category[0].coding[0].code = 'vital-signs')))?.path).toBe(`${E}[1].resource.category[0].coding[0].code`);
    expect(errorOf(mutate((p) => (obs(p, 1).subject.reference = 'resource:1')))?.path).toBe(`${E}[1].resource.subject.reference`);
  });
  it('requires a single LOINC coding present in the dictionary with exact labels', () => {
    expect(errorOf(mutate((p) => obs(p, 1).code.coding.push(obs(p, 1).code.coding[0])))?.path).toBe(`${E}[1].resource.code.coding`);
    expect(errorOf(mutate((p) => (obs(p, 1).code.coding[0].system = 'http://snomed.info/sct')))?.path).toBe(`${E}[1].resource.code.coding[0].system`);
    expect(errorOf(mutate((p) => (obs(p, 1).code.coding[0].code = '99999-9')))?.message).toMatch(/not in the LabKit dictionary/);
    expect(errorOf(mutate((p) => (obs(p, 1).code.coding[0].display = 'ApoB')))?.path).toBe(`${E}[1].resource.code.coding[0].display`);
    expect(errorOf(mutate((p) => (obs(p, 1).code.text = 'ApoB')))?.path).toBe(`${E}[1].resource.code.text`);
  });
  it('refuses entries marked excludeFromSigning', () => {
    const entry = dictionary.byLoinc.get('1884-6')!;
    entry.excludeFromSigning = true;
    try {
      expect(errorOf(validateCardPayload(referencePayload(), ctx))?.message).toMatch(/cannot be signed/);
    } finally {
      delete entry.excludeFromSigning;
    }
  });

  // rule 6
  it('checks the value type against the entry', () => {
    expect(errorOf(mutate((p) => (obs(p, 1).valueQuantity.unit = 'g/L')))?.path).toBe(`${E}[1].resource.valueQuantity.code`);
    expect(errorOf(mutate((p) => (obs(p, 1).valueQuantity.code = 'g/L')))?.path).toBe(`${E}[1].resource.valueQuantity.code`);
    expect(errorOf(mutate((p) => (obs(p, 1).valueQuantity.system = 'http://loinc.org')))?.path).toBe(`${E}[1].resource.valueQuantity.system`);
    expect(errorOf(mutate((p) => (obs(p, 1).valueQuantity.value = '88')))?.path).toBe(`${E}[1].resource.valueQuantity.value`);
    expect(errorOf(mutate((p) => (obs(p, 2).valueQuantity.comparator = '~')))?.path).toBe(`${E}[2].resource.valueQuantity.comparator`);
    expect(
      errorOf(
        mutate((p) => {
          delete obs(p, 1).valueQuantity;
          delete obs(p, 1).referenceRange;
          obs(p, 1).valueCodeableConcept = { text: 'High' };
        }),
      )?.path,
    ).toBe(`${E}[1].resource.valueQuantity`);
    expect(errorOf(mutate((p) => (obs(p, 4).valueCodeableConcept = { text: 'Maybe' })))?.message).toMatch(/must be one of/);
    expect(errorOf(mutate((p) => (obs(p, 6).valueCodeableConcept.text = '40')))?.message).toMatch(/1:N/);
    expect(errorOf(mutate((p) => (obs(p, 4).valueQuantity = obs(p, 1).valueQuantity)))?.message).toMatch(/exactly one/);
  });
  it('requires the SNOMED coding exactly as the builder emits it', () => {
    expect(errorOf(mutate((p) => delete obs(p, 4).valueCodeableConcept.coding))?.message).toMatch(/canonical card format/);
    expect(errorOf(mutate((p) => (obs(p, 4).valueCodeableConcept.coding[0].code = '10828004')))?.message).toMatch(/canonical/);
  });

  // rule 7
  it('limits referenceRange to one element with matching units', () => {
    expect(errorOf(mutate((p) => obs(p, 1).referenceRange.push({ low: { value: 1, unit: 'mg/dL' } })))?.path).toBe(`${E}[1].resource.referenceRange`);
    expect(errorOf(mutate((p) => (obs(p, 1).referenceRange[0].high.unit = 'g/L')))?.path).toBe(`${E}[1].resource.referenceRange[0].high.unit`);
    expect(errorOf(mutate((p) => (obs(p, 1).referenceRange[0] = {})))?.path).toBe(`${E}[1].resource.referenceRange[0]`);
    expect(errorOf(mutate((p) => (obs(p, 4).referenceRange = [{ high: { value: 1, unit: 'x' } }])))?.path).toBe(`${E}[4].resource.referenceRange`);
  });

  // rule 8
  it('requires one shared, valid, past effectiveDateTime after 1990', () => {
    expect(errorOf(mutate((p) => (obs(p, 3).effectiveDateTime = '2026-04-17T13:41:00Z')))?.message).toMatch(/share one/);
    expect(errorOf(mutate((p) => (obs(p, 1).effectiveDateTime = '2026-04-17T13:40:00-05:00')))?.path).toBe(`${E}[1].resource.effectiveDateTime`);
    const at = (iso: string) =>
      mutate((p) => {
        for (const e of p.vc.credentialSubject.fhirBundle.entry.slice(1)) e.resource.effectiveDateTime = iso;
      });
    expect(errorOf(at('2026-09-24T00:00:00Z'))?.message).toMatch(/future/);
    expect(errorOf(at('1989-12-31T23:59:59Z'))?.message).toMatch(/1990/);
    expect(at('1990-01-01T00:00:00Z').ok).toBe(true);
  });

  // rule 10
  it('rejects duplicate LOINC codes within a card', () => {
    const p = buildPayload({
      issuer: REF_ISSUER,
      nbf: 0,
      patient: REF_PATIENT,
      effectiveDateTime: REF_EFFECTIVE,
      results: [
        { loinc: '2093-3', display: 'Cholesterol [Mass/volume] in Serum or Plasma', text: 'Total Cholesterol', kind: 'quantity', value: 180, unit: 'mg/dL' },
        { loinc: '2093-3', display: 'Cholesterol [Mass/volume] in Serum or Plasma', text: 'Total Cholesterol', kind: 'quantity', value: 181, unit: 'mg/dL' },
      ],
    });
    // Make sure the display matches the dictionary so rule 10 is what trips.
    const entry = dictionary.byLoinc.get('2093-3')!;
    for (const e of (p as Any).vc.credentialSubject.fhirBundle.entry.slice(1)) {
      e.resource.code.coding[0].display = entry.display;
      e.resource.code.text = entry.text;
    }
    expect(errorOf(validateCardPayload(p, ctx))?.message).toMatch(/duplicate/);
  });

  // rule 11
  it('rejects immunization resources and types explicitly', () => {
    expect(errorOf(mutate((p) => (obs(p, 1).resourceType = 'Immunization')))?.message).toMatch(/immunization/);
    expect(errorOf(mutate((p) => (p.vc.type[1] = 'https://smarthealth.cards#immunization')))?.message).toMatch(/immunization/);
    expect(errorOf(mutate((p) => p.vc.type.push('https://smarthealth.cards#covid19')))?.path).toBe('vc.type[2]');
    expect(findImmunization({ a: [{ resourceType: 'ImmunizationRecommendation' }] })).toBe('a[0].resourceType');
  });

  it('never echoes values or names in error messages', () => {
    const r = mutate((p) => {
      p.vc.credentialSubject.fhirBundle.entry[0].resource.name[0].family = 12345;
      obs(p, 1).valueQuantity.value = 'SECRET-VALUE';
    });
    expect(JSON.stringify(r)).not.toMatch(/12345|SECRET-VALUE|Jordan|Doe/);
  });

  it('rejects empty bundles and non-objects', () => {
    expect(validateCardPayload(null, ctx).ok).toBe(false);
    expect(errorOf(mutate((p) => p.vc.credentialSubject.fhirBundle.entry.splice(1)))?.path).toBe('vc.credentialSubject.fhirBundle.entry');
  });
});
