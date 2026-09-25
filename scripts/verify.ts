// Checks behind `pnpm verify:deployment` (SPEC §13.1). Kept free of process/CLI concerns so
// the tests can drive them with fake responses.
import { sha256, type BuildManifest } from './manifest';

export type Check = { ok: boolean; label: string; detail?: string };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Request headers like a browser's. Cloudflare's edge only rewrites HTML (e.g. injecting its
 * analytics beacon) for requests that look like a browser loading a page, so fetch the way
 * visitors do or the check sees a file they never get.
 */
export function browserHeaders(path: string): Record<string, string> {
  return {
    'Cache-Control': 'no-cache',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    Accept: path.endsWith('.html') ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' : '*/*',
  };
}

/**
 * Downloads every web file listed in the manifest and compares its SHA-256. Right after a deploy
 * the edge may not have new files yet (unknown paths get index.html), so `retries` rechecks the
 * mismatches every `retryDelayMs` before failing.
 */
export async function checkAssets(
  fetchFn: Fetch,
  origin: string,
  manifest: BuildManifest,
  { concurrency = 8, retries = 0, retryDelayMs = 10_000 } = {},
): Promise<Check> {
  const all = Object.entries(manifest.assets);
  const pass = async (entries: [string, string][]) => {
    const failed: [string, string, string][] = [];
    let next = 0;
    const worker = async () => {
      while (next < entries.length) {
        const [path, expected] = entries[next++]!;
        try {
          const res = await fetchFn(`${origin}${encodeURI(path)}`, { headers: browserHeaders(path) });
          const body = new Uint8Array(await res.arrayBuffer());
          if (!res.ok || sha256(body) !== expected) failed.push([path, expected, String(res.status)]);
        } catch (err) {
          failed.push([path, expected, err instanceof Error ? err.message : 'fetch failed']);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
    return failed;
  };
  let failed = await pass(all);
  for (let attempt = 0; failed.length > 0 && attempt < retries; attempt++) {
    await new Promise((r) => setTimeout(r, retryDelayMs));
    failed = await pass(failed.map(([path, expected]) => [path, expected]));
  }
  const mismatched = failed.map(([path, , why]) => `${path} (${why})`).sort();
  return mismatched.length === 0
    ? { ok: true, label: `all ${all.length} web files match the signed build` }
    : { ok: false, label: `${mismatched.length} of ${all.length} web files differ from the signed build`, detail: mismatched.slice(0, 20).join('\n') };
}

/** GET against the Cloudflare API; returns `result`, throws on API errors. */
export type CloudflareApi = (path: string) => Promise<unknown>;

export function cloudflareApi(token: string, fetchFn: Fetch = fetch): CloudflareApi {
  return async (path) => {
    const res = await fetchFn(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; result?: unknown; errors?: { message: string }[] };
    if (!res.ok || !body.success) throw new Error(`Cloudflare API ${res.status} on ${path}: ${body.errors?.map((e) => e.message).join('; ') ?? 'no body'}`);
    return body.result;
  };
}

type Deployment = { versions: { version_id: string; percentage: number }[] };
type Version = { annotations?: Record<string, string>; modules?: { name: string; content_type: string; content_base64?: string }[] };
type Worker = {
  logpush?: boolean;
  observability?: { enabled?: boolean; logs?: { enabled?: boolean }; traces?: { enabled?: boolean } };
  tail_consumers?: { name: string }[] | null;
};

/**
 * Reads the deployed Worker back from Cloudflare: one version serves all traffic, its code is
 * exactly the signed bundle, and nothing can log or tail requests (SPEC §11.1).
 */
export async function checkCloudflare(api: CloudflareApi, accountId: string, script: string, manifest: BuildManifest): Promise<{ checks: Check[]; versionId?: string }> {
  const checks: Check[] = [];
  const base = `/accounts/${accountId}/workers`;

  const { deployments } = (await api(`${base}/scripts/${script}/deployments`)) as { deployments: Deployment[] };
  const versions = deployments[0]?.versions ?? [];
  const single = versions.length === 1 && versions[0]!.percentage === 100;
  checks.push({
    ok: single,
    label: single ? `one version serves all traffic (${versions[0]!.version_id})` : 'traffic is not served by exactly one version',
    ...(single ? {} : { detail: JSON.stringify(versions) }),
  });

  // A version holds the Worker module plus the static-assets config (_headers). Each must be
  // exactly the signed file, and nothing else may be there.
  const expected = new Map([[manifest.worker.file, manifest.worker.sha256], ...Object.entries(manifest.config)]);
  for (const { version_id: id } of versions) {
    const version = (await api(`${base}/workers/${script}/versions/${id}?include=modules`)) as Version;
    const modules = (version.modules ?? []).map((m) => ({ name: m.name, sha256: m.content_base64 === undefined ? 'no content' : sha256(Buffer.from(m.content_base64, 'base64')) }));
    const exact =
      modules.length === expected.size && modules.every((m) => expected.get(m.name) === m.sha256) && modules.some((m) => m.name === manifest.worker.file);
    const tag = version.annotations?.['workers/tag'];
    checks.push({
      ok: exact,
      label: exact ? `version ${id} code and _headers are exactly the signed build` : `version ${id} differs from the signed build`,
      detail: [
        ...[...expected].map(([name, hash]) => `signed   ${name} ${hash}`),
        ...modules.map((m) => `deployed ${m.name} ${m.sha256}`),
        `tag ${tag ?? '(none)'}`,
      ].join('\n'),
    });
  }

  const worker = (await api(`${base}/workers/${script}`)) as Worker;
  const o = worker.observability;
  const logging = [
    worker.logpush === true && 'Logpush on',
    (o?.enabled === true || o?.logs?.enabled === true) && 'Workers Logs on',
    o?.traces?.enabled === true && 'traces on',
  ].filter(Boolean);
  checks.push({ ok: logging.length === 0, label: logging.length === 0 ? 'Logpush, Workers Logs and traces are off' : `request logging is on: ${logging.join(', ')}` });
  const tails = (worker.tail_consumers ?? []).map((t) => t.name);
  checks.push({ ok: tails.length === 0, label: tails.length === 0 ? 'no tail consumers' : `tail consumers attached: ${tails.join(', ')}` });

  return { checks, versionId: single ? versions[0]!.version_id : undefined };
}
