// Build manifest (SPEC §13.1): what a deployment contains, signed by GitHub Actions and
// served verbatim at /.well-known/labkit-build.json.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

export type BuildManifest = {
  schema: 1;
  repository: string;
  commit: string;
  dirty?: true;
  env: string;
  /** GitHub Actions run that built, signed and deployed this; null for local builds. */
  run: string | null;
  worker: { file: string; sha256: string };
  /** URL path → SHA-256 of every file served from the web build. */
  assets: Record<string, string>;
  /** SHA-256 of the static-assets config files (_headers, _redirects), which Cloudflare stores with the Worker version. */
  config: Record<string, string>;
};

export const MANIFEST_FILE = 'build-manifest.json';

/** Web build files that Workers static assets reads as configuration and uploads with the Worker version. */
export const ASSET_CONFIG_FILES = ['_headers', '_redirects'];
/** Files in the web build that are not served. */
const NOT_SERVED = new Set([...ASSET_CONFIG_FILES, '.assetsignore', MANIFEST_FILE]);

export const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

/** SHA-256 of every served file under `dir`, keyed by URL path, sorted. */
export function hashAssets(dir: string): Record<string, string> {
  const out: [string, string][] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(`${dir}${rel}`)) {
      const path = `${rel}/${name}`;
      if (statSync(`${dir}${path}`).isDirectory()) walk(path);
      else if (!(rel === '' && NOT_SERVED.has(name))) out.push([path, sha256(readFileSync(`${dir}${path}`))]);
    }
  };
  walk('');
  return Object.fromEntries(out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** SHA-256 of the static-assets config files present in `dir`. */
export function hashAssetConfig(dir: string): Record<string, string> {
  return Object.fromEntries(ASSET_CONFIG_FILES.filter((f) => existsSync(`${dir}/${f}`)).map((f) => [f, sha256(readFileSync(`${dir}/${f}`))]));
}

export function serializeManifest(m: BuildManifest): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}

export function parseManifest(text: string): BuildManifest {
  const m = JSON.parse(text) as BuildManifest;
  const hex = /^[0-9a-f]{64}$/;
  if (m.schema !== 1 || !/^[0-9a-f]{40}$/.test(m.commit) || !hex.test(m.worker?.sha256 ?? '') || typeof m.assets !== 'object' || typeof m.config !== 'object') {
    throw new Error('not a LabKit build manifest (schema 1)');
  }
  for (const [path, hash] of Object.entries(m.assets)) {
    if (!path.startsWith('/') || path.includes('..') || !hex.test(hash)) throw new Error(`manifest has a bad asset entry: ${path}`);
  }
  for (const [name, hash] of Object.entries(m.config)) {
    if (!ASSET_CONFIG_FILES.includes(name) || !hex.test(hash)) throw new Error(`manifest has a bad config entry: ${name}`);
  }
  return m;
}
