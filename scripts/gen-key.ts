// pnpm gen-key --env staging|production|dev
// Generates a P-256 key, writes the PUBLIC JWK to keys/<env>/<kid>.json and
// prints the private JWK once for `wrangler secret put`. The private key is
// never written into the repo (for --env dev it goes to the gitignored
// apps/worker/.dev.vars for local development only).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { jwkThumbprint, toPublicJwk } from '@labkit/core';
import { argValue, ENVS, ROOT, type KeyEnv } from './lib';

const env = argValue('--env') as KeyEnv | undefined;
if (!env || !ENVS.includes(env)) {
  console.error(`usage: pnpm gen-key --env ${ENVS.join('|')}`);
  process.exit(1);
}

const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const priv = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey & { x: string; y: string; d: string };
const kid = await jwkThumbprint({ kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y });
const pub = toPublicJwk(priv, kid);
const privateJwk = JSON.stringify({ kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, d: priv.d, kid });

mkdirSync(`${ROOT}keys/${env}`, { recursive: true });
writeFileSync(`${ROOT}keys/${env}/${kid}.json`, JSON.stringify(pub, null, 2) + '\n');
console.log(`Wrote public key keys/${env}/${kid}.json`);

const secretOut = argValue('--secret-out');
if (secretOut && env !== 'dev') {
  // Write the private JWK to a file (mode 600) for `pnpm run deploy --secrets-file`, instead of printing it.
  const { appendFileSync, chmodSync } = await import('node:fs');
  appendFileSync(secretOut, `SIGNING_KEY_JWK=${privateJwk}\n`, { mode: 0o600 });
  chmodSync(secretOut, 0o600);
  console.log(`Wrote the private JWK to ${secretOut} (not printed). Set ACTIVE_KID = "${kid}" under [env.${env}.vars].`);
} else if (env === 'dev') {
  const path = `${ROOT}apps/worker/.dev.vars`;
  const keep = existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l && !/^(SIGNING_KEY_JWK|ACTIVE_KID)=/.test(l))
    : ['TURNSTILE_SECRET=1x0000000000000000000000000000000AA'];
  writeFileSync(path, [...keep, `ACTIVE_KID=${kid}`, `SIGNING_KEY_JWK=${privateJwk}`, ''].join('\n'));
  console.log('Wrote apps/worker/.dev.vars (gitignored) with the dev signing key.');
} else {
  console.log(`
Next steps (${env}):
  1. Store this private JWK in your password manager (encrypted offline backup), then:
       pnpm --filter @labkit/worker exec wrangler secret put SIGNING_KEY_JWK --env ${env}
     and paste:

${privateJwk}

  2. Commit keys/${env}/${kid}.json and deploy once so the JWKS lists the new key.
  3. Set ACTIVE_KID = "${kid}" under [env.${env}.vars] in apps/worker/wrangler.toml and deploy again.
  Never remove an old public key from keys/${env}/ (SPEC §14.3).
`);
}
