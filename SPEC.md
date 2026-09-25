# labkit.health — Technical Product Spec

Version 1.0 · 2026-09-23 · Owner: Matt McCormick

## 0. How to use this document

This spec is written to be handed to Claude Code for implementation. It is prescriptive where a decision has already been made (and usually verified), and explicit where something is still an assumption to test. Anything marked **VERIFIED** was proven end-to-end on an iPhone during prototyping. Anything marked **ASSUMPTION** must be validated in Milestone 0 before the dependent work starts.

Companion files in `reference/`:

| File | Purpose |
|---|---|
| `shc_reference.py` | Reference encoder that produces the exact card shape Apple Health accepted. The TypeScript encoder must produce identical payloads for identical input. |
| `example-payload.json` | Decoded payload from the reference encoder (synthetic patient). |
| `example.smart-health-card` | Signed example card (synthetic, throwaway key). |
| `dictionary-seed.json` | 119 test definitions with verified LOINC codes, LOINC display names, UCUM units and categories. Seed for `dictionary/dictionary.json`. |

## 1. Product summary

labkit.health turns a lab report (PDF, or the ZIP "results of record" archive some portals export) into signed SMART Health Cards that import into Apple Health as structured lab results with trend charts. It targets labs whose results do not already flow into Apple Health through Health Records, primarily direct-to-consumer panels (Function Health, Superpower and similar) and Quest/Labcorp reports downloaded as PDFs.

### 1.1 Goals

1. Upload a lab report and get one importable card per collection date in under a minute on an iPhone.
2. Every value in a card is either parsed with high confidence or confirmed by the user on a review screen before signing.
3. Results for the same test merge into one trend in Apple Health across draws, across labs, and across months of use.
4. No health data is stored server-side, ever. No third-party scripts or trackers.
5. Cards are signed by `https://labkit.health` so Health can verify them (see §2.3).

### 1.2 Non-goals (v1)

- Immunization or COVID-19 cards of any kind (forgery risk; see §10).
- Interpreting results: no "optimal" ranges, no scores, no advice. Display and transfer only (keeps the product outside FDA device regulation; see §11).
- Accounts, history, or cloud sync.
- Android/Google Health Connect (no SHC import path there).
- Native iOS app.
- QR code output (real lab cards exceed single-QR capacity; see §9.3).

## 2. Background: how the pieces fit

### 2.1 SMART Health Cards

A SMART Health Card (SHC) is a compact JWS (ES256, P-256) whose payload is raw-DEFLATE-compressed JSON containing a FHIR R4 Bundle. The issuer (`iss`) is an HTTPS URL; verifiers fetch the issuer's public keys from `{iss}/.well-known/jwks.json`. Spec: https://spec.smarthealth.cards and https://hl7.org/fhir/uv/smart-health-cards-and-links/.

### 2.2 Apple Health behavior (observed)

| Behavior | Status |
|---|---|
| Health imports lab-result SHCs from issuers not in the VCI/CommonTrust directory. With no resolvable JWKS the card imports without the "Verified" badge. | **VERIFIED** |
| The source appears under Health as the issuer URL's hostname (e.g. `labkit.health`) with a gray single-letter monogram and the full `iss` beneath. There is no card field that sets a display name or logo. | **VERIFIED** (hostname display); logo not settable per available evidence |
| Results with an identical `code` structure (LOINC coding incl. `display`, plus `code.text`) merge into one trend across cards. | **VERIFIED** for identical structure; reported by LabCard (labcard.io) as the trend key |
| A resolvable JWKS at `{iss}/.well-known/jwks.json` produces the "Verified" badge even for non-directory issuers. | **ASSUMPTION** (LabCard reports this; not Apple-documented). Validate in M0. |
| `.smart-health-card` files open into Health from on-device storage. Files opened directly from iCloud Drive fail with "Can't add this data". | **VERIFIED** (on-device) / reported (iCloud failure) |
| `https://redirect.health.apple.com/SMARTHealthCard/#<numeric>` opens Health directly for lab cards, and works for large cards (~15–20k char URLs). | **ASSUMPTION**. Validate in M0. |
| Health deletes data per card (per source removal), not per result. | **VERIFIED** |

The whole product depends on Apple continuing to accept non-directory issuers. This is undocumented behavior Apple could change in any iOS release. Nothing in the design should make that failure catastrophic: files already imported remain, and the product degrades to "no new imports", not data loss.

### 2.3 Identity

- Production issuer: `https://labkit.health` (exact string, no trailing slash, never changes once cards are issued).
- Staging issuer: `https://staging.labkit.health` with its own key. Never sign anything with the production key outside production.
- Health will display the source as "labkit.health" with an "L" monogram.

## 3. User flow

