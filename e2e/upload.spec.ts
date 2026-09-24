import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { APPLE_REDIRECT_PREFIX, fromNumeric, parseJws, verifyJws, type PublicJwk } from '@labkit/core';

const FX = 'fixtures/synthetic/';
const SHOTS = process.env.E2E_SCREENSHOTS;

async function choose(page: Page, files: string[] | { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(files as never);
  await expect(page.getByRole('heading', { name: 'Check Your Results' })).toBeVisible({ timeout: 90_000 });
}

// Synthetic patient only.
test('Quest PDF → review → confirm flagged rows → sign → download → verify', async ({ page, request }, info) => {
  await choose(page, [FX + 'quest-sample.pdf']);

  await expect(page.getByText('Taylor Q Example · Born Mar 4, 1990 · Female')).toBeVisible();
  // Implausible sodium is locked out; unknown test is listed as unmatched.
  const sodium = page.locator('li.result', { hasText: 'Sodium' });
  await expect(sodium.getByText('Left Out')).toBeVisible();
  await expect(sodium.getByRole('button')).toHaveCount(0);
  await expect(page.getByText("Lines We Couldn't Match (1)")).toBeVisible();

  // A missing reference range is noted but doesn't need a tap (SPEC §12.5).
  await expect(page.locator('li.result', { hasText: 'LDL-Cholesterol' })).toContainText('no reference range on report');
  await expect(page.getByRole('button', { name: /^Confirm / })).toHaveCount(0);
  const create = page.getByRole('button', { name: 'Create 2 Cards' });
  await expect(create).toBeDisabled(); // until the attestation box is ticked
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/review-${info.project.name}.png`, fullPage: true });

  await page.getByLabel("I've reviewed and confirmed these results match my lab report").check();
  await create.click();
  await expect(page.getByRole('heading', { name: 'Your Cards Are Ready' })).toBeVisible({ timeout: 30_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/done-${info.project.name}.png`, fullPage: true });

  // One Buy Me a Coffee link (after the last card), opening in a new tab, self-hosted image.
  const coffee = page.getByRole('link', { name: 'Buy me a coffee' });
  await expect(coffee).toHaveCount(1);
  await expect(coffee).toHaveAttribute('href', 'https://buymeacoffee.com/mbmccormick');
  await expect(coffee).toHaveAttribute('target', '_blank');
  expect(await coffee.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0 && new URL(img.src).origin === location.origin)).toBe(true);

  const jwks = (await (await request.get('/.well-known/jwks.json')).json()) as { keys: PublicJwk[] };
  const buttons = page.getByRole('button', { name: 'Download File' });
  await expect(buttons).toHaveCount(2);
  const cards = [];
  for (let i = 0; i < 2; i++) {
    const dl = page.waitForEvent('download');
    await buttons.nth(i).click();
    const d = await dl;
    const jws = (JSON.parse(readFileSync((await d.path())!, 'utf8')) as { verifiableCredential: string[] }).verifiableCredential[0]!;
    const { header, payload } = parseJws(jws);
    expect(await verifyJws(jws, jwks.keys.find((k) => k.kid === header.kid)!)).toBe(true);
    cards.push({ name: d.suggestedFilename(), jws, payload: payload as never as { vc: { credentialSubject: { fhirBundle: { entry: { resource: Record<string, unknown> }[] } } } } });
  }
  const obs = (i: number) => cards[i]!.payload.vc.credentialSubject.fhirBundle.entry.slice(1).map((e) => e.resource);
  const first = obs(0);
  expect(first.map((o) => (o.effectiveDateTime as string))[0]).toBe('2026-04-17T13:40:00Z');
  expect(first.find((o) => (o.code as { text: string }).text === 'Neutrophils')!.valueQuantity).toMatchObject({ value: 3.12, unit: '10*3/uL' });
  expect(first.find((o) => (o.code as { text: string }).text === 'Urine glucose')!.valueCodeableConcept).toMatchObject({ text: 'Negative' });
  expect(first.find((o) => (o.code as { text: string }).text === 'Glucose')!.valueQuantity).toMatchObject({ value: 88 });
  expect(first.some((o) => (o.code as { text: string }).text === 'Sodium')).toBe(false);
  expect(obs(1).map((o) => (o.code as { text: string }).text)).toEqual(['Hemoglobin A1c', 'ANA screen', 'Thyroid-Stimulating Hormone', 'LDL small', 'Lipoprotein (a)']);

  const add = page.getByRole('link', { name: 'Add to Apple Health' });
  if (info.project.name.startsWith('webkit-iphone')) {
    expect(fromNumeric((await add.first().getAttribute('href'))!.slice(APPLE_REDIRECT_PREFIX.length))).toBe(cards[0]!.jws);
  } else {
    await expect(add).toHaveCount(0);
  }

  const stored = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie }));
  expect(stored).toBe('{"l":{},"s":{},"c":""}');
});

