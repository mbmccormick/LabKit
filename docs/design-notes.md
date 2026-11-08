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
- **Re-check a live deployment** without deploying: Actions → verify → Run workflow (from `main`), choose the environment ([verify.yml](../.github/workflows/verify.yml)). Production needs your approval, as it uses the `production` environment's token.

The `build` job has no secrets. It runs typecheck, tests and the validator, then `pnpm build:release --env <env>`, and signs `out/<env>/worker/index.js` and `out/<env>/build-manifest.json`. The `deploy` job verifies those signatures, deploys the prebuilt bundle with `wrangler deploy --no-bundle` (tagged with the commit), runs `pnpm smoke`, then `pnpm verify:deployment --expect …` with the Cloudflare token. That also reads the deployed version back from Cloudflare and fails unless it holds exactly the signed bundle and `_headers`, one version serves all traffic, Logpush and Workers Logs are off, and there are no tail consumers. Users run the same command without the token; see [verify.md](verify.md).

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
- **Collection times:** a zone printed on the stamp always wins. Quest's own reports print the performing site's US zone ("Collected: 09/29/2020 / 11:00 EDT", per Quest's published sample reports); fixed abbreviations (EST, PDT, …) use their offset and the generic ones (ET, CT, MT, PT) follow DST. Unzoned Quest (PDF and Health Gorilla) times are read as UTC per SPEC §12.3.5; Labcorp ("0905 Local") and generic as the browser's local time. A date with no time is midnight local, so it shows on the printed date. Confirm on real reports.
- **Optimal ranges:** consumer reports print their own "optimal"/target range beside the lab's. The generic template gives that column the `ignore` role so it is never read (SPEC §11.6) and can't spill into the reference-range column.
- **Function Health PDFs** contain the Health Gorilla render followed by Quest's own report (same results, date only) and a history table of earlier results. Only the Health Gorilla pages are read; column headers never carry across pages, so history tables can't be read as current results.
- **Function ZIPs:** when a ZIP has per-page text files, the page images are not OCR'd (they duplicate the text).
- **`plausible` bounds** were added to all 99 quantity entries (wide physiological limits). Please review them. They are not frozen.
- **Randox Health** (`packages/parsers/src/vendors/randox.ts`, added 2026-11-07, from synthetic fixtures only; confirm with `pnpm test:private` on real reports):
  - Detected by `Randox` (any case; real reports draw the logo as an image and print only "Randox Health") + `Results for your Doctor` + `randoxhealth.com`. Only lines from the line that reads exactly "Results for your Doctor" (not the contents entry, which has a page number) up to "Nutrition Guide" are read; marketing pages and bar graphs never are.
  - Rows are rebuilt from coordinates, not from table.ts: each line with a Result cell is a row; name, unit and band fragments between two rows are split at the widest vertical gap (row padding), or by nearness when lines are evenly spaced. "not" / "detected" results that wrap are joined. Panel headings: a known heading form, a bigger font, or no row within 1.5 line heights.
  - Reference range: the band labelled Optimal (or Normal/Negative…), else the only band. This is the range Randox prints as its reference range, read from the report (SPEC §11.6). The H/L flag is computed from the value against the bands (the report shows out-of-range only by colour); it is shown on the review screen only, as the card format has no interpretation field.
  - The same test in several panels with the same value is kept once; the range comes from the first panel other than Metabolic Syndrome. Different values for one test stay as duplicates for the user to choose.
  - Left out entirely (counted in a warning, not listed as unmatched): vitals and body measurements, cardiovascular risk score and FIB-4 (risk scores, SPEC §11.6; no QRISK3 LOINC exists).
  - eGFR (added 2026-11-08): the equation isn't printed, so it maps to 69405-9 (no equation named), never to the CKD-EPI 2021 code. The row carries `formula_not_printed` and stays pending until the user includes it; the review screen says it won't join eGFR results from other labs.
  - Collection time "Sample Collection Date DD-Mon-YYYY HH:mm" is read as Europe/London wall-clock time; DOB is day-first. Issued date and fasting duration are not used (no card field).
  - Molar → mass conversions apply to Randox only (SPEC §6.2 rule 4, amended); see `dictionary/CHANGELOG.md`. The factors are the conventional clinical ones (e.g. cholesterol ×38.67), so a converted value can differ from the lab's own mg/dL figure in the last digit.
  - Synthetic fixture `fixtures/synthetic/randox-sample.pdf` uses Liberation Sans (embedded via `@pdf-lib/fontkit`) for ≤/≥/µ/¹²; that font has no ⁹, so it prints `10^9/L` (`10⁹/L` is covered by unit tests).
- **Randox vitals → Apple Health** (added 2026-11-07): body measurements, pulse, SpO₂ and blood pressure are no longer dropped. The Randox template returns them as `vitals` (never card rows; Glucose stays a lab result). One copy per metric (the Metabolic Syndrome repeat is ignored; copies that disagree need review); BP ranges are ignored; values outside `VITAL_BOUNDS` or with unusable units are left out. The review screen's "Vitals (Not in Card)" section builds files in the browser only (no Worker call, no new origins): `labkit-vitals` JSON v1 (`packages/core/src/vitals.ts`; `reportId` is the SHA-256 of the sample ID, no patient identity) and a Health CSV Importer CSV. CSV columns follow the developer's type catalog (checked 2026-11-07): `Start Date,End Date,height (m),weight (kg),body mass index (count),waist circumference (cm),heart rate (count/min),oxygen (%),systolic (mmHg),diastolic (mmHg)`, one row, ISO 8601 with offset. Unconfirmed until a manual import: several types in one file, and whether `oxygen (%)` expects 98 or 0.98 (we write 98). Hip circumference has no importer type, so it is JSON-only.
