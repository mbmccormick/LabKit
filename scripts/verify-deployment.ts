// pnpm verify:deployment --env staging|production [--repo owner/name] [--expect out/<env>/build-manifest.json]
//
// Checks that a live deployment is the signed build of a public commit (SPEC §13.1):
//   1. fetches /.well-known/labkit-build.json
//   2. `gh attestation verify`: signed by this repo's deploy workflow, from the commit it names
//   3. downloads every web file and compares its SHA-256 with the manifest
//   4. with CLOUDFLARE_API_TOKEN set (the deploy job): reads the deployed Worker back from
//      Cloudflare and checks its code and logging settings (see checkCloudflare)
// Needs the GitHub CLI, signed in (`gh auth login`).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argValue, DEPLOY_WORKFLOW, hostFor, isDeployEnv, readWranglerConfig, REPOSITORY } from './lib';
import { parseManifest, type BuildManifest } from './manifest';
import { checkAssets, checkCloudflare, cloudflareApi, type Check } from './verify';

const env = argValue('--env');
if (!isDeployEnv(env)) {
  console.error('usage: pnpm verify:deployment --env staging|production [--repo owner/name] [--expect <build-manifest.json>]');
  process.exit(1);
}
const repo = argValue('--repo') ?? REPOSITORY;
const expectPath = argValue('--expect');
const origin = `https://${hostFor(env)}`;

const checks: Check[] = [];
const report = (c: Check) => {
  checks.push(c);
  console.log(`${c.ok ? '✓' : '✗'} ${c.label}`);
  if (c.detail) console.log(c.detail.replace(/^/gm, '    '));
};
function finish(): never {
  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed ? `\n✗ ${origin}: ${failed} check(s) failed` : `\n✓ ${origin} matches the signed build`);
  process.exit(failed ? 1 : 0);
}

// 1. Live manifest
const res = await fetch(`${origin}/.well-known/labkit-build.json`, { headers: { 'Cache-Control': 'no-cache' } });
const text = await res.text();
let manifest: BuildManifest;
try {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  manifest = parseManifest(text);
} catch (err) {
  report({ ok: false, label: `no valid build manifest at ${origin}/.well-known/labkit-build.json`, detail: err instanceof Error ? err.message : String(err) });
  finish();
}
const liveVersion = res.headers.get('LabKit-Worker-Version');
console.log(`${origin}: commit ${manifest.commit} (${env === manifest.env ? manifest.env : `manifest says ${manifest.env}`})`);
console.log(`  source  https://github.com/${repo}/tree/${manifest.commit}`);
if (manifest.run) console.log(`  build   ${manifest.run}`);
if (liveVersion) console.log(`  Cloudflare version ${liveVersion}`);
console.log('');

report({ ok: manifest.env === env, label: `manifest is for ${env}` });
if (manifest.dirty) report({ ok: false, label: 'manifest is from a build with uncommitted changes' });
if (expectPath) {
  report({ ok: readFileSync(expectPath, 'utf8') === text, label: `live manifest is byte-identical to ${expectPath}` });
}

// 2. Attestation: signed by this repository's deploy workflow on a GitHub-hosted runner, from the commit it names.
const dir = mkdtempSync(join(tmpdir(), 'labkit-verify-'));
const manifestFile = join(dir, 'build-manifest.json');
writeFileSync(manifestFile, text);
const ghArgs = ['attestation', 'verify', manifestFile, '--repo', repo, '--signer-workflow', `${repo}/${DEPLOY_WORKFLOW}`, '--source-digest', manifest.commit, '--deny-self-hosted-runners'];
try {
  execFileSync('gh', ghArgs, { stdio: 'pipe' });
  report({ ok: true, label: `manifest signed by ${repo}/${DEPLOY_WORKFLOW} at commit ${manifest.commit.slice(0, 12)}` });
} catch (err) {
  const e = err as { code?: string; stderr?: Buffer };
  const detail = e.code === 'ENOENT' ? 'GitHub CLI not found: install it from https://cli.github.com and run `gh auth login`' : (e.stderr?.toString().trim() ?? String(err));
  report({ ok: false, label: 'manifest signature did not verify', detail });
}

// 3. Web files
report(await checkAssets((u, i) => fetch(u, i), origin, manifest));

// 4. Deployed Worker (needs Cloudflare account access; the deploy job has it)
const token = process.env.CLOUDFLARE_API_TOKEN;
if (token) {
  const { name, accountId } = readWranglerConfig(env);
  try {
    const { checks: cf, versionId } = await checkCloudflare(cloudflareApi(token), accountId, `${name}-${env}`, manifest);
    cf.forEach(report);
    if (versionId && liveVersion) report({ ok: versionId === liveVersion, label: `the site is served by version ${versionId}` });
  } catch (err) {
    report({ ok: false, label: 'could not read the deployment from Cloudflare', detail: err instanceof Error ? err.message : String(err) });
  }
} else {
  console.log(`· Worker code: checked against the signed bundle when it was deployed; see ${manifest.run ?? 'the deploy run in GitHub Actions'}`);
}

finish();
