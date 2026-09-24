import { toPublicJwk, type PublicJwk } from '@labkit/core';

/** SPEC §7.4. Served by the Worker so the headers are guaranteed. */
export function jwksResponse(keys: readonly PublicJwk[]): Response {
  // Rebuild each key from an allow-list of members: never d, never anything else.
  const body = JSON.stringify({ keys: keys.map((k) => toPublicJwk(k, k.kid)) });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
