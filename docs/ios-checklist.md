# Manual iOS checklist (every release; SPEC §15)

Run on the target environment (staging for M1, production for M4) with a synthetic patient.

- [ ] Import via the **Add to Apple Health** button (iOS Safari)
- [ ] Import via a downloaded file saved to **On My iPhone**, opened from Files → Share → Health
- [ ] Verified badge present
- [ ] Source shows `labkit.health` (or `staging.labkit.health`)
- [ ] Two cards with the same test merge into one trend
- [ ] Qualitative values display (e.g. Negative, 1+)
- [ ] Comparator values display (e.g. `<0.2`)
- [ ] Removing the source removes all of its results
