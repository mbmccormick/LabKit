// pnpm smoke --env staging|production
//
// Smoke test of a live deployment (run by the deploy job after `wrangler deploy`):
// /api/health, the JWKS (never drops a published key) and security headers.
import { Resolver } from 'node:dns/promises';
import { request } from 'node:https';
import { argValue, hostFor, isDeployEnv, readPublicKeys, readWranglerConfig } from './lib';

const env = argValue('--env');
if (!isDeployEnv(env)) {
  console.error('usage: pnpm smoke --env staging|production');
  process.exit(1);
}
const HOST = hostFor(env);
const ISSUER = `https://${HOST}`;
const { vars } = readWranglerConfig(env);

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

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
