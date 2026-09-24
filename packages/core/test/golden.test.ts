import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nbfFor } from '../src/fhir';
import { parseJws, signPayload, verifyJws, jwkThumbprint, toPublicJwk } from '../src/shc';
import { generateKey, readJson, referencePayload, REF_EFFECTIVE, REF_NBF, root, webCryptoSigner } from './helpers';

const expected = readJson<unknown>('reference/example-payload.json');

describe('golden encoder (SPEC §15)', () => {
  it('reproduces reference/example-payload.json exactly, key order included', () => {
    const ours = referencePayload();
    expect(ours).toEqual(expected);
    // toEqual ignores key order; string equality does not.
    expect(JSON.stringify(ours)).toBe(JSON.stringify(expected));
    expect(JSON.stringify(ours, null, 2)).toBe(readFileSync(root + 'reference/example-payload.json', 'utf8').trimEnd());
  });

  it('nbf equals floor(effectiveDateTime / 1000)', () => {
    expect(nbfFor(REF_EFFECTIVE)).toBe(REF_NBF);
  });

  it('decodes and verifies the reference signed card with its JWKS', async () => {
    const file = readJson<{ verifiableCredential: string[] }>('reference/example.smart-health-card');
    const jwks = readJson<{ keys: { x: string; y: string; kid: string; crv: string; kty: string }[] }>('reference/example-jwks.json');
    const jws = file.verifiableCredential[0]!;
    const parsed = parseJws(jws);
    expect(parsed.header).toEqual({ zip: 'DEF', alg: 'ES256', kid: jwks.keys[0]!.kid });
    expect(JSON.stringify(parsed.payload)).toBe(JSON.stringify(expected));
    expect(await verifyJws(jws, jwks.keys[0]!)).toBe(true);
    expect(await jwkThumbprint(jwks.keys[0]!)).toBe(jwks.keys[0]!.kid);
  });

  it('round-trips: sign → parse → inflate → equal payload; signature verifies', async () => {
    const { pair, jwk } = await generateKey();
    const kid = await jwkThumbprint({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y });
    const payload = referencePayload();
    const jws = await signPayload(payload, kid, webCryptoSigner(pair.privateKey));
    const parsed = parseJws(jws);
    expect(JSON.stringify(parsed.payload)).toBe(JSON.stringify(payload));
    expect(parsed.header.kid).toBe(kid);
    expect(parsed.signature.length).toBe(64);
    expect(await verifyJws(jws, toPublicJwk(jwk, kid))).toBe(true);

    const tampered = jws.slice(0, -4) + (jws.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(await verifyJws(tampered, jwk)).toBe(false);
  });
});
