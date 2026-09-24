// pnpm m0-cards — Milestone 0 issuer spike (SPEC §16).
//
// Signs a set of synthetic test cards with the STAGING key so the owner can
// record on an iPhone: Verified badge, source name/icon, redirect-link limits,
// trend merging, name/DOB mismatch behaviour and maximum payload size.
//
// The staging private JWK is read from stdin (paste it, then Enter) and is never
// written to disk. Production keys are refused. Output goes to out/m0/ (gitignored).
//
// Normal cards pass the same §7.2 validation the Worker applies. PROBE cards
// deliberately repeat LOINC codes (which the Worker would reject) because the
// dictionary only has 119 unique codes; they exist only to measure Apple Health's
// limits (~25k-character redirect URLs, 300/400 observations).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import {
  appleRedirectUrl,
  buildPayload,
  cardFileContents,
  jwkThumbprint,
  loadDictionary,
  nbfFor,
  signPayload,
  validateCardPayload,
  type DictionaryEntry,
  type DictionaryFile,
  type ObservationInput,
  type PatientInput,
  type PrivateJwk,
} from '@labkit/core';
import { WebCryptoSigner } from '../apps/worker/src/signer';
import { readPublicKeys, ROOT } from './lib';

const ISSUER = 'https://staging.labkit.health';
const OUT = `${ROOT}out/m0`;