1. **Landing** (`/`): one-sentence explanation, "Choose lab report" button, privacy summary, supported sources.
2. **Upload**: file picker accepting `.pdf`, `.zip`, `.jpg`, `.jpeg`, `.png`, `.heic`. Multiple files allowed. All processing happens in the browser.
3. **Parsing**: progress per file. OCR (if needed) is lazy-loaded with an explicit "This file is a scan; reading it may take a minute" notice.
4. **Review** (the core screen): one section per detected collection date. Each row shows test name (dictionary `text`), value, unit, reference range, source line snippet, and a confidence badge. Low-confidence rows are highlighted and must be individually confirmed or edited. A collapsible "Lines we couldn't match" list shows every unmapped result-like line so the user can add them manually (search dictionary → enter value). The user can exclude rows, split or merge draws, and edit the collection date/time.
5. **Sign**: one Turnstile check, one request for all cards (§7).
6. **Deliver**: per card, "Add to Apple Health" (iOS: redirect URL) and "Download file". Plain instructions: on iPhone, save the file to "On My iPhone", then open it from Files → Share → Health. On desktop: AirDrop or email the files to the iPhone.
7. **Done**: note that each card is a separate source entry in Health and that deleting a card removes all its results.

Nothing persists after the tab closes. No localStorage of health data.

## 4. Architecture

Single Cloudflare Worker with static assets. No database, no object storage, no queues.

```
Browser (all parsing, normalization, FHIR building, review)
   │  static:  GET /, /assets/*, /dictionary.json        ← Workers static assets
   │  keys:    GET /.well-known/jwks.json                ← Worker route
   │  sign:    POST /api/sign  {turnstileToken, cards[]} ← Worker route
   ▼
Cloudflare Worker ── signing key (Worker secret; Signer interface allows Azure Key Vault later)
   
iPhone Health ── GET https://labkit.health/.well-known/jwks.json (verification)
```

Design decision: the browser sends the **unsigned payload** to the Worker, which validates it against the dictionary and the lab-only rules before signing. Health data transits Worker memory but is never logged or stored. (The alternative, signing only a client-computed digest, keeps data on-device but makes the Worker a blind signing oracle for arbitrary content, including forged immunization cards. Rejected.)

## 5. Tech stack and repository layout

- Language: TypeScript (strict) everywhere. Node 22 LTS for tooling. pnpm workspaces.
- Web: Vite + Preact. No UI framework heavier than that; target < 150 KB gzipped initial JS excluding pdf.js/OCR, which are lazy-loaded.
- PDF: `pdfjs-dist` (self-hosted worker file). ZIP: `fflate`. OCR: `tesseract.js` with self-hosted core/worker/`eng.traineddata`.
- Compression: `fflate` `deflateSync` (raw DEFLATE, level 9) in the Worker.
- Validation: `zod`.
- Signing: WebCrypto (`crypto.subtle`, ECDSA P-256 / SHA-256). WebCrypto returns the raw 64-byte r||s signature JWS requires; do not DER-encode.
- Worker: Wrangler, Workers static assets, Turnstile, Workers Rate Limiting binding, Workers Analytics Engine (counts only).
- Tests: Vitest (unit), Playwright (e2e, iOS Safari/WebKit profile), health-cards-validation-SDK (CI).
- Look up current Cloudflare docs for exact Wrangler config syntax (assets binding, rate-limit binding, environments); do not guess from memory.

```
labkit/
  CLAUDE.md                      repo rules for Claude Code
  SPEC.md                        this document
  reference/                     reference encoder + seed dictionary (read-only)
  dictionary/
    dictionary.json              source of truth (§6); built into web + worker
    FROZEN.json                  hash of {loinc, display, text} per released entry
    CHANGELOG.md
  packages/
    core/                        pure TS, runs in browser, Worker and Node
      src/dictionary.ts          load, index by LOINC and by (vendor, panel, name)
      src/normalize.ts           value grammar, units, comparators, ranges
      src/fhir.ts                Patient/Observation/Bundle builders
      src/shc.ts                 payload assembly, numeric encoding, redirect URL, JWS parse (for tests)
      src/validate.ts            zod schemas shared by client and Worker
      src/types.ts
    parsers/
      src/intake.ts              magic-byte sniffing, ZIP expansion
      src/pdftext.ts             pdf.js positioned text extraction
      src/ocr.ts                 tesseract.js wrapper (lazy)
      src/layout.ts              row/column reconstruction
      src/vendors/quest-healthgorilla.ts
      src/vendors/quest-pdf.ts
      src/vendors/labcorp-pdf.ts
      src/vendors/generic.ts
      src/extract.ts             orchestrator → ParsedReport
  apps/
    web/                         Vite + Preact SPA
    worker/
      src/index.ts               router
      src/sign.ts                /api/sign
      src/jwks.ts                /.well-known/jwks.json
      src/signer.ts              Signer interface + WebCryptoSigner (+ AzureKeyVaultSigner later)
      src/turnstile.ts
      wrangler.toml              envs: staging, production
  keys/
    staging/<kid>.json           public JWKs only (committed)
    production/<kid>.json
  scripts/
    gen-key.ts                   create P-256 key; print private JWK for `wrangler secret put`; write public JWK
    validate-card.ts             run the official validator against a file
    make-fixture-pdf.ts          synthetic Quest/Labcorp-style PDFs (pdf-lib)
  fixtures/
    synthetic/                   committed synthetic reports + expected JSON
    private/                     real reports, gitignored, never committed
```

