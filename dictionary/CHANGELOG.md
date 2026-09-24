# Dictionary changelog

Record every change to `dictionary.json` here. `loinc`, `display` and `text` of an entry in `FROZEN.json` must never change.

## 2026-09-24: 24-hour urine (Labcorp Litholink)

- Added 21 entries for Labcorp's Litholink 24-Hour Urine Panel (test 910235). Codes are Labcorp's own published LOINC map for that test, each checked against LOINC 2.82 (tx.fhir.org, NLM Clinical Tables): all ACTIVE, `display` is the Long Common Name verbatim, and every code is a 24-hour urine concept.
- Aliases are scoped to the new `24h urine` panel (any urine panel heading that says 24 hr/hour), because Labcorp prints the same names ("Creatinine, Urine") for spot urine tests in mg/dL.
- Left out: Protein Catabolic Rate (Labcorp maps it to 93746-6, which is g/24 h, but prints g/kg/24 hr) and Calcium/Kg Body Weight (Labcorp lists no LOINC).
- Not yet in `FROZEN.json`. Confirm an import into Apple Health and review the `text` labels before the next production release.

## 2026-09-23: first production release

- Froze all 119 entries in `FROZEN.json` (`loinc`, `display`, `text` are now permanent: Apple Health trend keys).

- Added Quest, Labcorp and generic aliases (463 total) from the labs' standard printed names; urinalysis names are scoped to the `urinalysis` panel so they never match serum tests. Unit aliases: `% of total Hgb` (HbA1c), `% (calc)` (iron saturation).

- Seeded 119 entries from `reference/dictionary-seed.json` (Function Health aliases only).
- Added `plausible` bounds (physiological sanity limits in the canonical unit) to all 99 quantity entries.
