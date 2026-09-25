# M0: issuer spike (go/no-go)

Goal: prove Apple Health's behaviour with the labkit.health issuer before building parsers. Record results in SPEC §2.2 (flip ASSUMPTION → VERIFIED/FALSE) and §17.

## 1. Deploy staging

1. Cloudflare: add `labkit.health` to the account (DNS on Cloudflare), create a Turnstile widget for `staging.labkit.health`.
2. `pnpm gen-key --env staging`. Put the printed private JWK in your password manager, then:
   `pnpm --filter @labkit/worker exec wrangler secret put SIGNING_KEY_JWK --env staging`
3. `pnpm --filter @labkit/worker exec wrangler secret put TURNSTILE_SECRET --env staging`
4. In `apps/worker/wrangler.toml` `[env.staging.vars]` set `ACTIVE_KID` (printed by gen-key) and `TURNSTILE_SITE_KEY`; put the same site key in `apps/web/.env.staging`.
5. Commit `keys/staging/<kid>.json` and push to `main`; the deploy workflow ships staging and smoke-tests `/api/health`, the JWKS and headers. *(Updated 2026-09-25: deploys run only in GitHub Actions.)*
6. `pnpm validate:card <any staging card>` (no `--jwks`) validates against the live staging JWKS.

## 2. Make the test cards

`pnpm m0-cards` (paste the staging private JWK when prompted; it is not stored). Writes `out/m0/*.smart-health-card` and `out/m0/links.html`.

| Card | Tests |
|---|---|
| 01-reference | Verified badge, source name/monogram, `<0.2` comparator, qualitative and titer display |
| 02-trend-a + 03-trend-b | Same tests on two dates merge into one trend |
| 04-name-mismatch | Does Health warn when name/DOB differ from the profile? |
| 05-100-obs, 06-all-119-obs | 100 observations; ~14k and ~15.6k character redirect URLs |
| probe-25k-url, probe-300-obs, probe-400-obs | Duplicate-code PROBES (not producible by the Worker) for ~25k URLs and max payload size |

## 3. Record on the iPhone

AirDrop `out/m0/` to the iPhone, save to **On My iPhone**, open `links.html` for the redirect links, and import files via Files → Share → Health.

- [ ] (a) Verified badge shown with the resolvable JWKS? _____
- [ ] (b) Source name and icon: _____
- [ ] (c) Redirect link works at ~14k / ~15.6k / ~25k characters? _____ / _____ / _____
- [ ] (d) Trends merge across 02 and 03? _____
- [ ] Name/DOB mismatch warning? _____
- [ ] Largest observation count that imports (100 / 119 / 300 / 400): _____ → set `LIMITS.maxObservationsPerCard` in `packages/core/src/validate.ts` accordingly
- [ ] iCloud Drive open fails ("Can't add this data") as reported? _____

If (a) fails, the product still works unverified: decide whether to proceed.