## 6. Test dictionary

The dictionary is the product's core asset. It maps what labs print to exactly one LOINC code, one canonical UCUM unit and one frozen label set.

### 6.1 Schema (`dictionary/dictionary.json`)

```ts
type DictionaryEntry = {
  loinc: string;                 // e.g. "1884-6"
  display: string;               // LOINC Long Common Name, verbatim. FROZEN after release.
  text: string;                  // short label shown in Health. FROZEN after release.
  category: 'lipids'|'cbc'|'metabolic'|'kidney_liver_electrolytes'|'thyroid'|'hormones'
          |'inflammation_autoimmune'|'nutrients_minerals'|'toxins'|'urinalysis'|'blood_type'|'other';
  valueType: 'quantity'|'qualitative'|'titer';
  ucum: string|null;             // canonical unit written to the card (quantity only)
  unitAliases?: Record<string,string>;           // printed unit → UCUM, entry-specific overrides
  unitConversions?: {from:string; factor:number}[]; // exact scalings only, e.g. /uL → 10*3/uL ×0.001
  answers?: string[];            // allowed qualitative values (normalized casing)
  plausible?: {min:number; max:number};          // physiological bounds in canonical unit; outside → parse error
  aliases: {vendor:'quest'|'labcorp'|'function'|'generic'; name:string; panel?:string}[];
  excludeFromSigning?: boolean;  // e.g. SARS-CoV-2 codes if ever added for recognition
};
```

### 6.2 Rules

1. **Freeze rule.** Apple Health's trend key includes `coding.display` and `code.text`. Once an entry ships to production, its `loinc`, `display` and `text` never change. CI computes a hash per released entry and fails if `FROZEN.json` disagrees. A label cannot be corrected later without splitting every user's existing trend for that test, so review all labels before the first production release.
2. Match on `(vendor, panel, name)` first, then `(vendor, name)`, then `(generic, name)`. Never match serum and urine analytes by name alone ("GLUCOSE", "ALBUMIN", "PROTEIN" exist in both).
3. A match is only valid if the printed unit resolves to the entry's `ucum` directly, via `unitAliases`, or via `unitConversions`. Otherwise the row goes to review as "unit mismatch".
4. Only exact scalar conversions (cells/µL → 10³/µL). No molar/mass conversions in v1.
5. Every quantity entry must have `plausible` bounds before release (CI check).
6. Seed: `reference/dictionary-seed.json` (119 entries, codes verified against LOINC, imported successfully into Health). It has Function Health aliases only; Quest and Labcorp aliases, unit aliases and plausibility bounds must be added from fixtures (M2).
7. LOINC is used under the LOINC license (free; requires attribution). Add the attribution notice to the Terms page (moved from About, 2026-09-24).

### 6.3 Global unit alias table (printed → UCUM)

| Printed | UCUM | Printed | UCUM |
|---|---|---|---|
| mg/dL | mg/dL | mcg/dL | ug/dL |
| ng/mL | ng/mL | pg/mL | pg/mL |
| ng/dL | ng/dL | mcg/L | ug/L |
| nmol/L | nmol/L | umol/L, µmol/L | umol/L |
| mmol/L | mmol/L | g/dL | g/dL |
| U/L | U/L | IU/mL | [IU]/mL |
| uIU/mL, µIU/mL | u[IU]/mL | mIU/mL | m[IU]/mL |
| mIU/L | m[IU]/L | % | % |
| % by wt | % | Thousand/uL, K/uL, x10E3/uL | 10*3/uL |
| Million/uL, M/uL, x10E6/uL | 10*6/uL | cells/uL | /uL |
| fL | fL | pg | pg |
| mL/min/1.73m2 | mL/min/{1.73_m2} | Angstrom, Å | Ao |
| (ratio, unitless) | {ratio} | specific gravity | 1 |
| pH | [pH] | /HPF | (qualitative in v1) |

Strip trailing annotations such as `(calc)` before lookup.

## 7. Signing API

### 7.1 `POST /api/sign`

Request (`application/json`, ≤ 512 KB):

```json
{
  "turnstileToken": "…",
  "cards": [ { "payload": { "iss": "https://labkit.health", "nbf": 0, "vc": { … } } } ]
}
```

Response 200:

```json
{ "cards": [ { "jws": "eyJ6aXAiOiJERUYi…", "kid": "…" } ] }
```

