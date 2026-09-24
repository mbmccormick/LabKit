// Real reports in fixtures/private/ (gitignored), run locally only. Asserts and
// prints counts only: no names, dates or values in output or artifacts.
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { parseJws, verifyJws, type PublicJwk } from '@labkit/core';
import { validateCardFile } from '../scripts/validate-card';

const DIR = 'fixtures/private/';
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => !f.startsWith('.') && !f.endsWith('.json')) : [];

// No traces, screenshots or videos: they would capture real patient data.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test.describe('private reports', () => {
  test.skip(files.length === 0, 'no files in fixtures/private/');

  for (const f of files) {
    test(`private report #${files.indexOf(f) + 1}`, async ({ page, request }) => {
      test.slow();
      await page.goto('/');
      await page.locator('input[type=file]').setInputFiles(DIR + f);
      await expect(page.getByRole('heading', { name: 'Check Your Results' })).toBeVisible({ timeout: 120_000 });

      const results = page.locator('li.result');
      const total = await results.count();
      const locked = await page.locator('li.result.problem').count();
      const confirms = page.getByRole('button', { name: /^Confirm / });
      const pending = await confirms.count();
      for (let i = 0; i < pending; i++) await confirms.first().click();
      // Readiness messages name rule outcomes/test labels only (no values).
      const problems = await page.locator('ul.errors li').allTextContents();
      if (problems.length) throw new Error(`not ready: ${problems.join(' | ')}`);
      await page.getByLabel("I've reviewed and confirmed these results match my lab report").check();
      const create = page.getByRole('button', { name: /^Create/ });
      await expect(create).toBeEnabled();
      await create.click();
      await expect(page.getByRole('heading', { name: /Ready$/ })).toBeVisible({ timeout: 30_000 });

      const jwks = (await (await request.get('/.well-known/jwks.json')).json()) as { keys: PublicJwk[] };
      const buttons = page.getByRole('button', { name: 'Download File' });
      const cards = await buttons.count();
      const tmp = mkdtempSync(join(tmpdir(), 'labkit-private-'));
      try {
        writeFileSync(join(tmp, 'jwks.json'), JSON.stringify(jwks));
        let observations = 0;
        for (let i = 0; i < cards; i++) {
          const dl = page.waitForEvent('download');
          await buttons.nth(i).click();
          const path = join(tmp, `card-${i}.smart-health-card`);
          await (await dl).saveAs(path);
          const jws = (JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8')) as { verifiableCredential: string[] }).verifiableCredential[0]!;
          const { header, payload } = parseJws(jws);
          expect(await verifyJws(jws, jwks.keys.find((k) => k.kid === header.kid)!)).toBe(true);
          observations += (payload as { vc: { credentialSubject: { fhirBundle: { entry: unknown[] } } } }).vc.credentialSubject.fhirBundle.entry.length - 1;
          const v = await validateCardFile(path, join(tmp, 'jwks.json'));
          console.log(`  card ${i + 1}: validator problems=${v.problems.length} allowedWarnings=${v.allowed} codes=${[...new Set(v.problems.map((p) => p.code))].join(',')}`);
          expect(v.problems.map((p) => p.code)).toEqual([]);
        }
        console.log(`report #${files.indexOf(f) + 1}: shown=${total} lockedOut=${locked} confirmed=${pending} cards=${cards} signedObservations=${observations}`);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }
});
