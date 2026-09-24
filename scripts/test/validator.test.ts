// Official SHC validator on cards signed by the Worker (SPEC §15, definition of done).
// Requires `bash scripts/setup-validator.sh` once.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPayload, cardFileContents, jwkThumbprint, toPublicJwk, type DictionaryEntry, type DictionaryFile, type ObservationInput } from '@labkit/core';
import { createApp } from '../../apps/worker/src/app';
import type { Env } from '../../apps/worker/src/env';
import { ROOT } from '../lib';
import { validateCardFile } from '../validate-card';

const ISSUER = 'https://staging.labkit.health';
const dictionary = JSON.parse(readFileSync(`${ROOT}dictionary/dictionary.json`, 'utf8')) as DictionaryFile;

/** A synthetic value for every entry, inside its plausible bounds. */
function sample(e: DictionaryEntry): ObservationInput {
  const base = { loinc: e.loinc, display: e.display, text: e.text };
  if (e.valueType === 'titer') return { ...base, kind: 'titer', value: 80 };
  if (e.valueType === 'qualitative') return { ...base, kind: 'qualitative', value: e.answers?.[0] ?? 'Clear' };
  const { min, max } = e.plausible!;
  const value = Number((min + (max - min) * 0.1).toPrecision(3));
  return { ...base, kind: 'quantity', value, unit: e.ucum!, low: min, high: Number((min + (max - min) * 0.5).toPrecision(3)) };
}

describe('official SMART Health Cards validator', () => {
  it('reports no errors on Worker-signed cards (all dictionary entries)', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey & { x: string; y: string; d: string };
    const kid = await jwkThumbprint({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y });
    const pub = toPublicJwk(jwk, kid);

    const env: Env = {
      ISSUER,
      ACTIVE_KID: kid,
      KEY_ENV: 'staging',
      SIGNING_KEY_JWK: JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }),
      TURNSTILE_SITE_KEY: 'x',
      TURNSTILE_SECRET: 'x',
      RATE_LIMITER: { limit: async () => ({ success: true }) },
      ASSETS: { fetch: async () => new Response('') },
    };
    const app = createApp({ dictionary, keysets: { staging: [pub] }, fetch: async () => Response.json({ success: true }) });

    const patient = { family: 'Sample', given: ['Casey', 'Q'], birthDate: '1979-06-30', gender: 'female' as const };
    const all = dictionary.entries.filter((e) => !e.excludeFromSigning).map(sample);
    const small = all.filter((r) => ['1884-6', '30522-7', '8061-4', '5048-4'].includes(r.loinc));
    const cards = [
      buildPayload({ issuer: ISSUER, nbf: 0, patient, effectiveDateTime: '2025-10-17T14:05:00Z', results: all }),
      buildPayload({ issuer: ISSUER, nbf: 0, patient, effectiveDateTime: '2026-04-17T13:40:00Z', results: small }),
    ];
    const res = await app.fetch(
      new Request(`${ISSUER}/api/sign`, { method: 'POST', body: JSON.stringify({ turnstileToken: 't', cards: cards.map((payload) => ({ payload })) }) }),
      env,
    );
    expect(res.status).toBe(200);
    const { cards: signed } = (await res.json()) as { cards: { jws: string }[] };

    const dir = mkdtempSync(join(tmpdir(), 'labkit-validate-'));
    const jwksPath = join(dir, 'jwks.json');
    writeFileSync(jwksPath, JSON.stringify({ keys: [pub] }));
    for (const [i, c] of signed.entries()) {
      const file = join(dir, `card-${i}.smart-health-card`);
      writeFileSync(file, cardFileContents(c.jws));
      const result = await validateCardFile(file, jwksPath);
      expect(result.problems, `card ${i}`).toEqual([]);
      expect(result.allowed).toBeGreaterThan(0);
    }
  }, 60000);
});
