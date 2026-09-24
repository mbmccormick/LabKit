import type { JsonObject } from '@labkit/core';

export type Health = { ok: boolean; issuer: string; activeKid: string; error?: string };
export type SignedCard = { jws: string; kid: string };
export type ApiError = { code: string; message: string; cardIndex?: number; path?: string };

export class SignError extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.message);
  }
}

export async function getHealth(): Promise<Health> {
  const res = await fetch('/api/health', { cache: 'no-store' });
  return (await res.json()) as Health;
}

export async function signCards(turnstileToken: string, payloads: JsonObject[]): Promise<SignedCard[]> {
  const res = await fetch('/api/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turnstileToken, cards: payloads.map((payload) => ({ payload })) }),
    cache: 'no-store',
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new SignError(res.status, { code: 'network', message: `Unexpected response (${res.status}).` });
  }
  if (!res.ok) throw new SignError(res.status, (body as { error: ApiError }).error);
  return (body as { cards: SignedCard[] }).cards;
}
