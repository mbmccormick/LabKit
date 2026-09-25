// Deployment verification (SPEC §13.1): manifest hashing and the checks behind `pnpm verify:deployment`.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashAssetConfig, hashAssets, parseManifest, serializeManifest, sha256, type BuildManifest } from '../manifest';
import { checkAssets, checkCloudflare, type CloudflareApi } from '../verify';

const WORKER = 'export default { fetch() { return new Response("ok") } };\n';
const HEADERS = '/*\n  X-Content-Type-Options: nosniff\n';
const FILES: Record<string, string> = { '/index.html': '<!doctype html>', '/assets/app-1234.js': 'console.log(1)' };

function manifest(): BuildManifest {
  return {
    schema: 1,
    repository: 'example/labkit',
    commit: 'a'.repeat(40),
    env: 'staging',
    run: 'https://github.com/example/labkit/actions/runs/1',
    worker: { file: 'index.js', sha256: sha256(WORKER) },
    assets: Object.fromEntries(Object.entries(FILES).map(([p, c]) => [p, sha256(c)])),
    config: { _headers: sha256(HEADERS) },
  };
}

describe('build manifest', () => {
  it('hashes every served file by URL path, sorted, skipping Workers config files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'labkit-manifest-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), FILES['/index.html']!);
    writeFileSync(join(dir, 'assets/app-1234.js'), FILES['/assets/app-1234.js']!);
    writeFileSync(join(dir, '_headers'), '/*\n  X: y\n');
    writeFileSync(join(dir, 'build-manifest.json'), '{}');
    expect(hashAssets(dir)).toEqual({ '/assets/app-1234.js': sha256(FILES['/assets/app-1234.js']!), '/index.html': sha256(FILES['/index.html']!) });
    expect(hashAssetConfig(dir)).toEqual({ _headers: sha256('/*\n  X: y\n') });
  });

  it('round-trips and rejects anything that is not a manifest', () => {
    const m = manifest();
    expect(parseManifest(serializeManifest(m))).toEqual(m);
    expect(() => parseManifest('{"schema":1}')).toThrow();
    expect(() => parseManifest(serializeManifest({ ...m, commit: 'main' }))).toThrow();
    expect(() => parseManifest(serializeManifest({ ...m, assets: { '/../etc/passwd': sha256('x') } }))).toThrow();
    expect(() => parseManifest(serializeManifest({ ...m, config: { 'worker.js': sha256('x') } }))).toThrow();
  });
});

describe('checkAssets', () => {
  const site = (files: Record<string, string>) => async (url: string) => {
    const body = files[new URL(url).pathname];
    // Like Workers static assets' SPA handling: unknown paths get index.html.
    return new Response(body ?? files['/index.html'], { status: 200 });
  };

  it('passes when every file matches', async () => {
    expect((await checkAssets(site(FILES), 'https://x', manifest())).ok).toBe(true);
  });

  it('rechecks mismatches when asked, for files the edge does not have yet', async () => {
    let calls = 0;
    const late = async (url: string) => {
      const path = new URL(url).pathname;
      if (path === '/assets/app-1234.js' && calls++ === 0) return new Response(FILES['/index.html']);
      return new Response(FILES[path]);
    };
    expect((await checkAssets(late, 'https://x', manifest(), { retries: 1, retryDelayMs: 0 })).ok).toBe(true);
  });

  it('fetches like a browser, so edge-injected HTML is caught', async () => {
    // Like Cloudflare Web Analytics: inject a beacon only for browsers loading a page.
    const injecting = async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      const path = new URL(url).pathname;
      const inject = path.endsWith('.html') && h.get('Accept')?.includes('text/html') && h.get('User-Agent')?.includes('Mozilla');
      return new Response(FILES[path] + (inject ? '<script src="https://static.cloudflareinsights.com/beacon.min.js"></script>' : ''));
    };
    const res = await checkAssets(injecting, 'https://x', manifest());
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('/index.html');
  });

  it('names files that differ or are missing', async () => {
    const res = await checkAssets(site({ '/index.html': '<!doctype html>' }), 'https://x', manifest());
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('/assets/app-1234.js');
    expect(res.detail).not.toContain('/index.html');
  });
});

