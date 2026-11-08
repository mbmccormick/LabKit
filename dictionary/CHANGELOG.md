# Dictionary changelog

Record every change to `dictionary.json` here. `loinc`, `display` and `text` of an entry in `FROZEN.json` must never change.

## 2026-11-08: eGFR without a named equation (Randox)

- Added 69405-9 "Glomerular filtration rate [Volume Rate/Area] in Serum, Plasma or Blood by based on 1.73 sq M" (`text` "eGFR"; ACTIVE and `display` verbatim from LOINC 2.83 on tx.fhir.org). Its method names no equation, which matches Randox reports: they print eGFR without saying how it was calculated.
- Aliases are `randox` only ("eGFR", "Estimated Glomerular Filtration Rate", "Estimated GFR"), so Quest/Labcorp/generic "eGFR" still maps to 98979-8 (CKD-EPI 2021). The two codes form separate trends in Apple Health by design: merging them would mix equations.
- Rows with this code carry the `formula_not_printed` issue: never signed automatically, pending until the user opts in on the review screen.
- Not yet in `FROZEN.json`.

## 2026-11-07: Randox Health (UK, SI units)

- New alias vendor `randox` for Randox Health "Discovery" reports. Randox names (British spellings: Haemoglobin, Haematocrit, Oestradiol, Luteinising, Folic Acid; "(Urine)"/"(adjusted)" suffixes) added as aliases on existing entries. The parser also tries a name without a trailing abbreviation in parentheses ("Alanine Aminotransferase (ALT)"), only for `randox`.
- Exact scalar conversions, all vendors: `g/L` → `g/dL` (×0.1: haemoglobin, MCHC, albumin, total protein, globulin), `g/L` → `mg/dL` (×100: apolipoproteins, transferrin, immunoglobulins), `L/L` → `%` (×100, haematocrit). Global unit aliases `10*9/L` = `10*3/uL` and `10*12/L` = `10*6/uL` (Unicode superscripts `10⁹/L`, `10¹²/L` understood).
- Molar → mass conversions, **scoped to `randox` only** (`unitConversions[].vendors`), so Randox trends merge with Quest/Labcorp ones while US reports printed in SI still go to review as before (SPEC §6.2 rule 4, amended): cholesterol (total, HDL, LDL, non-HDL, small dense LDL) ×38.67, triglycerides ×88.57, glucose ×18.016, creatinine ÷88.4, uric acid ÷59.48, bilirubin ÷17.1, iron and TIBC ×5.585, calcium ×4.008, magnesium ×2.431, 25-OH vitamin D ÷2.496, free T4 ÷12.87, free T3 ×0.651, oestradiol ÷3.671, testosterone ×28.84, free testosterone ×288.4 (nmol/L) / ×0.2884 (pmol/L), DHEA-S ×36.85, cortisol ×0.0362446, insulin ÷6, prolactin ÷21.2 (mIU/L), C-peptide ×0.0030203 (pmol/L). Free T3 is ×0.651 (pmol/L → pg/mL), not ÷15.36.
- Exact-equivalence unit aliases: `ug/L` = `ng/mL` (ferritin, PSA, free PSA, C-peptide), `kU/L` = `[IU]/mL` (RF, IgE, ASO, anti-Tg, anti-TPO), `U/L`/`IU/L` = `m[IU]/mL` (FSH, LH), `mIU/L` (prolactin), `mg/L` = `ug/mL` (TBG). Entry unit aliases now also match case-insensitively ("ng/l"), except where M/m (mega/milli) could be confused.
- Added 23 entries (codes, `display` verbatim and ACTIVE checked against LOINC 2.83 on tx.fhir.org): 1988-5 CRP, 2157-6 creatine kinase, 59261-8 HbA1c (IFCC, mmol/mol: its conversion to NGSP % is a regression, not a scaling, so it keeps its own code), 1986-9 C-peptide, 30000-4 microalbumin/creatinine ratio (mg/mmol; 14959-1 is the mass ratio), 29265-6 albumin-corrected calcium (moles), 14879-1 phosphate (moles), 22664-7 urea (moles), 1805-1 pancreatic amylase (not 1805-2, which fails the check digit), 14866-8 PTH (moles), 19113-0 IgE, 2458-8/2465-3/2472-9 IgA/IgG/IgM, 5370-2 ASO, 3021-3 TBG, 3034-6 transferrin, 1874-7 ApoB/ApoA-I ratio, 1876-2/1877-0/1886-1 ApoC-II/C-III/E, 90364-1 small dense LDL cholesterol, 5818-0 urine urobilinogen. A new test with no existing US-unit entry gets the moles code rather than a converted mass code.
- Not added: eGFR (Randox doesn't print the equation; the only eGFR code here is CKD-EPI 2021), Total Antioxidant Status, Lp(a) mg/dL ↔ nmol/L (never converted). LDL is mapped to 13457-7 (calculated), as for other vendors; confirm Randox's method on a real report.
- Not yet in `FROZEN.json`. Review the new `text` labels and confirm an import into Apple Health before the next production release.

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
