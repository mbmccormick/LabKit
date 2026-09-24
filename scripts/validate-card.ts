// pnpm validate:card <file.smart-health-card> [--jwks <jwks.json>]
//
// Runs the official SMART Health Cards validator (SPEC §15). Without --jwks the
// validator downloads {iss}/.well-known/jwks.json (CI runs this against staging).
// With --jwks the given key set is registered for the card's issuer, so cards
// can be validated before the issuer is deployed.
//
// Fails on any error, and on any warning outside the allow-list:
//   - display/text present (intentional, SPEC §8)
//   - JWS longer than 1195 characters (no QR, SPEC §9.3)
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseJws } from '@labkit/core';
import { argValue, ROOT } from './lib';

const VALIDATOR = `${ROOT}tools/health-cards-dev-tools/js/src/`;

export type ValidatorMessage = { message: string; code: number; level: number };

const LEVEL = { warning: 2, error: 3 } as const;

export function isAllowedWarning(m: ValidatorMessage): boolean {
  if (/should not include \.(display|text) elements/.test(m.message)) return true;
  if (/JWS is longer than 1195 characters/.test(m.message)) return true;
  return false;
}

export async function validateCardFile(path: string, jwksPath?: string): Promise<{ ok: boolean; problems: ValidatorMessage[]; allowed: number }> {
  if (!existsSync(`${VALIDATOR}api.js`)) {
    throw new Error('The SHC validator is not installed. Run: bash scripts/setup-validator.sh');
  }
  const require = createRequire(import.meta.url);
  const api = require(`${VALIDATOR}api.js`) as {
    validate: { healthcard(json: string, opts: object): Promise<ValidatorMessage[]> };
  };
  const text = readFileSync(path, 'utf8');
  const messages: ValidatorMessage[] = [];

  if (jwksPath) {
    const { verifyAndImportHealthCardIssuerKey } = require(`${VALIDATOR}shcKeyValidator.js`) as {
      verifyAndImportHealthCardIssuerKey(keySet: unknown, time?: number, log?: unknown, issuer?: string): Promise<{ flatten(): ValidatorMessage[] }>;
    };
    const card = JSON.parse(text) as { verifiableCredential: string[] };
    const iss = String(parseJws(card.verifiableCredential[0]!).payload.iss);
    const keyLog = await verifyAndImportHealthCardIssuerKey(JSON.parse(readFileSync(jwksPath, 'utf8')), undefined, undefined, iss);
    messages.push(...keyLog.flatten().map((e) => ({ message: e.message, code: e.code, level: e.level })));
  }

  messages.push(...(await api.validate.healthcard(text, { logLevel: LEVEL.warning, skipJwksDownload: !!jwksPath })));
  const relevant = messages.filter((m) => m.level >= LEVEL.warning);
  const problems = relevant.filter((m) => m.level >= LEVEL.error || !isAllowedWarning(m));
  return { ok: problems.length === 0, problems, allowed: relevant.length - problems.length };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain) {
  const file = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--jwks');
  if (!file) {
    console.error('usage: pnpm validate:card <file.smart-health-card> [--jwks <jwks.json>]');
    process.exit(2);
  }
  const result = await validateCardFile(file, argValue('--jwks'));
  for (const p of result.problems) console.error(`${p.level >= LEVEL.error ? 'ERROR' : 'WARNING'} [${p.code}] ${p.message}`);
  console.log(`${result.ok ? 'PASS' : 'FAIL'}: ${result.problems.length} problem(s), ${result.allowed} allowed warning(s) (display/text present, JWS > 1195 chars).`);
  process.exit(result.ok ? 0 : 1);
}
