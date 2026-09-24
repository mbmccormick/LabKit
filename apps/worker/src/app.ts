import { loadDictionary, type Dictionary, type DictionaryFile, type PublicJwk } from '@labkit/core';
import type { Env } from './env';
import { apiError, json, withSecurityHeaders } from './headers';
import { jwksResponse } from './jwks';
import { handleSign } from './sign';
import { loadKeyState, type KeyState } from './signer';
import type { FetchLike } from './turnstile';

export type AppOptions = {
  dictionary: DictionaryFile;
  keysets: Readonly<Record<string, readonly PublicJwk[]>>;
  fetch?: FetchLike;
  now?: () => Date;
};

export function createApp(opts: AppOptions) {
  const dictionary: Dictionary = loadDictionary(opts.dictionary);
  let cached: { cacheKey: string; state: Promise<KeyState> } | undefined;

  const keysFor = (env: Env) => opts.keysets[env.KEY_ENV] ?? [];

  function keyState(env: Env): Promise<KeyState> {
    const cacheKey = `${env.KEY_ENV}\u0000${env.ACTIVE_KID}\u0000${env.SIGNING_KEY_JWK ?? ''}`;
    if (!cached || cached.cacheKey !== cacheKey) {
      cached = { cacheKey, state: loadKeyState(env.SIGNING_KEY_JWK, env.ACTIVE_KID, keysFor(env)) };
    }
    return cached.state;
  }

  async function route(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === '/.well-known/jwks.json') {
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return apiError(405, 'method_not_allowed', 'use GET', {}, { Allow: 'GET, HEAD, OPTIONS' });
      return jwksResponse(keysFor(env));
    }

    if (url.pathname === '/api/health') {
      const state = await keyState(env);
      const body = { ok: state.ok, issuer: env.ISSUER, activeKid: env.ACTIVE_KID, ...(state.ok ? {} : { error: state.reason }) };
      return json(body, state.ok ? 200 : 503);
    }

    if (url.pathname === '/api/sign') {
      if (req.method !== 'POST') return apiError(405, 'method_not_allowed', 'use POST', {}, { Allow: 'POST' });
      return handleSign(req, env, {
        dictionary,
        keyState: () => keyState(env),
        fetch: opts.fetch ?? ((input, init) => fetch(input, init)),
        now: opts.now ?? (() => new Date()),
      });
    }

    if (url.pathname.startsWith('/api/')) return apiError(404, 'not_found', 'no such endpoint');

    return env.ASSETS.fetch(req);
  }

  return {
    async fetch(req: Request, env: Env): Promise<Response> {
      try {
        return withSecurityHeaders(await route(req, env));
      } catch (err) {
        // Code and error class only: never messages, request data or results.
        console.error('labkit:internal_error', err instanceof Error ? err.name : typeof err);
        return withSecurityHeaders(apiError(500, 'signing_failed', 'internal error'));
      }
    },
  };
}
