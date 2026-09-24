# Dictionary changelog

Record every change to `dictionary.json` here. `loinc`, `display` and `text` of an entry in `FROZEN.json` must never change.

## 2026-09-23: first production release

- Froze all 119 entries in `FROZEN.json` (`loinc`, `display`, `text` are now permanent: Apple Health trend keys).

- Added Quest, Labcorp and generic aliases (463 total) from the labs' standard printed names; urinalysis names are scoped to the `urinalysis` panel so they never match serum tests. Unit aliases: `% of total Hgb` (HbA1c), `% (calc)` (iron saturation).

- Seeded 119 entries from `reference/dictionary-seed.json` (Function Health aliases only).
- Added `plausible` bounds (physiological sanity limits in the canonical unit) to all 99 quantity entries.
