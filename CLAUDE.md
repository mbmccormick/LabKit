# labkit.health — rules for Claude Code

Read SPEC.md before any work. Implement milestone by milestone (§16); do not start a milestone until the previous one's acceptance criteria pass.

## Hard rules

- **No real patient data in the repo.** Real reports live only in `fixtures/private/` (gitignored). Never copy their contents into tests, snapshots, commit messages, logs or error strings. Synthetic fixtures use fake names and values.
- **Card format is normative.** `packages/core` must reproduce `reference/example-payload.json` exactly (key order included). If you think the format should change, stop and ask; do not "improve" it.
- **Dictionary labels are frozen once released.** Never edit `loinc`, `display` or `text` of an entry listed in `dictionary/FROZEN.json`. Adding entries is fine.
- **Never log request bodies** or any patient/result field in the Worker. Metrics are counts only.
- **No third-party scripts, fonts, analytics or CDNs.** Self-host pdf.js, tesseract.js and all assets. Turnstile is the only external origin.
- **Never add immunization support** or SARS-CoV-2 codes to the signable set.
- **Private keys never touch the repo.** `keys/` holds public JWKs only.
- Look up current Cloudflare/Wrangler documentation for configuration syntax rather than relying on memory.

## Commands

- `pnpm test` (unit), `pnpm test:e2e`, `pnpm validate:card <file>`, `pnpm gen-key --env staging`
- `pnpm dev` (web + worker locally), `pnpm run deploy --env staging` (`pnpm deploy` is a pnpm built-in, so `run` is required)

## Definition of done for any change

Tests pass, the official SHC validator reports no errors on generated cards, and no new external origins appear in the CSP.
