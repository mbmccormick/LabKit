// pnpm run deploy --env staging|production
// (`pnpm deploy` is a pnpm built-in, so this must be invoked with `run`.)
//
// Pre-flight checks, build, deploy, then a smoke test of the live issuer.
import { execFileSync } from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import { request } from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { argValue, readPublicKeys, ROOT } from './lib';

const env = argValue('--env');
if (env !== 'staging' && env !== 'production') {
  console.error('usage: pnpm run deploy --env staging|production');
  process.exit(1);
}
const HOST = env === 'production' ? 'labkit.health' : 'staging.labkit.health';
const ISSUER = `https://${HOST}`;

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// --- pre-flight
const toml = readFileSync(`${ROOT}apps/worker/wrangler.toml`, 'utf8');
const section = toml.split(/^\[env\./m).find((s) => s.startsWith(`${env}.vars]`));
if (!section) fail(`[env.${env}.vars] missing from wrangler.toml`);
const vars = Object.fromEntries([...section.matchAll(/^(\w+)\s*=\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]));
if (vars.ISSUER !== ISSUER) fail(`ISSUER for ${env} must be exactly ${ISSUER}`);
if (!vars.ACTIVE_KID || vars.ACTIVE_KID.startsWith('REPLACE')) fail(`set ACTIVE_KID for ${env} (run: pnpm gen-key --env ${env})`);
if (!readPublicKeys(env).some((k) => k.kid === vars.ACTIVE_KID)) fail(`keys/${env}/${vars.ACTIVE_KID}.json is missing`);
if (!vars.TURNSTILE_SITE_KEY || vars.TURNSTILE_SITE_KEY.startsWith('REPLACE')) fail(`set TURNSTILE_SITE_KEY for ${env} in wrangler.toml`);
const webEnv = readFileSync(`${ROOT}apps/web/.env.${env}`, 'utf8');
if (!webEnv.includes(`VITE_TURNSTILE_SITE_KEY=${vars.TURNSTILE_SITE_KEY}`)) fail(`apps/web/.env.${env} must use the same Turnstile site key as wrangler.toml`);
if (!existsSync(`${ROOT}tools/health-cards-dev-tools/js/src/api.js`)) fail('install the SHC validator first: bash scripts/setup-validator.sh');

if (env === 'production') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Deploy to PRODUCTION (${ISSUER}, kid ${vars.ACTIVE_KID})? Type "production" to continue: `);
  rl.close();
  if (answer.trim() !== 'production') fail('aborted');
}

const run = (cmd: string, args: string[], cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

// --- test + build + deploy
run('pnpm', ['test']);
run('pnpm', ['--filter', '@labkit/web', 'exec', 'vite', 'build', '--mode', env]);
// Optional: upload secrets with this deployment (e.g. the output of `gen-key --secret-out`).
const secretsFile = argValue('--secrets-file');
run('pnpm', ['--filter', '@labkit/worker', 'exec', 'wrangler', 'deploy', '--env', env, ...(secretsFile ? ['--secrets-file', secretsFile] : [])]);

// --- smoke test
// Resolve through public DNS: a new custom domain can take a while to reach local/corporate resolvers.
const resolver = new Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8']);
let ip = '';
for (let attempt = 0; attempt < 12 && !ip; attempt++) {
  ip = (await resolver.resolve4(HOST).catch(() => []))[0] ?? '';
  if (!ip) await new Promise((r) => setTimeout(r, 5000));
}
if (!ip) fail(`${HOST} does not resolve in public DNS yet; re-run the smoke test later`);

type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
function get(path: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: HOST, servername: HOST, path, headers: { 'Cache-Control': 'no-cache' }, lookup: (_h, opts, cb) => (opts.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)) },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const health = JSON.parse((await get('/api/health')).body) as { ok: boolean; issuer: string; activeKid: string; error?: string };
if (!health.ok) fail(`/api/health reports ${health.error ?? 'not ok'}. Is SIGNING_KEY_JWK set for ${env}? (wrangler secret put SIGNING_KEY_JWK --env ${env})`);
if (health.issuer !== ISSUER || health.activeKid !== vars.ACTIVE_KID) fail(`/api/health returned unexpected issuer/kid: ${JSON.stringify(health)}`);
const jwksRes = await get('/.well-known/jwks.json');
const jwks = JSON.parse(jwksRes.body) as { keys: { kid: string }[] };
if (jwksRes.headers['access-control-allow-origin'] !== '*') fail('JWKS is missing Access-Control-Allow-Origin: *');
if (!jwks.keys.some((k) => k.kid === vars.ACTIVE_KID)) fail('JWKS does not list ACTIVE_KID');
for (const k of readPublicKeys(env)) if (!jwks.keys.some((j) => j.kid === k.kid)) fail(`JWKS dropped key ${k.kid}. Never remove a published key (SPEC §14.3).`);
const home = await get('/');
if (!String(home.headers['content-security-policy'] ?? '').includes("default-src 'self'")) fail('security headers missing on HTML');
console.log(`✓ ${env} deployed: ${ISSUER} (kid ${vars.ACTIVE_KID}, ${jwks.keys.length} published key(s))`);