Errors: `{ "error": { "code": string, "message": string, "cardIndex"?: number, "path"?: string } }`

| Status | code | When |
|---|---|---|
| 400 | `invalid_payload` | schema or rule violation (§7.2); include `cardIndex` and JSON `path` |
| 403 | `turnstile_failed` | Turnstile siteverify failed |
| 413 | `too_large` | body > 512 KB, > 12 cards, or > 400 observations in a card |
| 429 | `rate_limited` | rate limit exceeded; include `Retry-After` |
| 500 | `signing_failed` | signer error (log code only) |

### 7.2 Server-side validation (all must pass; reject the whole request otherwise)

1. `iss` equals `env.ISSUER` exactly. `vc.type` equals exactly `["https://smarthealth.cards#health-card","https://smarthealth.cards#laboratory"]`.
2. `credentialSubject.fhirVersion === "4.0.1"`; `fhirBundle.type === "collection"`.
3. `entry[0]` is a Patient with only `name` (family + given), `birthDate`, optional `gender`; `fullUrl` `resource:0`. All other entries are Observations with `fullUrl` `resource:N` in order.
4. No `id`, `meta`, `text` (narrative), or extension elements anywhere. Strict schemas: unknown keys are rejected.
5. Every Observation: `status: "final"`, laboratory category exactly as in §8, `subject.reference: "resource:0"`, a single LOINC coding whose `code` exists in the dictionary and is not `excludeFromSigning`, and whose `display` and `code.text` equal the dictionary entry exactly.
6. Value type matches the entry: quantity → `valueQuantity` with finite `value`, `unit === code === entry.ucum`, `system` UCUM, optional `comparator` in `< <= > >=`; qualitative → `valueCodeableConcept` whose `text` is in `answers` when `answers` exists; titer → `valueCodeableConcept.text` matching `^1:\d+$`.
7. `referenceRange` (optional): at most one element; `low`/`high` have finite values and the same unit.
8. All Observations in a card share one `effectiveDateTime`, ISO 8601 UTC, not in the future, not before 1990-01-01.
9. The Worker sets `nbf` itself to `floor(effectiveDateTime / 1000)`; it ignores the client value.
10. No duplicate LOINC codes within a card.
11. Any immunization-related resource type or type URL is rejected with an explicit error.

### 7.3 Signing procedure (Worker)