async function readSecret(): Promise<string> {
  if (!process.stdin.isTTY) {
    let data = '';
    for await (const chunk of process.stdin) data += String(chunk);
    return data.trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question('Paste the STAGING private JWK (not stored), then press Enter:\n');
  rl.close();
  return answer.trim();
}
const secret = await readSecret();
const jwk = JSON.parse(secret) as PrivateJwk;
const kid = await jwkThumbprint(jwk);
if (!readPublicKeys('staging').some((k) => k.kid === kid && k.x === jwk.x && k.y === jwk.y)) {
  console.error(`That key (kid ${kid}) is not in keys/staging/. Refusing: M0 cards are signed with the staging key only.`);
  process.exit(1);
}
if (readPublicKeys('production').some((k) => k.kid === kid)) {
  console.error('That is a production key. Refusing.');
  process.exit(1);
}
const signer = await WebCryptoSigner.fromJwk(jwk);

const dictFile = JSON.parse(readFileSync(`${ROOT}dictionary/dictionary.json`, 'utf8')) as DictionaryFile;
const dictionary = loadDictionary(dictFile);
const signable = dictFile.entries.filter((e) => !e.excludeFromSigning);

function sample(e: DictionaryEntry, seed: number): ObservationInput {
  const base = { loinc: e.loinc, display: e.display, text: e.text };
  if (e.valueType === 'titer') return { ...base, kind: 'titer', value: 80 };
  if (e.valueType === 'qualitative') return { ...base, kind: 'qualitative', value: e.answers?.[0] ?? 'Clear' };
  const { min, max } = e.plausible!;
  const value = Number((min + ((max - min) * (((seed * 37) % 100) + 1)) / 1000).toPrecision(3));
  return { ...base, kind: 'quantity', value, unit: e.ucum!, low: min, high: Number((min + (max - min) / 5).toPrecision(3)) };
}

const JORDAN: PatientInput = { family: 'Doe', given: ['Jordan'], birthDate: '1985-01-15', gender: 'male' };
const MISMATCH: PatientInput = { family: 'Mismatch', given: ['Riley'], birthDate: '1970-07-07' };
const ref = (codes: string[]) => codes.map((c) => dictionary.byLoinc.get(c)!);

type Spec = { name: string; purpose: string; patient: PatientInput; effective: string; results: ObservationInput[]; probe?: boolean };
const specs: Spec[] = [
  {
    name: '01-reference',
    purpose: 'Reference card (SPEC §8 shape). Check: Verified badge, source name "labkit.health" + monogram, comparator display (<0.2), qualitative + titer display.',
    patient: JORDAN,
    effective: '2026-04-17T13:40:00Z',
    results: ref(['1884-6', '30522-7', '751-8', '8061-4', '2514-8', '5048-4']).map((e, i) => sample(e, i)),
  },
  {
    name: '02-trend-a',
    purpose: 'Trend merge, first draw: ApoB, LDL-C, HbA1c. Import with 03 and check they chart as one trend each.',
    patient: JORDAN,
    effective: '2025-10-17T14:05:00Z',
    results: ref(['1884-6', '13457-7', '4548-4']).map((e, i) => sample(e, i + 3)),
  },
  {
    name: '03-trend-b',
    purpose: 'Trend merge, second draw (same tests, different date).',
    patient: JORDAN,
    effective: '2026-02-03T15:20:00Z',
    results: ref(['1884-6', '13457-7', '4548-4']).map((e, i) => sample(e, i + 9)),
  },
  {
    name: '04-name-mismatch',
    purpose: 'Name and DOB differ from the Health profile. Record whether Health warns.',
    patient: MISMATCH,
    effective: '2026-03-01T12:00:00Z',
    results: ref(['2093-3']).map((e) => sample(e, 1)),
  },
  {
    name: '05-100-obs',
    purpose: '100 observations. Check import time and display.',
    patient: JORDAN,
    effective: '2025-06-10T13:00:00Z',
    results: signable.slice(0, 100).map(sample),
  },
  {
    name: '06-all-119-obs',
    purpose: 'Every dictionary entry (~15.8k-character redirect URL).',
    patient: JORDAN,
    effective: '2025-06-11T13:00:00Z',
    results: signable.map(sample),
  },
];

// PROBES: repeat codes to reach sizes no real card can have today.
const repeat = (n: number) => Array.from({ length: n }, (_, i) => sample(signable[i % signable.length]!, i));
specs.push(
  { name: 'probe-25k-url', purpose: 'PROBE (duplicate codes): ~25k-character redirect URL.', patient: JORDAN, effective: '2024-01-02T12:00:00Z', results: repeat(200), probe: true },
  { name: 'probe-300-obs', purpose: 'PROBE (duplicate codes): 300 observations.', patient: JORDAN, effective: '2024-01-03T12:00:00Z', results: repeat(300), probe: true },
  { name: 'probe-400-obs', purpose: 'PROBE (duplicate codes): 400 observations.', patient: JORDAN, effective: '2024-01-04T12:00:00Z', results: repeat(400), probe: true },
);

mkdirSync(OUT, { recursive: true });
const rows: string[] = [];
for (const s of specs) {
  const payload = buildPayload({ issuer: ISSUER, nbf: nbfFor(s.effective), patient: s.patient, effectiveDateTime: s.effective, results: s.results });
  if (!s.probe) {
    const v = validateCardPayload(payload, { dictionary, issuer: ISSUER });
    if (!v.ok) throw new Error(`${s.name}: ${v.error.path} ${v.error.message}`);
  }
  const jws = await signPayload(payload, kid, signer);
  const url = appleRedirectUrl(jws);
  writeFileSync(`${OUT}/${s.name}.smart-health-card`, cardFileContents(jws));
  rows.push(
    `<li><strong>${s.name}</strong>: ${s.purpose}<br><small>${s.results.length} obs · JWS ${jws.length} chars · URL ${url.length} chars</small><br><a href="${url}">Add to Apple Health</a> · file: ${s.name}.smart-health-card</li>`,
  );
  console.log(`${s.name.padEnd(18)} ${String(s.results.length).padStart(3)} obs  jws ${String(jws.length).padStart(5)}  url ${String(url.length).padStart(6)}`);
}
writeFileSync(
  `${OUT}/links.html`,
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>labkit M0 cards</title><h1>labkit.health M0 (staging, synthetic)</h1><ol>${rows.join('')}</ol>`,
);
console.log(`\nWrote ${specs.length} cards and links.html to out/m0/. Record the results in SPEC §2.2 (see docs/M0-issuer-spike.md).`);