test('clicking the not-ready Create button goes to the next Review item, then the confirmation', async ({ page }) => {
  // The Labcorp sample has one result to review: a duplicate cholesterol.
  await choose(page, [FX + 'labcorp-sample.pdf']);
  await page.evaluate(() => scrollTo(0, 0));
  const next = page.locator('li.result.check').first();
  const button = page.getByRole('button', { name: '1 to Review' });
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  // force: Playwright waits for aria-disabled buttons to enable; a person can click them any time.
  await button.click({ force: true });
  await expect(next).toBeInViewport();
  await expect(next.getByRole('button', { name: /^Confirm / })).toBeFocused();

  // Resolve it, then the click goes to the confirmation checkbox.
  await next.getByRole('button', { name: /^Confirm / }).click();
  await page.evaluate(() => scrollTo(0, 0));
  const create = page.getByRole('button', { name: 'Create Card' });
  await create.click({ force: true });
  const box = page.getByLabel("I've reviewed and confirmed these results match my lab report");
  await expect(box).toBeInViewport();
  await expect(box).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Your Card Is Ready' })).toHaveCount(0);
});

test("Function Health 'results of record' (a ZIP with a .pdf name)", async ({ page }) => {
  await choose(page, [FX + 'function-results-of-record.pdf']);
  await expect(page.locator('li.result')).toHaveCount(21);
  await expect(page.getByRole('heading', { name: /^Collected / })).toHaveCount(2);
});

test('photo of a printed report is read with on-device OCR', async ({ page, browser }, info) => {
  test.slow();
  // Render a report-like table to a PNG, as a stand-in for a phone photo.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 620 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.setContent(`<body style="font:20px Arial;padding:30px;background:#fff">
    <div>Quest Diagnostics</div><div>Patient Name: EXAMPLE, TAYLOR Q</div><div>DOB: 03/04/1990 &nbsp; Sex: F</div><br>
    <table style="font:20px Arial;border-spacing:40px 6px">
    <tr><td>Test Name</td><td>In Range</td><td>Out Of Range</td><td>Reference Range</td><td>Lab</td></tr>
    <tr><td>LIPID PANEL, STANDARD</td></tr><tr><td>Collected: 04/17/2026 01:40 PM</td></tr>
    <tr><td>CHOLESTEROL, TOTAL</td><td>182</td><td></td><td>&lt;200 mg/dL</td><td>Z4M</td></tr>
    <tr><td>HDL CHOLESTEROL</td><td>58</td><td></td><td>&gt; OR = 40 mg/dL</td><td>Z4M</td></tr>
    <tr><td>TRIGLYCERIDES</td><td></td><td>162 H</td><td>&lt;150 mg/dL</td><td>Z4M</td></tr>
    </table></body>`);
  const png = await p.screenshot({ fullPage: true });
  await ctx.close();

  await choose(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: png }]);
  // OCR rows can never be high confidence: everything found needs a check.
  const results = page.locator('li.result');
  expect(await results.count()).toBeGreaterThanOrEqual(2);
  expect(await page.locator('li.result.included').count()).toBe(0);
  await expect(page.locator('li.result', { hasText: 'Total Cholesterol' })).toContainText('182 mg/dL');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ocr-${info.project.name}.png`, fullPage: true });
});

test('About shows Buy Me a Coffee; the header logo reloads the home page', async ({ page }) => {
  await page.goto('/about');
  await expect(page).toHaveTitle('About · LabKit');
  await expect(page.getByRole('link', { name: 'Buy me a coffee' })).toHaveAttribute('href', 'https://buymeacoffee.com/mbmccormick');
  // Open source: GitHub in the footer and on About, opening in a new tab.
  const gh = page.locator('footer').getByRole('link', { name: 'GitHub' });
  await expect(gh).toHaveAttribute('href', 'https://github.com/mbmccormick/LabKit');
  await expect(gh).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('heading', { name: 'Open Source' })).toBeVisible();

  // A real page load, not client-side routing: a marker set on this document disappears.
  await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
  await page.getByRole('link', { name: 'LabKit home' }).click();
  await page.waitForURL('/');
  await expect(page).toHaveTitle('LabKit · Add lab results to Apple Health');
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBeUndefined();
});

test('security headers on HTML', async ({ request }) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy']!;
  expect(csp).toContain("default-src 'self'");
  expect(csp.match(/https?:\/\/[^\s;]+/g)!.every((o) => o === 'https://challenges.cloudflare.com')).toBe(true);
  expect(res.headers()['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload');
});