1. Verify Turnstile via `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `env.TURNSTILE_SECRET` and the client IP.
2. Rate limit on `CF-Connecting-IP`: 20 requests / 10 minutes (tunable via env).
3. Validate (§7.2).
4. Serialize with `JSON.stringify(payload)` (no whitespace; key order as constructed by the shared builder).
5. `deflateSync(utf8, { level: 9 })` (raw DEFLATE, no zlib header).
6. Header: `{"zip":"DEF","alg":"ES256","kid":"<active kid>"}` serialized without whitespace.
7. Sign `base64url(header) + "." + base64url(deflated)` with ECDSA P-256/SHA-256; append `"." + base64url(r||s)`.
8. Verify the signature with the public key before returning (cheap defense against key/config errors).
9. Emit one Analytics Engine data point: `{cards, observations, status}`. Never log request bodies, patient fields, values or IPs beyond what the rate limiter needs.

### 7.4 `GET /.well-known/jwks.json`

Served by the Worker (not static assets) so headers are guaranteed:

- `Content-Type: application/json`
- `Access-Control-Allow-Origin: *`
- `Cache-Control: public, max-age=3600`
- Body: `{"keys":[…]}` built at deploy time from `keys/<env>/*.json`. Each key: `kty:"EC"`, `crv:"P-256"`, `x`, `y`, `kid` (RFC 7638 thumbprint), `use:"sig"`, `alg:"ES256"`. Never includes `d`.

`GET /api/health` returns `{ok:true, issuer, activeKid}` for monitoring.

## 8. Card format (normative)

Must match `reference/shc_reference.py` and `reference/example-payload.json`. The golden test (§15) enforces equality.

- One card per distinct collection datetime.
- Payload: `{ iss, nbf, vc: { type: [health-card, laboratory], credentialSubject: { fhirVersion: "4.0.1", fhirBundle } } }`.
- Patient: `{resourceType:"Patient", name:[{family, given:[…]}], birthDate, gender?}`. Name and birth date come from the report and are editable on the review screen.
- Observation, in this key order:

```json
{
  "resourceType": "Observation",
  "status": "final",
  "category": [{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/observation-category","code":"laboratory","display":"Laboratory"}]}],
  "code": {"coding":[{"system":"http://loinc.org","code":"1884-6","display":"Apolipoprotein B [Mass/volume] in Serum or Plasma"}],"text":"Apolipoprotein B"},
  "subject": {"reference":"resource:0"},
  "effectiveDateTime": "2026-04-17T13:40:00Z",
  "valueQuantity": {"value":88,"unit":"mg/dL","system":"http://unitsofmeasure.org","code":"mg/dL"},
  "referenceRange": [{"high":{"value":90,"unit":"mg/dL"}}]
}
```

- Qualitative: `valueCodeableConcept: {coding:[{system:"http://snomed.info/sct", code:"260385009", display:"Negative"}], text:"Negative"}`; Positive is `10828004`. Other qualitative values are text-only (`{"text":"1+"}`, `{"text":"Yellow"}`, `{"text":"None seen"}`).
- Titer: `valueCodeableConcept: {text:"1:40"}`.
- Numbers: emit as JSON numbers exactly as printed (`47.0` → `47`; preserve significant decimals such as `0.80` → `0.8`). Scaled values are rounded to 6 significant digits.
- `code.coding[0].display` and `code.text` are intentionally kept even though the SHC spec recommends omitting them for QR size; Health uses them for display and trend grouping. The official validator's warnings about them are expected.
- File: `{"verifiableCredential":["<jws>"]}`, MIME `application/smart-health-card`, name `labkit-YYYY-MM-DD.smart-health-card`.

## 9. Delivery

1. **Redirect link (iOS primary):** `https://redirect.health.apple.com/SMARTHealthCard/#` + numeric encoding of the JWS (each character → two digits, `charCode - 45`, zero-padded). Rendered as an "Add to Apple Health" button on iOS Safari only.
2. **File download (all platforms):** one file per card. Do not zip multiple cards (Health cannot import a ZIP).
3. **QR:** out of scope. A single SHC QR holds at most 1195 JWS characters; real lab cards are 2–8k characters, and chunked QR is deprecated.
4. Instruction copy must state: save to "On My iPhone" rather than iCloud Drive before opening, or use the Add to Apple Health button.

## 10. Abuse controls

A service that signs user-supplied data with a checkmark is a forgery tool if uncontrolled.

- Lab results only. Server rejects immunization types and any code not in the dictionary (§7.2), and SARS-CoV-2 test codes are never signable.
- Turnstile on every signing request; per-IP rate limiting.
- The About page and Terms state what the checkmark means: the card was produced by labkit.health and has not been altered since; it does not attest that values are correct or came from a lab.
- Incident plan: if the key is abused or leaked, rotate (§14), stop publishing the compromised public key only if cards signed with it must be invalidated (this invalidates every card that key signed; document the trade-off), and add SHC revocation (`rid` + CRL) in a later version.

## 11. Privacy, security and compliance

Requirements (get a short legal review before public launch; this list is not legal advice):

1. No persistence of health data anywhere: no database, no logs of request bodies, no Analytics Engine fields containing values, names, birth dates or report text. Disable Workers request logging of bodies; review Logpush and observability settings before launch.
2. No third-party scripts, fonts, pixels or analytics. All assets are first-party. Cloudflare Web Analytics is not used on any page. Rationale: FTC Health Breach Notification Rule and FTC enforcement against health apps sharing data with ad platforms.
3. Security headers on all HTML (via `_headers` for static assets; if the deployed Wrangler version doesn't apply `_headers` to assets, route HTML through the Worker and set them there):
   - `Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; img-src 'self' data: blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
   - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
   - `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`
4. Health data never enters URLs, query strings, localStorage, sessionStorage, IndexedDB or service-worker caches. The redirect link is generated on demand and only placed in an `href` the user taps.
5. State consumer-health-data laws (e.g. Washington My Health My Data Act): the design minimizes exposure by never collecting data, but the privacy policy must still describe the transient server-side processing during signing accurately.
6. FDA: stay within display/transfer of lab data. No interpretation, risk scores, "optimal" ranges or recommendations. Reference ranges come only from the lab report.
7. Pages: Privacy Policy, Terms (incl. LOINC attribution and Apple trademark notice), About (signature meaning, supported sources, "not medical advice", how to verify the deployment).
8. Users can verify that the deployed code matches the public repository (§13.1). *(Added 2026-09-25.)*

## 12. Parsing pipeline

Output type:

```ts
type ParsedReport = {
  source: {vendor: 'quest-healthgorilla'|'quest'|'labcorp'|'function'|'generic'; fileName: string; method: 'text'|'ocr'};
  patient: {family?: string; given?: string[]; birthDate?: string; gender?: 'male'|'female'};
  draws: {collectedAt: string /* ISO UTC */; rows: ParsedRow[]}[];
  unmatched: {text: string; page: number}[];
};
type ParsedRow = {
  raw: {name: string; value: string; flag?: string; range?: string; unit?: string; panel?: string; page: number; line: string};
  entry?: DictionaryEntry;                       // null if unmapped
  value?: {kind:'quantity'; value:number; comparator?:'<'|'<='|'>'|'>='; ucum:string}
        | {kind:'qualitative'|'titer'; text:string};
  range?: {low?: number; high?: number};
  confidence: 'high'|'medium'|'low';
  issues: ('ocr'|'unit_mismatch'|'implausible'|'ambiguous_match'|'duplicate'|'no_range')[];
};
```

### 12.1 Intake

Sniff magic bytes, not extensions: `%PDF` → PDF; `PK\x03\x04` → ZIP; JPEG/PNG/HEIC signatures → image. Function Health's "Lab Results of Record" downloads carry a `.pdf` extension but are ZIP archives of numbered per-page text files plus page images (Health Gorilla export). Expand ZIPs with fflate and route text files to the Health Gorilla template, images to OCR.

### 12.2 Text extraction

- PDF with text layer: `pdf.js getTextContent()` per page; keep each item's `str`, `transform` (x, y), `width`, `height`, font name. Reading order from pdf.js is not trustworthy; always reconstruct from coordinates.
- No/empty text layer or images: tesseract.js in a Web Worker, lazy-loaded on demand, with word-level boxes. Mark every row from OCR `method:'ocr'`; OCR rows can never be `high` confidence.

### 12.3 Layout reconstruction

1. Drop header/footer bands per vendor template (patient block, accession, ordering physician, page numbers, "Printed from Health Gorilla…" footer and confidentiality notice).
2. Group items into lines by y (tolerance ≈ 40% of median line height).
3. Find the column header line (vendor template tokens, e.g. Quest/Health Gorilla: `Test | In Range | Out Of Range | Reference Range | Previous Result | Date | Lab`; Labcorp: test, current result and flag, previous result and date, units, reference interval). Derive x-bands from header token positions.
4. Assign items to columns by x-band. Merge continuation lines: a line with only a Test-column fragment and no result column content, directly above or below a result line, belongs to that row's test name.
5. Detect panel headers and their `Collected: MM/DD/YYYY hh:mm AM/PM` stamps (Quest prints UTC). Rows inherit the nearest preceding panel's collection time. One report can contain multiple collection times; each becomes a draw.
6. **Ignore Previous Result and Date columns.** Pulling a previous value into the current draw is the most dangerous parse error.
7. Skip interpretive comment blocks (multi-line text under a result, reference tables such as desirable/borderline/high).

### 12.4 Value grammar

```
cell       := qual | titer | quantity
quantity   := [comparator] number
comparator := "<" | "<=" | ">" | ">=" | "< OR =" | "> OR ="     → normalized to < <= > >=
number     := digits ["." digits] | "." digits
titer      := "1:" digits
qual       := NEGATIVE | POSITIVE | NONE SEEN | NOT DETECTED | DETECTED | CLEAR | YELLOW | … | digit "+"
flag       := H | L | HH | LL | A | AA   (separate token following the value)
range      := number "-" number | comparator number | qual
```

### 12.5 Row confidence

- `high`: text layer, exact alias match (with panel when the name is ambiguous), unit resolves, value parses, within `plausible`, no duplicate.
- `medium`: one soft issue (fuzzy alias match, missing unit where the entry has a single canonical unit).
- A missing reference range (`no_range`) is informational only: it does not lower confidence or require confirmation, because it says nothing about whether the value was read correctly. The review screen notes "no reference range on report". *(Amended 2026-09-23.)*
- Reference ranges come only from the report: the range column, or, if that is empty, exactly one labelled `Reference range: …` line in the lab's comment under the result whose unit (if any) matches the result's. Risk tables, multiple candidate lines and per-condition ranges (e.g. AM/PM) are never used. *(Added 2026-09-23.)*
- `low`: OCR, unit mismatch, implausible value, ambiguous match, duplicate LOINC in the draw.
- Review UI requires explicit confirmation of every `medium`/`low` row. Rows with `implausible` or `unit_mismatch` cannot be signed until edited.

### 12.6 Vendor templates (priority order)

1. **quest-healthgorilla** (M2): text files from the ZIP; line-based rather than coordinate-based. Fixtures: real reports kept only in the gitignored `fixtures/private/` directory, with optional answer keys alongside them (never committed).
2. **quest-pdf** (M3): Quest's native PDF layout.
3. **labcorp-pdf** (M3): needs real fixtures before work starts.
4. **generic** (M3): header-token column detection with no vendor assumptions; everything medium or lower.
5. **LLM fallback** (post-v1, opt-in): send extracted text only, never page images, to an LLM under zero-data-retention terms with a strict JSON schema; results go through the identical normalization/validation path and are capped at `medium` confidence. Disabled by default; requires explicit per-upload consent explaining that report text leaves the device.

## 13. Configuration and environments

| Env | Hostname | ISSUER | Key dir |
|---|---|---|---|
| staging | staging.labkit.health | `https://staging.labkit.health` | `keys/staging/` |
| production | labkit.health | `https://labkit.health` | `keys/production/` |

