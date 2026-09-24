import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;

export default defineConfig({
  testDir: 'e2e',
  // Real reports only via `pnpm test:private:e2e` (failure snapshots would capture patient data).
  testIgnore: process.env.LABKIT_PRIVATE ? [] : ['private.spec.ts'],
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // Hard cap for the whole run. In CI a hung run once waited for GitHub's 6-hour job limit.
  globalTimeout: process.env.CI ? 6 * 60_000 : 0,
  // Line-per-test output: the CI default ("dot") prints no newlines, so progress was invisible in Actions logs.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'webkit-iphone', use: { ...devices['iPhone 15'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // The real Worker (wrangler dev) serving the built SPA. Needs apps/worker/.dev.vars
  // (`pnpm gen-key --env dev`), which uses Cloudflare's always-pass Turnstile test keys.
  webServer: {
    command: `pnpm --filter @labkit/worker exec wrangler dev --port ${PORT} --persist-to .wrangler/e2e-state --var ISSUER:https://localhost:${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
