# Dictionary changelog

Record every change to `dictionary.json` here. `loinc`, `display` and `text` of an entry in `FROZEN.json` must never change.

## 2026-10-19: common direct-to-consumer markers, portal spellings

- Added 5 entries that consumer panels (Function Health, Superpower and similar) and routine Quest/Labcorp orders include: 2132-9 Vitamin B12, 2284-8 Folate, 19123-9 Magnesium (serum), 1869-7 Apolipoprotein A1, 33863-2 Cystatin C. Codes and `display` (Long Common Name) were checked against LOINC 2.82 listings (loinc.org, findacode.com) and lab test catalogs (ARUP, Mayo, Labcorp). Exact-equivalent unit aliases only: `ng/L` = `pg/mL` (B12), `ug/L` = `ng/mL` (folate).
- Added generic aliases for names consumer reports print: `CRP-hs`, `Fasting Insulin`, `Fasting Glucose`/`Glucose, Fasting`, `A1C`, `ALP`, `Transferrin Saturation`, `Total Iron Binding Capacity`, `Urea Nitrogen`, `Free Thyroxine`, `PSA`.
- Added 2 entries that Quest and Labcorp print on routine panels and were left unmatched: 3097-3 BUN/Creatinine Ratio (CMP; unit `{ratio}`, as for the albumin/globulin ratio) and 13458-5 VLDL Cholesterol (Labcorp lipid panel, "VLDL Cholesterol Cal"). Both ACTIVE in LOINC 2.82 (tx.fhir.org); `display` is the Long Common Name verbatim (NLM Clinical Tables). Aliases are the names on Labcorp's and Quest's published sample reports.
- `uIU/mL` → `m[IU]/L` unit alias on TSH (3016-3): Labcorp's printed unit, exactly equal (1 µIU/mL = 1 mIU/L).
- `mEq/L` → `mmol/L` unit alias on sodium, potassium, chloride and carbon dioxide only (monovalent, so 1 mEq = 1 mmol). Never global: for calcium and magnesium 1 mEq/L = 0.5 mmol/L.
- Not yet in `FROZEN.json`. Confirm an import into Apple Health and review the `text` labels before the next production release.

## 2026-09-24: 24-hour urine (Labcorp Litholink)

- Added 21 entries for Labcorp's Litholink 24-Hour Urine Panel (test 910235). Codes are Labcorp's own published LOINC map for that test, each checked against LOINC 2.82 (tx.fhir.org, NLM Clinical Tables): all ACTIVE, `display` is the Long Common Name verbatim, and every code is a 24-hour urine concept.
- Aliases are scoped to the new `24h urine` panel (any urine panel heading that says 24 hr/hour), because Labcorp prints the same names ("Creatinine, Urine") for spot urine tests in mg/dL.
- Left out: Protein Catabolic Rate (Labcorp maps it to 93746-6, which is g/24 h, but prints g/kg/24 hr) and Calcium/Kg Body Weight (Labcorp lists no LOINC).
- Shipped to production in v1.0.1 (2026-09-25). Frozen in `FROZEN.json` on 2026-10-19 (140 entries total).

## 2026-09-23: first production release

- Froze all 119 entries in `FROZEN.json` (`loinc`, `display`, `text` are now permanent: Apple Health trend keys).

- Added Quest, Labcorp and generic aliases (463 total) from the labs' standard printed names; urinalysis names are scoped to the `urinalysis` panel so they never match serum tests. Unit aliases: `% of total Hgb` (HbA1c), `% (calc)` (iron saturation).

- Seeded 119 entries from `reference/dictionary-seed.json` (Function Health aliases only).
- Added `plausible` bounds (physiological sanity limits in the canonical unit) to all 99 quantity entries.
