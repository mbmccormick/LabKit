import { cardFileName, ucumLabel, VITAL_LABELS, VITALS_EXTENSION, VITALS_MIME, vitalsCsv, type Dictionary, type JsonObject, type ParsedRow } from '@labkit/core';
import type { ParsedVital } from '@labkit/parsers';
import { downloadFile } from '../lib/download';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getHealth, signCards, SignError } from '../lib/api';
import { buildCards, localDate, readiness, setDecision, setDrawIncluded, setVitalDecision, vitalsExport, type ReviewModel, type ReviewRow, type ReviewVitals, type VitalRow } from '../lib/review';
import { loadTurnstile, TURNSTILE_SITE_KEY } from '../lib/turnstile';
import type { Delivered } from './Delivery';

type SignState = { phase: 'idle' } | { phase: 'challenge' } | { phase: 'signing' } | { phase: 'error'; message: string };

export function formatWhen(iso: string, timeFound = true): string {
  const d = new Date(iso);
  return timeFound ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** YYYY-MM-DD as a readable date, without shifting it through the local time zone. */
function formatBirthDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
}

function valueText(row: ParsedRow): string {
  const v = row.value;
  if (!v) return row.raw.value || '—';
  if (v.kind !== 'quantity') return v.text;
  const unit = ucumLabel(v.ucum);
  return `${v.comparator ?? ''}${v.value}${unit ? ` ${unit}` : ''}`;
}

function rangeText(row: ParsedRow): string {
  const r = row.range;
  if (!r) return '';
  if (r.low !== undefined && r.high !== undefined) return `${r.low}–${r.high}`;
  if (r.high !== undefined) return `≤ ${r.high}`;
  if (r.low !== undefined) return `≥ ${r.low}`;
  return '';
}

function checkReason(row: ParsedRow): string {
  if (row.issues.includes('duplicate')) return 'This test appears more than once for this date. Keep one and leave the other out.';
  if (row.issues.includes('formula_not_printed'))
    return "Calculated by the lab. The report doesn't say which formula it used, so this is saved as eGFR without one and won't join eGFR results from other labs. Include it only if that's fine.";
  if (row.issues.includes('ocr')) return 'Read from a scan. Compare it with your report.';
  if (row.confidence === 'medium') return "We're less sure about this match. Compare it with your report.";
  return 'Compare this with your report.';
}

