import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { JsonObject } from './fhir';

export const APPLE_REDIRECT_PREFIX = 'https://redirect.health.apple.com/SMARTHealthCard/#';
export const SHC_MIME = 'application/smart-health-card';

// ---------- base64url ----------

export function b64uEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('invalid base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** WebCrypto wants ArrayBuffer-backed views; nothing here uses SharedArrayBuffer. */
export const bufferSource = (u: Uint8Array): Uint8Array<ArrayBuffer> => u as Uint8Array<ArrayBuffer>;

// ---------- JWK ----------

export type PublicJwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string; kid: string; use: 'sig'; alg: 'ES256' };
export type PrivateJwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string; d: string; kid?: string };

/** RFC 7638 thumbprint: required members only, lexicographic order, no whitespace. */
export async function jwkThumbprint(jwk: { crv: string; kty: string; x: string; y: string }): Promise<string> {
  const canon = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  const digest = await crypto.subtle.digest('SHA-256', bufferSource(strToU8(canon)));
  return b64uEncode(new Uint8Array(digest));
}

/** Only the members a published key may carry. Never includes `d`. */
export function toPublicJwk(jwk: { x: string; y: string }, kid: string): PublicJwk {
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid, use: 'sig', alg: 'ES256' };
}

export function importPublicKey(jwk: { x: string; y: string }): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

// ---------- JWS ----------

/** Signs a JWS signing input and returns the raw 64-byte r||s signature (not DER). */
export interface Signer {
  sign(signingInput: Uint8Array): Promise<Uint8Array>;
}

export function serializePayload(payload: JsonObject): Uint8Array {
  return strToU8(JSON.stringify(payload));
}

/** Raw DEFLATE (no zlib header), level 9. */
export function deflatePayload(payload: JsonObject): Uint8Array {
  return deflateSync(serializePayload(payload), { level: 9 });
}

export function jwsHeader(kid: string): string {
  return b64uEncode(strToU8(JSON.stringify({ zip: 'DEF', alg: 'ES256', kid })));
}

export async function signPayload(payload: JsonObject, kid: string, signer: Signer): Promise<string> {
  const signingInput = `${jwsHeader(kid)}.${b64uEncode(deflatePayload(payload))}`;
  const sig = await signer.sign(strToU8(signingInput));
  if (sig.length !== 64) throw new Error('signer must return a 64-byte r||s signature');
  return `${signingInput}.${b64uEncode(sig)}`;
}

export type ParsedJws = {
  header: { zip?: string; alg?: string; kid?: string };
  payload: JsonObject;
  signingInput: Uint8Array;
  signature: Uint8Array;
};

export function parseJws(jws: string): ParsedJws {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('JWS must have three parts');
  const [h, p, s] = parts as [string, string, string];
  const header = JSON.parse(strFromU8(b64uDecode(h))) as ParsedJws['header'];
  const body = b64uDecode(p);
  const json = header.zip === 'DEF' ? strFromU8(inflateSync(body)) : strFromU8(body);
  return { header, payload: JSON.parse(json) as JsonObject, signingInput: strToU8(`${h}.${p}`), signature: b64uDecode(s) };
}

export async function verifyJws(jws: string, publicJwk: { x: string; y: string }): Promise<boolean> {
  const { signingInput, signature } = parseJws(jws);
  const key = await importPublicKey(publicJwk);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bufferSource(signature), bufferSource(signingInput));
}

// ---------- delivery ----------

/** SHC numeric mode: each character becomes two digits, charCode - 45, zero-padded. */
export function toNumeric(jws: string): string {
  let out = '';
  for (let i = 0; i < jws.length; i++) {
    const n = jws.charCodeAt(i) - 45;
    if (n < 0 || n > 99) throw new Error('character outside the SHC numeric range');
    out += n < 10 ? `0${n}` : String(n);
  }
  return out;
}

export function fromNumeric(digits: string): string {
  if (digits.length % 2 !== 0 || !/^\d*$/.test(digits)) throw new Error('invalid numeric encoding');
  let out = '';
  for (let i = 0; i < digits.length; i += 2) out += String.fromCharCode(Number(digits.slice(i, i + 2)) + 45);
  return out;
}

export function appleRedirectUrl(jws: string): string {
  return APPLE_REDIRECT_PREFIX + toNumeric(jws);
}

export function cardFileContents(jws: string): string {
  return JSON.stringify({ verifiableCredential: [jws] });
}

/** labkit-YYYY-MM-DD.smart-health-card; `n` > 1 disambiguates draws on the same date. */
export function cardFileName(date: string, n = 1): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must be YYYY-MM-DD');
  return `labkit-${date}${n > 1 ? `-${n}` : ''}.smart-health-card`;
}