Worker bindings / vars per environment:

| Name | Type | Notes |
|---|---|---|
| `ISSUER` | var | exact issuer string |
| `ACTIVE_KID` | var | kid of the current signing key |
| `SIGNING_KEY_JWK` | secret | private JWK (P-256, includes `d`) for `ACTIVE_KID` |
| `TURNSTILE_SITE_KEY` | var | also injected into the web build |
| `TURNSTILE_SECRET` | secret | |
| `RATE_LIMITER` | rate-limit binding | 20 req / 600 s per IP |
| `METRICS` | Analytics Engine dataset | counts only |
| `ASSETS` | static assets | `apps/web/dist` |

`www.labkit.health` → 301 to apex. HTTPS only; TLS 1.2 minimum (Cloudflare zone setting). DNS on Cloudflare; confirm the registrar supports `.health` (Cloudflare Registrar may not; register elsewhere and delegate nameservers if so).

### 13.1 Deployment and verification *(Added 2026-09-25.)*

Users send names, birth dates and results to the Worker, so they should be able to check that the deployed code is the code in the public repository. Cloudflare offers no remote attestation for Workers, so the guarantee is: every deployment is built and signed by GitHub Actions from a public commit; anyone can check the served web files against that build; the Worker's code is checked against the signed build at deploy time. The owner, GitHub and Cloudflare remain trusted, and `docs/verify.md` says so.

