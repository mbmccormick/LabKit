import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPayload, jwkThumbprint, parseJws, toPublicJwk, verifyJws, type DictionaryFile, type PublicJwk } from '@labkit/core';
import { createApp } from '../src/app';
import type { Env } from '../src/env';
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from '../src/headers';
import { SITEVERIFY_URL, verifyTurnstile } from '../src/turnstile';

const root = new URL('../../../', import.meta.url);
const dictionary = JSON.parse(readFileSync(new URL('dictionary/dictionary.json', root), 'utf8')) as DictionaryFile;

// Cloudflare Turnstile test credentials (public, documented).
const PASS_SECRET = '1x0000000000000000000000000000000AA';
const FAIL_SECRET = '2x0000000000000000000000000000000AA';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const ISSUER = 'https://staging.labkit.health';
const NOW = new Date('2026-09-23T12:00:00Z');
const EFFECTIVE = '2026-04-17T13:40:00Z';

/** Emulates siteverify for Cloudflare's test secrets without the network. */
const fakeSiteverify = async (url: string, init?: RequestInit) => {
  expect(url).toBe(SITEVERIFY_URL);
  const form = init!.body as FormData;
  return Response.json({ success: form.get('secret') === PASS_SECRET && !!form.get('response') });
};

type Point = { blobs?: string[]; doubles?: number[]; indexes?: string[] };

let keys: { privateJwk: string; pub: PublicJwk; kid: string };
let other: { privateJwk: string; pub: PublicJwk };

async function makeKey() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey & { x: string; y: string; d: string };
  const kid = await jwkThumbprint({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y });
  return { kid, pub: toPublicJwk(jwk, kid), privateJwk: JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }) };
}

beforeAll(async () => {
  keys = await makeKey();
  other = await makeKey();
});

function setup(overrides: Partial<Env> = {}, limiterAllows = true) {
  const points: Point[] = [];
  const env: Env = {
    ISSUER,
    ACTIVE_KID: keys.kid,
    KEY_ENV: 'staging',
    SIGNING_KEY_JWK: keys.privateJwk,
    TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    TURNSTILE_SECRET: PASS_SECRET,
    RATE_LIMITER: { limit: async () => ({ success: limiterAllows }) },
    METRICS: { writeDataPoint: (p) => points.push(p) },
    ASSETS: { fetch: async () => new Response('<!doctype html><title>labkit</title>', { headers: { 'Content-Type': 'text/html' } }) },
    ...overrides,
  };
  const app = createApp({ dictionary, keysets: { staging: [keys.pub, other.pub] }, fetch: fakeSiteverify, now: () => NOW });
  return { env, points, fetch: (req: Request) => app.fetch(req, env) };
}

const PATIENT = { family: 'Testperson', given: ['Alex'], birthDate: '1980-02-29' };
function card(results = [{ loinc: '2093-3', value: 180 }], opts: { effective?: string; nbf?: number } = {}) {
  const byLoinc = new Map(dictionary.entries.map((e) => [e.loinc, e]));
  return buildPayload({
    issuer: ISSUER,
    nbf: opts.nbf ?? 0,
    patient: PATIENT,
    effectiveDateTime: opts.effective ?? EFFECTIVE,
    results: results.map((r) => {
      const e = byLoinc.get(r.loinc)!;
      return { loinc: e.loinc, display: e.display, text: e.text, kind: 'quantity' as const, value: r.value, unit: e.ucum! };
    }),
  });
}

const signReq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://staging.labkit.health/api/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function errorOf(res: Response) {
  return ((await res.json()) as { error: { code: string; message: string; cardIndex?: number; path?: string } }).error;
}

