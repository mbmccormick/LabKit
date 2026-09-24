# LabKit

**Add your lab results to Apple Health.** · [labkit.health](https://labkit.health)

LabKit turns a lab report (a PDF from Quest, Labcorp or another lab, or a photo of a printed report) into a signed [SMART Health Card](https://spec.smarthealth.cards). Apple Health imports the card as structured lab results, with trend charts across draws, even for labs that don't connect to Health Records.

- **Private by design.** Your report is read entirely in your browser. The file never leaves your device, and nothing is stored anywhere.
- **No typing.** LabKit reads the results, units, reference ranges and collection date. You review anything it's unsure about, then tap **Add to Apple Health**.
- **No interpretation.** LabKit moves your results; it doesn't score them, suggest "optimal" ranges or give medical advice.

## How it works

```
Your browser                                            Cloudflare Worker
─────────────────────────────────────────────           ─────────────────────────────
PDF / photo ─▶ pdf.js or on-device OCR                  POST /api/sign
           ─▶ layout reconstruction (columns, panels,     • Turnstile + per-IP rate limit
              wrapped names, collection times)            • validates every card rule
           ─▶ LOINC dictionary match + unit checks        • signs (ES256), stores nothing
           ─▶ review screen ─▶ card payload ──────────▶   • returns the signed card
                                                ◀──────   GET /.well-known/jwks.json
Add to Apple Health (iPhone) or download the card file      (public keys, for verification)
```

1. **Read.** [pdf.js](https://mozilla.github.io/pdf.js/) extracts positioned text (or [tesseract.js](https://tesseract.projectnaptha.com/) reads scans and photos). LabKit rebuilds the results table from coordinates, never trusting reading order, and never reads "Previous Result" columns.
2. **Match.** Each test name is matched to exactly one [LOINC](https://loinc.org) code in LabKit's [dictionary](dictionary/dictionary.json), with unit conversion and plausibility checks. Anything uncertain is marked **Review**; anything it can't trust is left out.
3. **Sign.** Only the final card contents are sent, once, to a Cloudflare Worker. It checks them against strict rules (lab results only, dictionary codes only, no immunization records), signs them, and keeps nothing.
4. **Add.** On iPhone, **Add to Apple Health** opens Health directly; elsewhere, download the `.smart-health-card` file and open it on your iPhone.

Cards are signed by `https://labkit.health`, so Apple Health shows them as verified. A signature means LabKit created the card and it hasn't been changed; it doesn't certify that the values are correct.

## Supported reports

| Source | Status |
|---|---|
| Quest Diagnostics PDF | Supported |
| Quest "results of record" PDF delivered via Health Gorilla | Supported; validated on real reports |
| Labcorp PDF | Supported; tested on synthetic reports only |
| Other lab PDFs with a results table | Best effort (generic layout); results need review |
| Scans and photos (JPEG, PNG, HEIC) | On-device OCR; every result needs review |

Found a report LabKit can't read? Open an issue describing the lab and layout. **Please never attach a real report** or anything with real names, dates or values.

## Privacy and security

- No accounts, cookies, analytics, ads or third-party scripts. The only external service is [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/), loaded only when you create a card.
- A strict Content Security Policy is enforced on every response; tests fail if a new external origin appears.
- The signing Worker never logs request bodies or any patient or result field. Metrics are counts only.
- Private signing keys live only in Cloudflare Worker secrets. [`keys/`](keys) holds public keys.

See the [Privacy](https://labkit.health/privacy) and [Terms](https://labkit.health/terms) pages.

**Reporting a vulnerability:** please use GitHub's [private vulnerability reporting](../../security/advisories/new) rather than a public issue. See [SECURITY.md](SECURITY.md).

## Development

Requires Node 22 and pnpm.

```bash
pnpm install
bash scripts/setup-validator.sh     # official SMART Health Cards validator (built into tools/)
pnpm gen-key --env dev              # local signing key → apps/worker/.dev.vars (gitignored)
npx playwright install chromium webkit
pnpm dev                            # http://localhost:8787 (Worker + app), http://localhost:5173 (Vite)
```

Local development uses Cloudflare's test Turnstile keys, so no Cloudflare account is needed.

| Command | What it does |
|---|---|
| `pnpm dev` | Run the Worker and web app locally |
| `pnpm test` | Unit tests: card encoder (golden test), signing rules, parsers, dictionary, Worker, and the official validator on signed cards |
| `pnpm test:e2e` | End-to-end tests in WebKit (iPhone) and Chromium against the real local Worker |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm fixtures` | Regenerate the synthetic test reports in `fixtures/synthetic/` |
| `pnpm validate:card <file>` | Run the official validator on a `.smart-health-card` file |
| `pnpm test:private`, `pnpm test:private:e2e` | Accuracy runs on your own reports in `fixtures/private/` (gitignored; output is counts and paths only) |

### Project layout

```
apps/web/           Vite + Preact app: choose report → review → sign → deliver
apps/worker/        Cloudflare Worker: /api/sign, /.well-known/jwks.json, /api/health, static assets
packages/core/      FHIR + SMART Health Card builders, normalizer, dictionary, signing rules
packages/parsers/   Intake, pdf.js text, OCR, layout reconstruction, lab templates
dictionary/         Test dictionary (LOINC codes, labels, units, aliases) and frozen-label hashes
fixtures/synthetic/ Generated test reports with fake patients, and their expected results
e2e/                Playwright tests
scripts/            Key generation, build data, deploy, validator wrapper, fixture generator
docs/               Design notes, iOS test checklist
```

[SPEC.md](SPEC.md) is the full technical specification, and [docs/design-notes.md](docs/design-notes.md) records operational details and decisions.

### Running your own instance

LabKit deploys to Cloudflare Workers (see `apps/worker/wrangler.toml`). A self-hosted instance signs cards with **its own** issuer URL and key, generated with `pnpm gen-key`; set `ISSUER`, `ACTIVE_KID` and your Turnstile keys, then `pnpm run deploy --env <env>`. Cards from your instance show your domain in Apple Health, not labkit.health.

## Contributing

Issues and pull requests are welcome. A few rules protect users and the card format:

- **No real patient data**, ever: not in code, tests, fixtures, issues or commit messages. Use `pnpm fixtures` to build synthetic reports.
- **The card format is fixed.** `packages/core` must reproduce [`reference/example-payload.json`](reference/example-payload.json) exactly.
- **Released dictionary labels never change** (`loinc`, `display`, `text` of entries in `dictionary/FROZEN.json`): Apple Health uses them to group results into trends. Adding entries and aliases is fine.
- **No third-party scripts, fonts or CDNs.** Everything is self-hosted.
- **Lab results only.** No immunization or COVID-19 support.
- Tests must pass, the official validator must report no errors on generated cards, and the Content Security Policy must not gain new origins.

## Support

LabKit is free. If it's useful to you, you can [buy me a coffee](https://buymeacoffee.com/mbmccormick).

## Acknowledgements and notices

- [SMART Health Cards](https://spec.smarthealth.cards) framework and the [official validator](https://github.com/smart-on-fhir/health-cards-dev-tools).
- [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) and [tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0), self-hosted.
- This material contains content from LOINC® (https://loinc.org). LOINC is copyright © Regenstrief Institute, Inc. and the Logical Observation Identifiers Names and Codes (LOINC) Committee and is available at no cost under the license at https://loinc.org/license. LOINC® is a registered United States trademark of Regenstrief Institute, Inc.
- Apple, the Apple logo, Apple Health, and iPhone are trademarks of Apple Inc., registered in the U.S. and other countries. LabKit is not affiliated with or endorsed by Apple.

LabKit is not a medical device and does not provide medical advice.

## License

[Apache License 2.0](LICENSE). The license doesn't cover the LabKit name or the labkit.health signing identity, or the third-party content listed in [NOTICE](NOTICE) (LOINC, Apple and Buy Me a Coffee artwork).