1. **Deploys come only from GitHub Actions** (`.github/workflows/deploy.yml`). A push to `main` deploys staging; a `v*` tag on a commit in `main` deploys production, gated by the `production` GitHub environment (required reviewer). There is no local deploy command. The Cloudflare API token lives only in the GitHub environments, scoped to the Workers permissions the deploy needs.
2. **Build once, deploy that build.** The `build` job (no secrets) runs typecheck, tests and the official validator, then `pnpm build:release --env <env>` writes `out/<env>/`: the web build, the Worker bundle (`worker/index.js`), and `build-manifest.json` (commit, env, workflow run, SHA-256 of the Worker bundle and of every web file). The bundle and manifest are signed with `actions/attest-build-provenance` (Sigstore). The `deploy` job verifies the attestation, then deploys the prebuilt bundle unchanged (`wrangler deploy --no-bundle`, version tagged with the commit).
3. **The site describes itself.** The manifest is served verbatim at `/.well-known/labkit-build.json`, with the Cloudflare version ID in the `LabKit-Worker-Version` header. The About page links the commit and explains how to verify.
4. **Anyone can verify:** `pnpm verify:deployment --env <env>` fetches the live manifest, checks its attestation with `gh attestation verify` (repo, signer workflow and commit enforced), then downloads every web file and compares hashes. `docs/verify.md` covers this and the manual equivalent.
5. **Deploy-time Worker check.** With a Cloudflare token (deploy job, or a manual `workflow_dispatch` run), the same command also reads the deployed version back from the Cloudflare API and fails unless: one version serves 100% of traffic, its code is exactly the signed Worker bundle, Logpush and observability are off, and there are no tail consumers. The result is in the public Actions log. Changes made later (dashboard edits, secret changes) are not continuously monitored; access controls cover that gap.
6. Secrets (`SIGNING_KEY_JWK`, `TURNSTILE_SECRET`) never pass through GitHub; the owner sets them in Cloudflare directly.

## 14. Key management