describe('POST /api/sign', () => {
  it('signs valid cards, sets nbf itself and returns verifiable JWS', async () => {
    const { fetch, points } = setup();
    const cards = [{ payload: card(undefined, { nbf: 12345 }) }, { payload: card([{ loinc: '2085-9', value: 55 }], { effective: '2025-10-17T14:05:00Z' }) }];
    const res = await fetch(signReq({ turnstileToken: TOKEN, cards }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cards: { jws: string; kid: string }[] };
    expect(body.cards).toHaveLength(2);
    for (const c of body.cards) {
      expect(c.kid).toBe(keys.kid);
      expect(await verifyJws(c.jws, keys.pub)).toBe(true);
      const parsed = parseJws(c.jws);
      expect(parsed.header).toEqual({ zip: 'DEF', alg: 'ES256', kid: keys.kid });
      expect(c.jws.split('.')[0]).toBe(btoa('{"zip":"DEF","alg":"ES256","kid":"' + keys.kid + '"}').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'));
    }
    expect(parseJws(body.cards[0]!.jws).payload.nbf).toBe(Math.floor(Date.parse(EFFECTIVE) / 1000));
    expect(JSON.stringify(parseJws(body.cards[0]!.jws).payload)).toBe(JSON.stringify(card(undefined, { nbf: Math.floor(Date.parse(EFFECTIVE) / 1000) })));
    expect(points).toEqual([{ blobs: ['ok'], doubles: [2, 2], indexes: ['ok'] }]);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
  });

  it('rejects invalid payloads with cardIndex and path (§7.2)', async () => {
    const { fetch } = setup();
    const bad = card() as { vc: { credentialSubject: { fhirBundle: { entry: { resource: Record<string, unknown> }[] } } } };
    bad.vc.credentialSubject.fhirBundle.entry[1]!.resource.meta = { versionId: '1' };
    const res = await fetch(signReq({ turnstileToken: TOKEN, cards: [{ payload: card() }, { payload: bad }] }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({ code: 'invalid_payload', cardIndex: 1, path: 'vc.credentialSubject.fhirBundle.entry[1].resource' });
  });

  it('rejects the production issuer on staging', async () => {
    const { fetch } = setup();
    const p = card() as { iss: string };
    p.iss = 'https://labkit.health';
    const res = await fetch(signReq({ turnstileToken: TOKEN, cards: [{ payload: p }] }));
    expect(await errorOf(res)).toMatchObject({ code: 'invalid_payload', cardIndex: 0, path: 'iss' });
  });

  it('rejects immunization cards explicitly', async () => {
    const { fetch } = setup();
    const p = card() as { vc: { type: string[] } };
    p.vc.type = ['https://smarthealth.cards#health-card', 'https://smarthealth.cards#immunization'];
    const res = await fetch(signReq({ turnstileToken: TOKEN, cards: [{ payload: p }] }));
    expect(res.status).toBe(400);
    expect((await errorOf(res)).message).toMatch(/immunization/);
  });

  it('rejects malformed requests', async () => {
    const { fetch } = setup();
    expect((await fetch(signReq('{nope'))).status).toBe(400);
    expect(await errorOf(await fetch(signReq({ cards: [] })))).toMatchObject({ code: 'invalid_payload' });
    expect(await errorOf(await fetch(signReq({ turnstileToken: TOKEN, cards: [{ payload: card() }], extra: 1 })))).toMatchObject({ code: 'invalid_payload' });
    expect((await fetch(new Request('https://x/api/sign'))).status).toBe(405);
  });

  it('413 when the body exceeds 512 KB', async () => {
    const { fetch } = setup();
    const res = await fetch(signReq({ turnstileToken: TOKEN, cards: [{ payload: card() }], pad: 'x'.repeat(512 * 1024) }));
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe('too_large');
  });

  it('413 for more than 12 cards', async () => {
    const { fetch } = setup();
    const cards = Array.from({ length: 13 }, () => ({ payload: card() }));
    const res = await fetch(signReq({ turnstileToken: TOKEN, cards }));
    expect(res.status).toBe(413);
  });

  it('413 for more than 400 observations in a card', async () => {
    const { fetch } = setup();
    const p = card() as { vc: { credentialSubject: { fhirBundle: { entry: unknown[] } } } };
    const e = p.vc.credentialSubject.fhirBundle.entry;
    while (e.length < 402) e.push(e[1]);
    const res = await fetch(signReq({ turnstileToken: TOKEN, cards: [{ payload: card() }, { payload: p }] }));
    expect(res.status).toBe(413);
    expect(await errorOf(res)).toMatchObject({ code: 'too_large', cardIndex: 1 });
  });

  it('403 when Turnstile fails (always-fail secret) and when the token is missing', async () => {
    const { fetch } = setup({ TURNSTILE_SECRET: FAIL_SECRET });
    const res = await fetch(signReq({ turnstileToken: TOKEN, cards: [{ payload: card() }] }));
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('turnstile_failed');
    const unset = setup({ TURNSTILE_SECRET: undefined });
    expect((await unset.fetch(signReq({ turnstileToken: TOKEN, cards: [{ payload: card() }] }))).status).toBe(403);
  });

  it('429 with Retry-After when rate limited', async () => {
    const { fetch } = setup({}, false);
    const res = await fetch(signReq({ turnstileToken: TOKEN, cards: [{ payload: card() }] }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect((await errorOf(res)).code).toBe('rate_limited');
  });

  it('rate limits by CF-Connecting-IP', async () => {
    const seen: string[] = [];
    const { fetch } = setup({ RATE_LIMITER: { limit: async ({ key }) => (seen.push(key), { success: true }) } });
    await fetch(signReq({ turnstileToken: TOKEN, cards: [{ payload: card() }] }));
    expect(seen).toEqual(['203.0.113.9']);
  });

  it('500 signing_failed when the secret key does not match ACTIVE_KID', async () => {
    const { fetch, points } = setup({ SIGNING_KEY_JWK: other.privateJwk });
    const res = await fetch(signReq({ turnstileToken: TOKEN, cards: [{ payload: card() }] }));
    expect(res.status).toBe(500);
    expect((await errorOf(res)).code).toBe('signing_failed');
    expect(points[0]!.blobs).toEqual(['signing_failed:key_mismatch']);
  });

  it('never puts patient data or values into metrics or errors', async () => {
    const { fetch, points } = setup();
    const p = card([{ loinc: '2093-3', value: 987654 }]) as { vc: { credentialSubject: { fhirBundle: { entry: { resource: Record<string, unknown> }[] } } } };
    p.vc.credentialSubject.fhirBundle.entry[1]!.resource.valueQuantity = { value: 'Testperson-987654' };
    const res = await fetch(signReq({ turnstileToken: TOKEN, cards: [{ payload: p }] }));
    const text = await res.text();
    expect(text).not.toMatch(/Testperson|Alex|987654|1980-02-29/);
    expect(JSON.stringify(points)).not.toMatch(/Testperson|Alex|987654|1980|203\.0\.113/);
  });
});

describe('GET /.well-known/jwks.json (§7.4)', () => {
  it('serves public keys with the required headers and never d', async () => {
    const { fetch } = setup();
    const res = await fetch(new Request('https://staging.labkit.health/.well-known/jwks.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const body = (await res.json()) as { keys: Record<string, string>[] };
    expect(body.keys).toHaveLength(2);
    for (const k of body.keys) {
      expect(Object.keys(k).sort()).toEqual(['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y']);
      expect(k).toMatchObject({ kty: 'EC', crv: 'P-256', use: 'sig', alg: 'ES256' });
    }
  });

  it('strips any stray private member from the keyset', async () => {
    const leaky = { ...keys.pub, d: 'SECRET' } as PublicJwk;
    const app = createApp({ dictionary, keysets: { staging: [leaky] } });
    const { env } = setup();
    const res = await app.fetch(new Request('https://staging.labkit.health/.well-known/jwks.json'), env);
    expect(await res.text()).not.toContain('SECRET');
  });

  it('answers CORS preflight', async () => {
    const { fetch } = setup();
    const res = await fetch(new Request('https://staging.labkit.health/.well-known/jwks.json', { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('GET /api/health', () => {
  it('reports issuer and active kid', async () => {
    const { fetch } = setup();
    const res = await fetch(new Request('https://staging.labkit.health/api/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, issuer: ISSUER, activeKid: keys.kid });
  });

  it.each([
    ['key_mismatch', () => ({ SIGNING_KEY_JWK: other.privateJwk })],
    ['key_mismatch', () => ({ ACTIVE_KID: 'not-a-published-kid' })],
    ['key_missing', () => ({ SIGNING_KEY_JWK: undefined })],
    ['key_invalid', () => ({ SIGNING_KEY_JWK: '{"kty":"RSA"}' })],
  ])('detects %s', async (reason, overrides) => {
    const { fetch } = setup(overrides());
    const res = await fetch(new Request('https://staging.labkit.health/api/health'));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: reason });
  });
});

describe('routing and headers', () => {
  it('serves assets with security headers', async () => {
    const { fetch } = setup();
    const res = await fetch(new Request('https://staging.labkit.health/about'));
    expect(res.headers.get('Content-Type')).toBe('text/html');
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
  });

  it('marks HTML no-transform so the edge cannot inject scripts (§11.2)', async () => {
    const html = (cc?: string) => ({
      fetch: async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=utf-8', ...(cc ? { 'Cache-Control': cc } : {}) } }),
    });
    const get = async (assets: Env['ASSETS']) => (await setup({ ASSETS: assets }).fetch(new Request('https://staging.labkit.health/'))).headers.get('Cache-Control');
    expect(await get(html('public, max-age=0, must-revalidate'))).toBe('public, max-age=0, must-revalidate, no-transform');
    expect(await get(html())).toBe('no-transform');
    const js = { fetch: async () => new Response('x', { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=0' } }) };
    expect(await get(js)).toBe('public, max-age=0');
  });

  it('redirects www to the apex', async () => {
    const { fetch } = setup();
    const res = await fetch(new Request('https://www.labkit.health/about?x=1'));
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://labkit.health/about?x=1');
  });

  it('404s unknown API routes', async () => {
    const { fetch } = setup();
    expect((await fetch(new Request('https://staging.labkit.health/api/nope'))).status).toBe(404);
  });

  it('_headers matches the Worker CSP and allows only the Turnstile origin', () => {
    const file = readFileSync(new URL('apps/web/public/_headers', root), 'utf8');
    const csp = /Content-Security-Policy: (.+)/.exec(file)![1]!.trim();
    expect(csp).toBe(CONTENT_SECURITY_POLICY);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(file).toContain(`${k}: ${v}`);
    const origins = new Set(csp.match(/https?:\/\/[^\s;]+/g));
    expect([...origins]).toEqual(['https://challenges.cloudflare.com']);
  });
});

describe('GET /.well-known/labkit-build.json (§13.1)', () => {
  const MANIFEST = '{\n  "schema": 1\n}\n';
  const assets = (served: Response) => ({
    fetch: async (req: Request) => {
      expect(new URL(req.url).pathname).toBe('/build-manifest.json');
      return served;
    },
  });

  it('serves the build manifest byte-for-byte with CORS and the Cloudflare version', async () => {
    const { fetch } = setup({
      ASSETS: assets(new Response(MANIFEST, { headers: { 'Content-Type': 'application/json' } })),
      CF_VERSION_METADATA: { id: 'v-123', tag: 'abc', timestamp: '2026-09-25T00:00:00Z' },
    });
    const res = await fetch(new Request('https://staging.labkit.health/.well-known/labkit-build.json'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(MANIFEST);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('LabKit-Worker-Version')).toBe('v-123');
    expect(res.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY);
  });

  it('404s when the build has no manifest (SPA fallback returns HTML)', async () => {
    const { fetch } = setup();
    const res = await fetch(new Request('https://staging.labkit.health/.well-known/labkit-build.json'));
    expect(res.status).toBe(404);
    expect(res.headers.get('LabKit-Worker-Version')).toBeNull();
  });

  it('rejects other methods', async () => {
    const { fetch } = setup();
    const res = await fetch(new Request('https://staging.labkit.health/.well-known/labkit-build.json', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(405);
  });
});

describe('Turnstile siteverify (live, Cloudflare test secrets)', () => {
  it('always-pass secret succeeds and always-fail secret fails', async () => {
    expect(await verifyTurnstile(TOKEN, PASS_SECRET, null)).toBe(true);
    expect(await verifyTurnstile(TOKEN, FAIL_SECRET, null)).toBe(false);
  }, 15000);
});
