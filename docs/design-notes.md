# Design notes

Operational details and decisions that differ from, or refine, [SPEC.md](../SPEC.md).

## Environments and secrets

Per SPEC §13. Vars are in [apps/worker/wrangler.toml](apps/worker/wrangler.toml). Secrets never pass through GitHub: set them in the Cloudflare dashboard (Workers → labkit-<env> → Settings → Variables and Secrets) or with `wrangler secret put <NAME> --env <env>`:

- `SIGNING_KEY_JWK`: private JWK for `ACTIVE_KID`. `/api/health` returns 503 and `/api/sign` 500 if it doesn't match `keys/<env>/<ACTIVE_KID>.json`.
- `TURNSTILE_SECRET`

The Turnstile **site** key goes in both `wrangler.toml` (`TURNSTILE_SITE_KEY`) and `apps/web/.env.<env>` (baked into the build). `pnpm build:release` checks they match.

## Key rotation (SPEC §14)

1. `pnpm gen-key --env <env>`; back up the private JWK offline.
2. Commit the new `keys/<env>/<kid>.json` and deploy (see below); the JWKS now lists both keys.
3. Set the `SIGNING_KEY_JWK` secret, commit the new `ACTIVE_KID`, deploy.
4. **Never delete an old public key** unless you intend to invalidate every card it signed.

## Deployment (SPEC §13.1)

Deploys run only in [.github/workflows/deploy.yml](../.github/workflows/deploy.yml):

- **Staging:** push to `main`.
- **Production:** push a `v*` tag on a commit in `main` (`git tag v1.2.0 && git push origin v1.2.0`), then approve the run in the `production` environment.
- **Re-check a live deployment** without deploying: Actions → deploy → Run workflow (from `main`), choose the environment.

The `build` job has no secrets. It runs typecheck, tests and the validator, then `pnpm build:release --env <env>`, and signs `out/<env>/worker/index.js` and `out/<env>/build-manifest.json`. The `deploy` job verifies those signatures, deploys the prebuilt bundle with `wrangler deploy --no-bundle` (tagged with the commit), runs `pnpm smoke`, then `pnpm verify:deployment --expect …` with the Cloudflare token. That also reads the deployed version back from Cloudflare and fails unless its code is the signed bundle, one version serves all traffic, Logpush and Workers Logs are off, and there are no tail consumers. Users run the same command without the token; see [verify.md](verify.md).

Changing a secret in Cloudflare creates a new Worker version with the same code, so a re-check still passes. Any code change made outside the workflow fails the next check.

### One-time setup

**Cloudflare**

1. Create an API token (My Profile → API Tokens → Create Token → *Edit Cloudflare Workers* template), limited to this account and the `labkit.health` zone. Create one token per environment, or share one.
2. Revoke any older broad tokens, and run `wrangler logout` on machines that used to deploy.
3. Keep account membership to the owner.

**GitHub** (Settings)

1. **Environments → `staging`:** deployment branches: `main` only. Secret `CLOUDFLARE_API_TOKEN`.
2. **Environments → `production`:** required reviewer: the owner; prevent self-review off (solo maintainer); deployment branches and tags: `main` (for manual re-checks) and tags `v*`. Secret `CLOUDFLARE_API_TOKEN`.
3. **Rules → Rulesets:**
   - `main`: block force pushes and deletion, and require the `ci` workflow's `test` check.
   - Tags `v*`: restrict creation, update and deletion to the owner (bypass list).
4. **Code security:** keep private vulnerability reporting on, and Dependabot version updates for GitHub Actions if wanted (actions are pinned to commit SHAs).
5. [.github/CODEOWNERS](../.github/CODEOWNERS) requires owner review for workflows, the Worker, scripts and keys.

## Works with Apple Health badge

The home page shows Apple's badge from `apps/web/public/badges/works-with-apple-health.svg` (Apple's `SVG_onscreen/ENGLISH/Apple_Health_badge_US-UK_blk_sRGB.svg`, unmodified; the page hides the badge if the file is missing). Source: https://developer.apple.com/licensing-trademarks/works-with-apple-health/ (Apple Developer account required). Apple licenses this badge for HealthKit-enabled apps; LabKit is a website, so its use here is the owner's decision, made knowingly.

## CI

GitHub Actions runs typecheck and unit tests (including the official SHC validator) on every push, capped at 10 minutes; a new push cancels the previous run. End-to-end tests run in CI only when started by hand (Actions → ci → Run workflow), capped at 15 minutes, because they once hung on Linux runners until GitHub's 6-hour default. Run them locally with `pnpm test:e2e`.

## Deviations from the spec to review

- **Rate limit:** the Workers rate-limit binding only supports 10 s or 60 s periods, so "20 requests / 600 s" can't be expressed. Configured as **10 / 60 s** per IP; tune in M4.
- **Security headers** are set by the Worker on every response (`run_worker_first = true`), since `_headers` does not apply to Worker-generated responses. `_headers` is kept in sync as a fallback (a test enforces equality).
- **SHC validator:** the SDK is now `smart-on-fhir/health-cards-dev-tools`. With a local key set, `validate-card` registers the keys for the card's issuer so the validator's own signature check runs.
- **No typing anywhere** (owner decision): the review screen offers only "Matches my report" / "Leave out" per flagged row and "Include" per collection. Rows with blocking issues (implausible, unit mismatch, unreadable, ambiguous) are left out and can't be included; SPEC §3's manual add/edit, split/merge draws and date editing are not offered. Reports without a readable name + DOB can't be signed.
- **Quest/Labcorp aliases** were added from those labs' standard printed names, not from real fixtures (SPEC §6.2 rule 6 expects fixtures). Verify with `pnpm test:private`.
- **Collection times:** Quest (PDF and Health Gorilla) stamps are read as UTC per SPEC §12.3.5; Labcorp and generic as the browser's local time. Confirm on real reports.
- **Function Health PDFs** contain the Health Gorilla render followed by Quest's own report (same results, date only) and a history table of earlier results. Only the Health Gorilla pages are read; column headers never carry across pages, so history tables can't be read as current results.
- **Function ZIPs:** when a ZIP has per-page text files, the page images are not OCR'd (they duplicate the text).
- **`plausible` bounds** were added to all 99 quantity entries (wide physiological limits). Please review them. They are not frozen.