1. `pnpm gen-key --env staging|production` generates a P-256 key locally, computes the RFC 7638 thumbprint as `kid`, writes the public JWK to `keys/<env>/<kid>.json`, and prints the private JWK once for `wrangler secret put SIGNING_KEY_JWK --env <env>` (or the dashboard's Variables and Secrets page). The private key is never written to disk in the repo, and never passes through GitHub (§13.1).
2. The owner stores an encrypted offline backup of each production private key (password manager). Loss of the key means future cards need a new kid; existing cards keep verifying as long as the public key stays published.
3. Rotation: generate a new key, commit its public JWK, deploy (JWKS now lists both), switch `ACTIVE_KID` and the secret, deploy. **Never remove a public key from JWKS** unless deliberately invalidating every card it signed.
4. `Signer` interface (`sign(signingInput: Uint8Array): Promise<Uint8Array /* 64-byte r||s */>`) with `WebCryptoSigner` in v1. An `AzureKeyVaultSigner` (HSM-backed, non-exportable key, ES256 sign-digest API) can replace it later without touching callers; Key Vault returns raw r||s. (AWS KMS would return DER, requiring conversion.)
5. On startup the Worker checks that the public half of `SIGNING_KEY_JWK` matches `keys/<env>/<ACTIVE_KID>.json`; if not, `/api/sign` returns 500 and `/api/health` reports the mismatch.

## 15. Testing

| Layer | Requirement |
|---|---|
| Golden encoder test | Run `reference/shc_reference.py`'s inputs through the TS builder; decoded payload must deep-equal `reference/example-payload.json`. Round-trip: sign → parse JWS → inflate → equal payload; signature verifies with the public JWK. |
| Official validator | CI runs `health-cards-validation-SDK` (`--type healthcard`) on generated cards against the staging JWKS. Allowed warnings only: `display`/`text` present (intentional, §8), "JWS longer than 1195 characters" (no QR), and the FHIR-validator completeness notice. Any error fails CI. |
| Worker | Unit tests for every rule in §7.2 (one failing case each), size limits, rate-limit response, Turnstile failure (use Cloudflare's always-pass/always-fail test keys), JWKS headers, key/kid mismatch detection. |
| Dictionary | Schema validation; unique LOINC; every quantity entry has `ucum` and `plausible`; FROZEN hash check; every alias resolves uniquely per (vendor, panel). |
| Normalizer | Table-driven tests for the value grammar, comparators, unit aliases, conversions, qualitative casing, titers. |
| Parsers | Synthetic fixtures (committed, generated by `scripts/make-fixture-pdf.ts` mimicking each vendor layout, fake patients) with expected `ParsedReport` JSON. Private fixtures (gitignored) run locally with the same harness. Accuracy target on the five private Quest/Health Gorilla reports: 100% of mapped values correct, ≥ 98% of reported results mapped, 0 values taken from Previous Result columns. Report field-level diffs, not just pass/fail. |
| E2E | Playwright (WebKit + Chromium): upload synthetic PDF → review → edit a low-confidence row → sign against staging → download file → decode and verify the file. |
| Manual iOS checklist (each release) | Import via redirect button; import via file from On My iPhone; Verified badge present; source shows `labkit.health`; two cards with the same test merge into one trend; qualitative values display; comparator values (`<0.2`) display; removing the source removes its results. |

No real patient data in the repo, CI logs, test snapshots or error messages.

## 16. Milestones and acceptance criteria

**M0: Issuer spike (1–2 days, go/no-go).** Deploy the staging Worker with JWKS and a minimal `/api/sign` (no Turnstile yet, IP-restricted). Sign the reference card and a 100-observation card. On an iPhone, record: (a) does the Verified badge appear with a resolvable JWKS, (b) source name and icon, (c) does the redirect link work at ~15k and ~25k characters, (d) do trends merge across two cards. Write findings into §2.2. If (a) fails the product still works unverified; decide whether to proceed.

**M1: Core, manual entry, signing.** `packages/core`, dictionary pipeline with seed, full `/api/sign` with validation/Turnstile/rate limit, JWKS, web app with manual entry (search dictionary → enter values → review → sign → deliver). Accept: all §15 core/Worker/dictionary tests pass; official validator clean; manual iOS checklist passes on staging.

**M2: Quest / Health Gorilla ZIP parser.** Intake, ZIP handling, line-based template, draws from Collected stamps, Quest aliases added to the dictionary, review UI with confidence and unmatched lines. Accept: accuracy targets in §15 on the private fixtures.

**M3: PDFs and OCR.** pdf.js positioned extraction, quest-pdf, generic template, labcorp-pdf (fixtures permitting), lazy OCR. Accept: synthetic fixture suite passes; a 10-page text PDF parses in < 3 s on an iPhone 13-class device; OCR rows always require confirmation.

**M4: Launch hardening.** Production key and environment, security headers verified (securityheaders.com A), Privacy/Terms/About pages, logging audit (prove no bodies logged), rate-limit tuning, legal review, manual iOS checklist on production. Deployment verification (§13.1): staging and production deploy only through Actions, `pnpm verify:deployment` passes against both, and the deploy-time check is shown on staging to fail when the deployed code differs from the signed bundle or a tail consumer is added.

**Post-v1 candidates:** opt-in LLM fallback, SHC revocation (`rid` + CRL), Azure Key Vault signer, more vendors, localization, Function Health data import if Function ever offers a user-facing export API.

## 17. Risks and open questions

| Risk / question | Mitigation / owner |
|---|---|
| Apple stops accepting non-directory issuers or changes badge logic. | Existential; monitor each iOS beta. No mitigation within the product. |
| Verified badge assumption false. | M0 decides; product works without it. |
| Redirect URL length limits for large cards. | M0 measures; file download remains the fallback. |
| Does Health warn when the card's patient name/DOB differs from the Health profile? | M0: test with a mismatched synthetic name. |
| Maximum payload size Health accepts. | M0: test 100/300/400 observations; set server limit accordingly. |
| Parse error signed into a card (permanent in Health). | Confidence model, mandatory review, Previous-column exclusion, plausibility bounds. |
| Key compromise. | Secret scoped to prod env, offline backup, rotation runbook, Key Vault later. |
| Label mistakes are permanent (trend key). | Label review before first production release; FROZEN check. |
| `.health` registrar support on Cloudflare. | Check before purchase. |
| Legal/regulatory exposure. | §11 requirements plus counsel review before launch. |
