import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PublicJwk } from '@labkit/core';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ENVS = ['dev', 'staging', 'production'] as const;
export type KeyEnv = (typeof ENVS)[number];

export function readPublicKeys(env: string): PublicJwk[] {
  const dir = `${ROOT}keys/${env}`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const k = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as PublicJwk & { d?: unknown };
      if ('d' in k) throw new Error(`keys/${env}/${f} contains a private key member "d". Remove it from the repo NOW and rotate.`);
      if (`${k.kid}.json` !== f) throw new Error(`keys/${env}/${f}: file name must be <kid>.json`);
      return k;
    });
}

export function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  return eq?.slice(flag.length + 1);
}
