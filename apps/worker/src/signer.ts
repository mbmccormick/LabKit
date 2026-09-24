import { bufferSource, importPublicKey, jwkThumbprint, type PrivateJwk, type PublicJwk, type Signer } from '@labkit/core';

/** WebCrypto ECDSA P-256 / SHA-256. Returns raw r||s, which is what JWS needs. */
export class WebCryptoSigner implements Signer {
  private constructor(private readonly key: CryptoKey) {}

  static async fromJwk(jwk: PrivateJwk): Promise<WebCryptoSigner> {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, ext: false },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    return new WebCryptoSigner(key);
  }

  async sign(signingInput: Uint8Array): Promise<Uint8Array> {
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.key, bufferSource(signingInput));
    return new Uint8Array(sig);
  }
}

// An AzureKeyVaultSigner (HSM-backed, ES256 sign-digest, returns raw r||s)
// can implement Signer later without touching callers (SPEC §14.4).

export type KeyState =
  | { ok: true; kid: string; signer: Signer; publicJwk: PublicJwk; verifyKey: CryptoKey }
  | { ok: false; kid: string; reason: 'key_missing' | 'key_invalid' | 'key_mismatch' };

/**
 * SPEC §14.5: the public half of SIGNING_KEY_JWK must match
 * keys/<env>/<ACTIVE_KID>.json, and ACTIVE_KID must be its thumbprint.
 */
export async function loadKeyState(secret: string | undefined, activeKid: string, published: readonly PublicJwk[]): Promise<KeyState> {
  if (!secret) return { ok: false, kid: activeKid, reason: 'key_missing' };
  let jwk: PrivateJwk;
  try {
    jwk = JSON.parse(secret) as PrivateJwk;
  } catch {
    return { ok: false, kid: activeKid, reason: 'key_invalid' };
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y || !jwk.d) return { ok: false, kid: activeKid, reason: 'key_invalid' };

  const pub = published.find((k) => k.kid === activeKid);
  if (!pub || pub.x !== jwk.x || pub.y !== jwk.y) return { ok: false, kid: activeKid, reason: 'key_mismatch' };
  if ((await jwkThumbprint(jwk)) !== activeKid) return { ok: false, kid: activeKid, reason: 'key_mismatch' };

  try {
    const signer = await WebCryptoSigner.fromJwk(jwk);
    const verifyKey = await importPublicKey(pub);
    return { ok: true, kid: activeKid, signer, publicJwk: pub, verifyKey };
  } catch {
    return { ok: false, kid: activeKid, reason: 'key_invalid' };
  }
}
