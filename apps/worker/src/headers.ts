// Security headers (SPEC §11.3). Keep in sync with apps/web/public/_headers;
// a test asserts they are identical and that Turnstile is the only external origin.
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; img-src 'self' data: blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  // no-transform stops Cloudflare's edge from injecting into HTML (e.g. the Web Analytics
  // beacon, which the zone enables by default), so visitors get exactly the signed file (SPEC §11.2, §13.1).
  if ((out.headers.get('Content-Type') ?? '').includes('text/html')) {
    const cc = out.headers.get('Cache-Control');
    if (!cc?.includes('no-transform')) out.headers.set('Cache-Control', cc ? `${cc}, no-transform` : 'no-transform');
  }
  return out;
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

export type ErrorCode = 'invalid_payload' | 'turnstile_failed' | 'too_large' | 'rate_limited' | 'signing_failed' | 'not_found' | 'method_not_allowed';

export function apiError(
  status: number,
  code: ErrorCode,
  message: string,
  detail: { cardIndex?: number; path?: string } = {},
  extra: Record<string, string> = {},
): Response {
  return json({ error: { code, message, ...detail } }, status, extra);
}
