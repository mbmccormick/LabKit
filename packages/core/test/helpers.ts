import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDictionary } from '../src/dictionary';
import { buildPayload } from '../src/fhir';
import { bufferSource } from '../src/shc';
import type { DictionaryFile, ObservationInput, PatientInput } from '../src/types';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const readJson = <T>(rel: string): T => JSON.parse(readFileSync(root + rel, 'utf8')) as T;

export const dictionaryFile = readJson<DictionaryFile>('dictionary/dictionary.json');
export const dictionary = loadDictionary(dictionaryFile);

// Synthetic data only: the reference encoder's __main__ inputs.
export const REF_ISSUER = 'https://staging.labkit.health';
export const REF_PATIENT: PatientInput = { family: 'Doe', given: ['Jordan'], birthDate: '1985-01-15', gender: 'male' };
export const REF_EFFECTIVE = '2026-04-17T13:40:00Z';
export const REF_NBF = 1776433200;
export const REF_RESULTS: ObservationInput[] = [
  { loinc: '1884-6', display: 'Apolipoprotein B [Mass/volume] in Serum or Plasma', text: 'Apolipoprotein B', kind: 'quantity', value: 88, unit: 'mg/dL', high: 90 },
  { loinc: '30522-7', display: 'C reactive protein [Mass/volume] in Serum or Plasma by High sensitivity method', text: 'hs-CRP', kind: 'quantity', value: 0.2, unit: 'mg/L', comparator: '<', high: 1 },
  { loinc: '751-8', display: 'Neutrophils [#/volume] in Blood by Automated count', text: 'Neutrophils', kind: 'quantity', value: 3.12, unit: '10*3/uL', low: 1.5, high: 7.8 },
  { loinc: '8061-4', display: 'Nuclear Ab [Presence] in Serum', text: 'ANA screen', kind: 'qualitative', value: 'Negative' },
  { loinc: '2514-8', display: 'Ketones [Presence] in Urine by Test strip', text: 'Urine ketones', kind: 'qualitative', value: '1+' },
  { loinc: '5048-4', display: 'Nuclear Ab [Titer] in Serum by Immunofluorescence', text: 'ANA titer', kind: 'titer', value: 40 },
];

export function referencePayload() {
  return buildPayload({ issuer: REF_ISSUER, nbf: REF_NBF, patient: REF_PATIENT, effectiveDateTime: REF_EFFECTIVE, results: REF_RESULTS });
}

export async function generateKey() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey & { x: string; y: string; d: string };
  return { pair, jwk };
}

export function webCryptoSigner(key: CryptoKey) {
  return {
    async sign(input: Uint8Array) {
      return new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bufferSource(input)));
    },
  };
}