export function ReviewScreen(props: {
  model: ReviewModel;
  dictionary: Promise<Dictionary>;
  onChange: (m: ReviewModel) => void;
  onCancel: () => void;
  onSigned: (cards: Delivered[]) => void;
}) {
  const { model } = props;
  const [attested, setAttested] = useState(false);
  const [state, setState] = useState<SignState>({ phase: 'idle' });
  const widget = useRef<HTMLDivElement>(null);
  const attestRef = useRef<HTMLElement>(null);
  const problemsRef = useRef<HTMLUListElement>(null);
  const widgetId = useRef<string>();
  const ready = readiness(model);
  const busy = state.phase === 'challenge' || state.phase === 'signing';

  useEffect(
    () => () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
    },
    [],
  );

  const decide = (id: string, d: 'included' | 'excluded') => props.onChange(setDecision(model, id, d));

  async function start() {
    setState({ phase: 'challenge' });
    try {
      const health = await getHealth();
      if (!health.ok) throw new Error('Signing is temporarily unavailable. Try again later.');
      const drafts = buildCards(model, await props.dictionary, health.issuer);
      const ts = await loadTurnstile();
      if (widgetId.current) ts.remove(widgetId.current);
      widgetId.current = ts.render(widget.current!, {
        sitekey: TURNSTILE_SITE_KEY,
        action: 'sign',
        callback: (token: string) => void submit(token, drafts),
        'error-callback': () => setState({ phase: 'error', message: 'The human check failed. Try again.' }),
        'expired-callback': () => setState({ phase: 'error', message: 'The human check expired. Try again.' }),
      });
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message });
    }
  }

  async function submit(token: string, drafts: ReturnType<typeof buildCards>) {
    setState({ phase: 'signing' });
    try {
      const signed = await signCards(
        token,
        drafts.map((d) => d.payload as JsonObject),
      );
      const perDate = new Map<string, number>();
      props.onSigned(
        signed.map((c, i) => {
          const d = drafts[i]!;
          const date = localDate(d.draw.collectedAt);
          const n = (perDate.get(date) ?? 0) + 1;
          perDate.set(date, n);
          return { jws: c.jws, fileName: cardFileName(date, n), label: formatWhen(d.draw.collectedAt, d.draw.timeFound), count: d.card.results.length };
        }),
      );
    } catch (e) {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = undefined;
      let message = 'Something went wrong. Try again.';
      if (e instanceof SignError) {
        if (e.error.code === 'rate_limited') message = 'Too many requests. Wait a minute and try again.';
        else if (e.error.code === 'turnstile_failed') message = 'The human check failed. Try again.';
        else if (e.error.code === 'too_large') message = 'Too many results at once. Leave some collections out and try again.';
        else if (e.error.code === 'invalid_payload')
          message = `A card was rejected${e.error.cardIndex !== undefined ? ` (card ${e.error.cardIndex + 1})` : ''}: ${e.error.message}.`;
        else message = 'Signing is temporarily unavailable. Try again later.';
      }
      setState({ phase: 'error', message });
    }
  }

  const canCreate = ready.ready && attested && !busy;

  /** A click on the not-yet-ready button: go to the next result to review, else the confirmation. */
  function showNextStep() {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const go = (el: Element | null | undefined, focus?: HTMLElement | null) => {
      if (!el) return;
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      focus?.focus({ preventScroll: true });
      el.classList.remove('attention');
      void (el as HTMLElement).offsetWidth; // restart the highlight animation
      el.classList.add('attention');
      setTimeout(() => el.classList.remove('attention'), 1600);
    };
    const next = document.querySelector<HTMLElement>('li.result.check:not(.vital)');
    if (next) return go(next, next.querySelector<HTMLElement>('.decide .button.primary'));
    if (!ready.ready) return go(problemsRef.current);
    go(attestRef.current, attestRef.current?.querySelector<HTMLInputElement>('input[type=checkbox]'));
  }

  const pendingTotal = model.draws.filter((d) => d.included).reduce((n, d) => n + d.rows.filter((r) => r.decision === 'pending').length, 0);
  const includedCards = model.draws.filter((d) => d.included && d.rows.some((r) => r.decision === 'included'));

  return (
    <div class="flow">
      <h1>Check Your Results</h1>
      <p class="muted">
        Here's what LabKit found. Compare anything marked <span class="badge check">Review</span> with your report. Once
        a card is in Apple Health, it can't be edited, only deleted as a whole.
      </p>

      <section class="panel">
        <h2>Patient</h2>
        {model.patient ? (
          <p>
            {model.patient.given.join(' ')} {model.patient.family} · Born {formatBirthDate(model.patient.birthDate)}
            {model.patient.gender ? ` · ${model.patient.gender.charAt(0).toUpperCase()}${model.patient.gender.slice(1)}` : ''}
          </p>
        ) : (
          <p class="error-text">{model.patientProblem}</p>
        )}
        <p class="muted small">From {model.files.map((f) => f.name).join(', ')}</p>
      </section>

      {model.warnings.length > 0 && (
        <ul class="warnings">
          {model.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {model.draws.map((d) => (
        <section class={`panel${d.included ? '' : ' draw-off'}`} key={d.id} aria-label={`Collected ${formatWhen(d.collectedAt, d.timeFound)}`}>
          <div class="panel-head">
            <h2>Collected {formatWhen(d.collectedAt, d.timeFound)}</h2>
            <label class="toggle">
              <input type="checkbox" checked={d.included} disabled={busy} onChange={(e) => props.onChange(setDrawIncluded(model, d.id, e.currentTarget.checked))} />
              Include
            </label>
          </div>
          {!d.timeFound && <p class="muted small">The report shows a date but no time for this collection.</p>}
          {d.included && (
            <ul class="results">
              {d.rows.map((r) => (
                <Result key={r.id} r={r} busy={busy} onDecide={decide} />
              ))}
            </ul>
          )}
        </section>
      ))}

      {model.vitals.map((v) => (
        <VitalsSection key={v.id} v={v} busy={busy} onDecide={(id, d) => props.onChange(setVitalDecision(model, id, d))} />
      ))}

      {model.unmatched.length > 0 && (
        <details class="panel unmatched">
          <summary>
            Lines We Couldn't Match ({model.unmatched.length})
          </summary>
          <p class="muted small">These look like results but aren't tests LabKit can sign yet, so they'll be left out.</p>
          <ul>
            {model.unmatched.map((u, i) => (
              <li key={i}>
                <code>{u.text}</code>
              </li>
            ))}
          </ul>
        </details>
      )}

      {ready.ready ? (
        <section class="panel attest" ref={attestRef}>
          <h2>Confirm Your Results</h2>
          <label class="confirm">
            <input type="checkbox" checked={attested} disabled={busy} onChange={(e) => setAttested(e.currentTarget.checked)} />
            <span>I've checked that these results match my lab report</span>
          </label>
        </section>
      ) : (
        <ul class="errors" role="status" ref={problemsRef}>
          {ready.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div ref={widget} class="turnstile" />
      {state.phase === 'error' && (
        <p class="error-box" role="alert">
          {state.message}
        </p>
      )}
      {state.phase === 'signing' && <p class="muted">Creating your {includedCards.length === 1 ? 'card' : 'cards'}…</p>}

      <div class="actions sticky-actions">
        <button class="button" onClick={props.onCancel} disabled={busy}>
          Start Over
        </button>
        {/* aria-disabled (not disabled) while waiting on the user, so a click can take them to what's left to do. */}
        <button
          class={`button primary large${canCreate ? '' : ' is-disabled'}`}
          disabled={busy}
          aria-disabled={!canCreate}
          onClick={() => (canCreate ? void start() : showNextStep())}
        >
          {pendingTotal ? `${pendingTotal} to Review` : `Create ${includedCards.length === 1 ? 'Card' : `${includedCards.length} Cards`}`}
        </button>
      </div>
    </div>
  );
}

function Result(props: { r: ReviewRow; busy: boolean; onDecide: (id: string, d: 'included' | 'excluded') => void }) {
  const { r, busy } = props;
  const row = r.row;
  const range = rangeText(row);
  const status = r.locked ? 'problem' : r.decision === 'pending' ? 'check' : r.decision;
  return (
    <li class={`result ${status}`} data-row-id={r.id}>
      <div class="result-main">
        <div class="result-name">
          <strong>{row.entry?.text ?? row.raw.name}</strong>
          {r.locked ? <span class="badge problem">Left Out</span> : r.decision === 'pending' ? <span class="badge check">Review</span> : null}
        </div>
        <div class="result-value">
          {valueText(row)}
          {range && (
            <span class="muted small">
              {' '}
              · ref {range}
              {row.rangeSource === 'note' ? ' (from report note)' : ''}
            </span>
          )}
          {!range && row.value?.kind === 'quantity' && <span class="muted small"> · no reference range on report</span>}
          {row.raw.flag && <span class="flag"> {row.raw.flag}</span>}
        </div>
      </div>
      <code class="source" title={`Page ${row.raw.page}`}>
        {row.raw.line}
      </code>
      {r.locked && <p class="error-text small">{r.reason}</p>}
      {!r.locked && r.decision === 'pending' && (
        <div class="decide">
          <p class="small">{checkReason(row)}</p>
          <button class="button small-button primary" disabled={busy} onClick={() => props.onDecide(r.id, 'included')} aria-label={`Confirm ${row.entry?.text}`}>
            Matches My Report
          </button>
          <button class="button small-button" disabled={busy} onClick={() => props.onDecide(r.id, 'excluded')} aria-label={`Leave out ${row.entry?.text}`}>
            Leave Out
          </button>
        </div>
      )}
      {!r.locked && r.decision !== 'pending' && (
        <button class="link" disabled={busy} onClick={() => props.onDecide(r.id, r.decision === 'included' ? 'excluded' : 'included')}>
          {r.decision === 'included' ? 'Leave Out' : 'Include Again'}
        </button>
      )}
    </li>
  );
}

const VITAL_UNIT_TEXT: Record<string, string> = { count: '', 'count/min': 'bpm', ratio: '' };

function vitalValueText(v: ParsedVital): string {
  if (v.value === undefined) return v.raw.value || '—';
  const unit = v.unit === undefined ? '' : (VITAL_UNIT_TEXT[v.unit] ?? v.unit);
  return `${v.value}${unit ? (unit === '%' ? unit : ` ${unit}`) : ''}`;
}

function vitalCheckReason(v: ParsedVital): string {
  if (v.issues.includes('conflict')) return 'The report prints this more than once with different values. Check which is right.';
  return 'Compare this with your report.';
}

/**
 * Vitals the card can't carry. Files are built here and saved by the user; nothing is sent to the server.
 * The vitals file is the labkit-vitals JSON; the CSV is for Health CSV Importer.
 */
function VitalsSection(props: { v: ReviewVitals; busy: boolean; onDecide: (id: string, d: 'included' | 'excluded') => void }) {
  const { v, busy } = props;
  const [error, setError] = useState<string>();
  const pending = v.rows.filter((r) => r.decision === 'pending').length;
  const date = v.info.collectedAt ? localDate(v.info.collectedAt) : 'undated';

  async function save(kind: 'app' | 'csv') {
    setError(undefined);
    const file = await vitalsExport(v);
    if (!file) return setError('There are no measurements to save.');
    if (kind === 'app') downloadFile(JSON.stringify(file, null, 2), VITALS_MIME, `labkit-vitals-${date}.${VITALS_EXTENSION}`);
    else {
      const csv = vitalsCsv(file);
      if (!csv) return setError('None of these measurements can be imported from a CSV.');
      downloadFile(csv, 'text/csv', `labkit-vitals-${date}.csv`);
    }
  }

  return (
    <section class="panel vitals" aria-label="Vitals (not in card)">
      <h2>Vitals (Not in Card)</h2>
      <p class="muted small">
        Body measurements, pulse and blood pressure aren't lab results, so they're not in the card. Save them as a vitals file, or as a
        CSV for Health CSV Importer. These files are made on this device and never sent anywhere.
      </p>
      <ul class="results">
        {v.rows.map((r) => (
          <VitalResult key={r.id} r={r} busy={busy} onDecide={props.onDecide} />
        ))}
      </ul>
      <p class="muted small">
        In Health CSV Importer, everything except weight, including blood pressure, needs Pro. Hip circumference isn't in the CSV; it's
        only in the vitals file.
      </p>
      {error && <p class="error-text small">{error}</p>}
      <div class="actions">
        <button class="button" disabled={busy || pending > 0} onClick={() => void save('app')}>
          Download Vitals File
        </button>
        <button class="button" disabled={busy || pending > 0} onClick={() => void save('csv')}>
          Download Vitals CSV
        </button>
      </div>
      {pending > 0 && <p class="muted small">Check the {pending === 1 ? 'measurement' : `${pending} measurements`} marked Review first.</p>}
    </section>
  );
}

function VitalResult(props: { r: VitalRow; busy: boolean; onDecide: (id: string, d: 'included' | 'excluded') => void }) {
  const { r, busy } = props;
  const v = r.vital;
  const label = VITAL_LABELS[v.metric];
  const status = r.decision === 'display' ? 'display' : r.locked ? 'problem' : r.decision === 'pending' ? 'check' : r.decision;
  return (
    <li class={`result vital ${status}`} data-row-id={r.id}>
      <div class="result-main">
        <div class="result-name">
          <strong>{label}</strong>
          {r.decision === 'display' ? (
            <span class="badge">Shown Only</span>
          ) : r.locked ? (
            <span class="badge problem">Left Out</span>
          ) : r.decision === 'pending' ? (
            <span class="badge check">Review</span>
          ) : null}
        </div>
        <div class="result-value">{vitalValueText(v)}</div>
      </div>
      <code class="source" title={`Page ${v.raw.page}`}>
        {v.raw.line}
      </code>
      {r.decision === 'display' && <p class="muted small">Apple Health has no Waist/Hip Ratio type.</p>}
      {r.locked && r.reason && <p class="error-text small">{r.reason}</p>}
      {!r.locked && r.decision === 'pending' && (
        <div class="decide">
          <p class="small">{vitalCheckReason(v)}</p>
          <button class="button small-button primary" disabled={busy} onClick={() => props.onDecide(r.id, 'included')} aria-label={`Confirm ${label}`}>
            Matches My Report
          </button>
          <button class="button small-button" disabled={busy} onClick={() => props.onDecide(r.id, 'excluded')} aria-label={`Leave out ${label}`}>
            Leave Out
          </button>
        </div>
      )}
      {!r.locked && r.decision !== 'pending' && (
        <button class="link" disabled={busy} onClick={() => props.onDecide(r.id, r.decision === 'included' ? 'excluded' : 'included')}>
          {r.decision === 'included' ? 'Leave Out' : 'Include Again'}
        </button>
      )}
    </li>
  );
}
