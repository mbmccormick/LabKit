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

export const DEPLOY_ENVS = ['staging', 'production'] as const;
export type DeployEnv = (typeof DEPLOY_ENVS)[number];

export function isDeployEnv(env: string | undefined): env is DeployEnv {
  return (DEPLOY_ENVS as readonly string[]).includes(env ?? '');
}

export const hostFor = (env: DeployEnv) => (env === 'production' ? 'labkit.health' : 'staging.labkit.health');

/** The public repository that builds and signs deployments (SPEC §13.1). Self-hosted forks pass --repo. */
export const REPOSITORY = 'mbmccormick/LabKit';
export const DEPLOY_WORKFLOW = '.github/workflows/deploy.yml';

/** Top-level `name`/`account_id` and `[env.<env>.vars]` from apps/worker/wrangler.toml (flat string keys only). */
export function readWranglerConfig(env: DeployEnv): { name: string; accountId: string; vars: Record<string, string> } {
  const toml = readFileSync(`${ROOT}apps/worker/wrangler.toml`, 'utf8');
  const top = toml.split(/^\[/m)[0]!;
  const str = (key: string) => top.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1] ?? '';
  const section = toml.split(/^\[env\./m).find((s) => s.startsWith(`${env}.vars]`));
  if (!section) throw new Error(`[env.${env}.vars] missing from wrangler.toml`);
  const vars = Object.fromEntries([...section.matchAll(/^(\w+)\s*=\s*"([^"]*)"/gm)].map((m) => [m[1]!, m[2]!]));
  return { name: str('name'), accountId: str('account_id'), vars };
}
