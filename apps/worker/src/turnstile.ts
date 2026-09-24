export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function verifyTurnstile(
  token: string,
  secret: string | undefined,
  remoteIp: string | null,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  if (!secret || !token) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (remoteIp) form.append('remoteip', remoteIp);
  try {
    const res = await fetchImpl(SITEVERIFY_URL, { method: 'POST', body: form });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  } catch {
    return false;
  }
}
