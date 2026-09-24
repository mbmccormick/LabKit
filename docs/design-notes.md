# Design notes

Operational details and decisions that differ from, or refine, [SPEC.md](../SPEC.md).

## Environments and secrets

Per SPEC §13. Vars are in [apps/worker/wrangler.toml](apps/worker/wrangler.toml); secrets are set with `wrangler secret put <NAME> --env <env>`:

- `SIGNING_KEY_JWK`: private JWK for `ACTIVE_KID`. `/api/health` returns 503 and `/api/sign` 500 if it doesn't match `keys/<env>/<ACTIVE_KID>.json`.
- `TURNSTILE_SECRET`

The Turnstile **site** key goes in both `wrangler.toml` (`TURNSTILE_SITE_KEY`) and `apps/web/.env.<env>` (baked into the build). The deploy script checks they match.

## Key rotation (SPEC §14)

1. `pnpm gen-key --env <env>`; back up the private JWK offline.
2. Commit the new `keys/<env>/<kid>.json`, deploy (the JWKS now lists both keys).
3. `wrangler secret put SIGNING_KEY_JWK --env <env>`, set `ACTIVE_KID`, deploy.
4. **Never delete an old public key** unless you intend to invalidate every card it signed.

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
