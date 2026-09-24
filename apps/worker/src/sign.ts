import {
  bufferSource,
  countObservations,
  LIMITS,
  signPayload,
  signRequestSchema,
  parseJws,
  validateCardPayload,
  type Dictionary,
} from '@labkit/core';
import type { Env } from './env';
import { apiError, json } from './headers';
import type { KeyState } from './signer';
import { verifyTurnstile, type FetchLike } from './turnstile';

export type SignDeps = {
  dictionary: Dictionary;
  keyState: () => Promise<KeyState>;
  fetch: FetchLike;
  now: () => Date;
};

type Outcome = { response: Response; status: string; cards: number; observations: number };

/** Read at most `max` bytes; returns undefined if the body is larger. */
async function readLimited(req: Request, max: number): Promise<Uint8Array | undefined> {
  const declared = Number(req.headers.get('Content-Length') ?? '0');
  if (declared > max) return undefined;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function run(req: Request, env: Env, deps: SignDeps): Promise<Outcome> {
  const done = (response: Response, status: string, cards = 0, observations = 0): Outcome => ({ response, status, cards, observations });

  const bytes = await readLimited(req, LIMITS.maxBodyBytes);
  if (!bytes) return done(apiError(413, 'too_large', 'request body exceeds 512 KB'), 'too_large');

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return done(apiError(400, 'invalid_payload', 'body must be JSON'), 'invalid_payload');
  }
  const envelope = signRequestSchema.safeParse(body);
  if (!envelope.success) {
    const issue = envelope.error.issues[0]!;
    return done(apiError(400, 'invalid_payload', 'request must be {turnstileToken, cards:[{payload}]}', { path: issue.path.join('.') }), 'invalid_payload');
  }
  const { turnstileToken, cards } = envelope.data;
  const observations = cards.reduce((n, c) => n + countObservations(c.payload), 0);

  if (cards.length > LIMITS.maxCards) {
    return done(apiError(413, 'too_large', `at most ${LIMITS.maxCards} cards per request`), 'too_large', cards.length, observations);
  }
  const bigCard = cards.findIndex((c) => countObservations(c.payload) > LIMITS.maxObservationsPerCard);
  if (bigCard >= 0) {
    return done(
      apiError(413, 'too_large', `at most ${LIMITS.maxObservationsPerCard} observations per card`, { cardIndex: bigCard }),
      'too_large',
      cards.length,
      observations,
    );
  }

  // 1. Turnstile
  const ip = req.headers.get('CF-Connecting-IP');
  if (!(await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip, deps.fetch))) {
    return done(apiError(403, 'turnstile_failed', 'human check failed; please try again'), 'turnstile_failed', cards.length, observations);
  }

  // 2. Rate limit
  const { success } = await env.RATE_LIMITER.limit({ key: ip ?? 'unknown' });
  if (!success) {
    return done(apiError(429, 'rate_limited', 'too many requests; please wait a minute', {}, { 'Retry-After': '60' }), 'rate_limited', cards.length, observations);
  }

  const key = await deps.keyState();
  if (!key.ok) {
    console.error('labkit:key_state', key.reason);
    return done(apiError(500, 'signing_failed', 'signing is unavailable'), `signing_failed:${key.reason}`, cards.length, observations);
  }

  // 3. Validate every card before signing any.
  const now = deps.now();
  const valid = [];
  for (let i = 0; i < cards.length; i++) {
    const r = validateCardPayload(cards[i]!.payload, { dictionary: deps.dictionary, issuer: env.ISSUER, now });
    if (!r.ok) {
      return done(apiError(400, 'invalid_payload', r.error.message, { cardIndex: i, path: r.error.path }), 'invalid_payload', cards.length, observations);
    }
    valid.push(r.payload);
  }

  // 4–8. Serialize (canonical builder output), deflate, sign, self-verify.
  const out: { jws: string; kid: string }[] = [];
  try {
    for (const payload of valid) {
      const jws = await signPayload(payload, key.kid, key.signer);
      const parsed = parseJws(jws);
      const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key.verifyKey, bufferSource(parsed.signature), bufferSource(parsed.signingInput));
      if (!ok) throw new Error('self-verify failed');
      out.push({ jws, kid: key.kid });
    }
  } catch (err) {
    console.error('labkit:signing_failed', err instanceof Error ? err.name : typeof err);
    return done(apiError(500, 'signing_failed', 'signing failed'), 'signing_failed', cards.length, observations);
  }
  return done(json({ cards: out }), 'ok', cards.length, observations);
}

export async function handleSign(req: Request, env: Env, deps: SignDeps): Promise<Response> {
  const outcome = await run(req, env, deps);
  // 9. Counts only. Never bodies, names, values or IPs.
  try {
    env.METRICS?.writeDataPoint({ blobs: [outcome.status], doubles: [outcome.cards, outcome.observations], indexes: [outcome.status.split(':')[0]!] });
  } catch {
    // metrics must never affect the response
  }
  return outcome.response;
}
