// pnpm build:release --env staging|production
//
// Builds exactly what the deploy job ships (SPEC §13.1) into out/<env>/:
//   web/                  the web build, including build-manifest.json
//   worker/index.js       the bundled Worker, deployed unchanged with `wrangler deploy --no-bundle`
//   build-manifest.json   commit, env, run, and SHA-256 of the Worker and every web file
// CI signs worker/index.js and build-manifest.json with actions/attest-build-provenance.
// Tests are not run here; the workflow runs them first.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { argValue, hostFor, isDeployEnv, readPublicKeys, readWranglerConfig, REPOSITORY, ROOT } from './lib';
import { hashAssets, MANIFEST_FILE, serializeManifest, sha256, type BuildManifest } from './manifest';

const env = argValue('--env');
if (!isDeployEnv(env)) {
  console.error('usage: pnpm build:release --env staging|production');
  process.exit(1);
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// --- pre-flight
const ISSUER = `https://${hostFor(env)}`;
const { vars } = readWranglerConfig(env);
if (vars.ISSUER !== ISSUER) fail(`ISSUER for ${env} must be exactly ${ISSUER}`);
if (!vars.ACTIVE_KID || vars.ACTIVE_KID.startsWith('REPLACE')) fail(`set ACTIVE_KID for ${env} (run: pnpm gen-key --env ${env})`);
if (!readPublicKeys(env).some((k) => k.kid === vars.ACTIVE_KID)) fail(`keys/${env}/${vars.ACTIVE_KID}.json is missing`);
if (!vars.TURNSTILE_SITE_KEY || vars.TURNSTILE_SITE_KEY.startsWith('REPLACE')) fail(`set TURNSTILE_SITE_KEY for ${env} in wrangler.toml`);
const webEnv = readFileSync(`${ROOT}apps/web/.env.${env}`, 'utf8');
if (!webEnv.includes(`VITE_TURNSTILE_SITE_KEY=${vars.TURNSTILE_SITE_KEY}`)) fail(`apps/web/.env.${env} must use the same Turnstile site key as wrangler.toml`);

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const commit = process.env.GITHUB_SHA ?? git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain') !== '';
const run = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;

// --- build
const exec = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
const OUT = `${ROOT}out/${env}`;
const DIST = `${ROOT}apps/web/dist`;
rmSync(OUT, { recursive: true, force: true });
rmSync(DIST, { recursive: true, force: true });

exec('pnpm', ['build:data']);
exec('pnpm', ['--filter', '@labkit/web', 'exec', 'vite', 'build', '--mode', env]);
exec('pnpm', ['--filter', '@labkit/worker', 'exec', 'wrangler', 'deploy', '--dry-run', '--env', env, '--outdir', `${OUT}/worker`]);

// Keep only the Worker module: the deploy uploads index.js alone (no source maps).
for (const f of readdirSync(`${OUT}/worker`)) if (f !== 'index.js') rmSync(`${OUT}/worker/${f}`, { recursive: true });
if (!existsSync(`${OUT}/worker/index.js`)) fail('wrangler did not produce worker/index.js');

const manifest: BuildManifest = {
  schema: 1,
  repository: process.env.GITHUB_REPOSITORY ?? REPOSITORY,
  commit,
  ...(dirty ? { dirty: true as const } : {}),
  env,
  run,
  worker: { file: 'index.js', sha256: sha256(readFileSync(`${OUT}/worker/index.js`)) },
  assets: hashAssets(DIST),
};
const text = serializeManifest(manifest);
writeFileSync(`${DIST}/${MANIFEST_FILE}`, text);
writeFileSync(`${OUT}/${MANIFEST_FILE}`, text);
cpSync(DIST, `${OUT}/web`, { recursive: true });

console.log(
  `✓ out/${env}: commit ${commit.slice(0, 12)}${dirty ? ' (dirty)' : ''}, worker ${manifest.worker.sha256.slice(0, 12)}, ${Object.keys(manifest.assets).length} web files`,
);