describe('checkCloudflare', () => {
  type State = {
    versions?: { version_id: string; percentage: number }[];
    modules?: { name: string; content_type: string; content_base64?: string }[];
    worker?: Record<string, unknown>;
  };
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  const good = (): Required<State> => ({
    versions: [{ version_id: 'v1', percentage: 100 }],
    // As Cloudflare returns it: the Worker module plus the static-assets _headers file.
    modules: [
      { name: 'index.js', content_type: 'application/javascript+module', content_base64: b64(WORKER) },
      { name: '_headers', content_type: 'text/plain', content_base64: b64(HEADERS) },
    ],
    worker: { logpush: false, observability: { enabled: false, logs: { enabled: false } }, tail_consumers: [] },
  });
  const api = (state: State): CloudflareApi => {
    const s = { ...good(), ...state };
    return async (path) => {
      if (path === '/accounts/acct/workers/scripts/labkit-staging/deployments') return { deployments: [{ versions: s.versions }] };
      if (/^\/accounts\/acct\/workers\/workers\/labkit-staging\/versions\/v\d\?include=modules$/.test(path)) return { annotations: { 'workers/tag': 'a'.repeat(40) }, modules: s.modules };
      if (path === '/accounts/acct/workers/workers/labkit-staging') return s.worker;
      throw new Error(`unexpected ${path}`);
    };
  };
  const run = async (state: State) => checkCloudflare(api(state), 'acct', 'labkit-staging', manifest());
  const failed = async (state: State) => (await run(state)).checks.filter((c) => !c.ok).map((c) => c.label);

  it('passes for the signed bundle and _headers with logging off', async () => {
    const { checks, versionId } = await run({});
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(versionId).toBe('v1');
  });

  it('fails when the deployed code differs (e.g. a dashboard edit)', async () => {
    const modules = good().modules.map((m) => (m.name === 'index.js' ? { ...m, content_base64: b64(WORKER + '// edited\n') } : m));
    expect(await failed({ modules })).toEqual(['version v1 differs from the signed build']);
  });

  it('fails when _headers differs or the Worker module is missing', async () => {
    const edited = good().modules.map((m) => (m.name === '_headers' ? { ...m, content_base64: b64('/*\n') } : m));
    expect(await failed({ modules: edited })).toEqual(['version v1 differs from the signed build']);
    expect(await failed({ modules: good().modules.filter((m) => m.name !== 'index.js') })).toEqual(['version v1 differs from the signed build']);
  });

  it('fails when an extra module is deployed alongside the bundle', async () => {
    const modules = [...good().modules, { name: 'extra.js', content_type: 'application/javascript+module', content_base64: b64('') }];
    expect(await failed({ modules })).toHaveLength(1);
  });

  it('fails when traffic is split across versions, and checks each version', async () => {
    const versions = [
      { version_id: 'v1', percentage: 90 },
      { version_id: 'v2', percentage: 10 },
    ];
    const { checks, versionId } = await run({ versions });
    expect(checks.filter((c) => !c.ok).map((c) => c.label)).toEqual(['traffic is not served by exactly one version']);
    expect(checks.filter((c) => c.label.startsWith('version v'))).toHaveLength(2);
    expect(versionId).toBeUndefined();
  });

  it('fails when a tail consumer is attached', async () => {
    expect(await failed({ worker: { tail_consumers: [{ name: 'copy-requests' }] } })).toEqual(['tail consumers attached: copy-requests']);
  });

  it('fails when Logpush, Workers Logs or traces are on', async () => {
    expect(await failed({ worker: { logpush: true } })).toEqual(['request logging is on: Logpush on']);
    expect(await failed({ worker: { observability: { enabled: true } } })).toEqual(['request logging is on: Workers Logs on']);
    expect(await failed({ worker: { observability: { logs: { enabled: true }, traces: { enabled: true } } } })).toEqual([
      'request logging is on: Workers Logs on, traces on',
    ]);
  });
});
