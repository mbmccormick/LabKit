import { describe, expect, it } from 'vitest';
import { parse, root, dictionary } from '../../../packages/parsers/test/harness';
import { buildCards, buildReview, readiness, setDecision, setDrawIncluded } from '../src/lib/review';
import { isIosSafari } from '../src/lib/platform';

const fx = (f: string) => parse(`${root}fixtures/synthetic/${f}`);
const ISSUER = 'https://staging.labkit.health';
const NOW = new Date('2026-09-23T12:00:00Z');

describe('review model', () => {
  it('includes high rows, holds medium/low for a check, and locks blocking rows out', async () => {
    const m = buildReview([await fx('quest-sample.pdf')]);
    expect(m.patient).toEqual({ family: 'Example', given: ['Taylor', 'Q'], birthDate: '1990-03-04', gender: 'female' });
    const rows = m.draws.flatMap((d) => d.rows);
    const by = (loinc: string) => rows.find((r) => r.row.entry?.loinc === loinc)!;
    expect(by('2093-3').decision).toBe('included');
    // No reference range on the report is informational only (SPEC §12.5): included, but noted.
    expect(by('13457-7').decision).toBe('included');
    expect(by('13457-7').row.issues).toEqual(['no_range']);
    expect(by('2951-2')).toMatchObject({ decision: 'excluded', locked: true }); // implausible sodium
    expect(by('2951-2').reason).toMatch(/physiologically possible/);
    expect(m.unmatched.map((u) => u.text).join()).toMatch(/BUN\/CREATININE RATIO/);
  });

  it('cannot create cards until every pending row is decided', async () => {
    const pending = buildReview([await fx('labcorp-sample.pdf')]);
    expect(readiness(pending)).toMatchObject({ ready: false, problems: ['1 result still needs review.'] });

    // No row in the Quest sample needs a check: a missing range is informational (SPEC §12.5).
    let m = buildReview([await fx('quest-sample.pdf')]);
    expect(readiness(m).ready).toBe(true);
    // Locked rows can't be forced in.
    const sodium = m.draws.flatMap((d) => d.rows).find((r) => r.locked)!;
    expect(setDecision(m, sodium.id, 'included').draws.flatMap((d) => d.rows).find((r) => r.id === sodium.id)!.decision).toBe('excluded');
    for (const r of m.draws.flatMap((d) => d.rows).filter((x) => x.decision === 'pending')) m = setDecision(m, r.id, 'included');
    expect(readiness(m).ready).toBe(true);

    const cards = buildCards(m, dictionary, ISSUER, NOW);
    expect(cards).toHaveLength(2);
    expect(cards[0]!.card.effectiveDateTime).toBe('2026-04-17T13:40:00Z');
    expect(cards[0]!.card.results.map((r) => r.loinc)).not.toContain('2951-2');
    expect(cards[0]!.card.results.find((r) => r.loinc === '751-8')).toMatchObject({ value: 3.12, unit: '10*3/uL', low: 1.5, high: 7.8 });

    // Leaving a whole collection out drops its card.
    m = setDrawIncluded(m, m.draws[1]!.id, false);
    expect(buildCards(m, dictionary, ISSUER, NOW)).toHaveLength(1);
  });

  it('requires choosing between duplicate tests', async () => {
    let m = buildReview([await fx('labcorp-sample.pdf')]);
    const dupes = m.draws[0]!.rows.filter((r) => r.row.issues.includes('duplicate'));
    expect(dupes).toHaveLength(2);
    expect(dupes[1]!.locked).toBe(true); // the mmol/L copy can't be used
    for (const r of m.draws[0]!.rows.filter((x) => x.decision === 'pending')) m = setDecision(m, r.id, 'included');
    expect(readiness(m).ready).toBe(true);
    expect(buildCards(m, dictionary, ISSUER, NOW)[0]!.card.results.filter((r) => r.loinc === '2093-3')).toHaveLength(1);
  });

  it('merges files for the same person and flags cross-file duplicates', async () => {
    const m = buildReview([await fx('quest-sample.pdf'), await fx('function-results-of-record.pdf')]);
    expect(m.patientProblem).toBeUndefined();
    expect(m.draws).toHaveLength(2);
    expect(m.draws[0]!.rows.filter((r) => r.row.entry?.loinc === '2093-3').every((r) => r.row.issues.includes('duplicate'))).toBe(true);
  });

  it('refuses to mix people', async () => {
    const m = buildReview([await fx('quest-sample.pdf'), await fx('labcorp-sample.pdf')]);
    expect(m.patientProblem).toMatch(/different people/);
    expect(readiness(m).ready).toBe(false);
  });

  it('refuses reports without a name or date of birth', async () => {
    const r = await fx('generic-sample.pdf');
    const m = buildReview([{ ...r, patient: { family: 'Placeholder' } }]);
    expect(m.patientProblem).toMatch(/date of birth/);
  });
});

describe('platform', () => {
  it('offers Add to Apple Health on iOS Safari only', () => {
    const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
    const chrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1';
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
    expect(isIosSafari(safari, 'iPhone', 5)).toBe(true);
    expect(isIosSafari(chrome, 'iPhone', 5)).toBe(false);
    expect(isIosSafari(mac, 'MacIntel', 0)).toBe(false);
    expect(isIosSafari(mac, 'MacIntel', 5)).toBe(true);
  });
});
