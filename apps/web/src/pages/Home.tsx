import type { Dictionary } from '@labkit/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Delivery, type Delivered } from '../components/Delivery';
import { ReviewScreen } from '../components/ReviewScreen';
import { getDictionary } from '../lib/dictionary';
import { parseInBrowser, type FileStatus } from '../lib/parse';
import { buildReview, type ReviewModel } from '../lib/review';
import { SourceLink } from '../components/Source';

const ACCEPT = '.pdf,.zip,.jpg,.jpeg,.png,.heic,application/pdf,application/zip,image/jpeg,image/png,image/heic';

type Step = { kind: 'start' } | { kind: 'reading'; files: { name: string; status: FileStatus }[] } | { kind: 'review'; model: ReviewModel } | { kind: 'done'; cards: Delivered[] };

export function Home() {
  const [step, setStep] = useState<Step>({ kind: 'start' });
  const [error, setError] = useState<string>();
  const dictionary = useRef<Promise<Dictionary>>();

  // Warn before losing results (nothing is persisted anywhere).
  const dirty = step.kind === 'reading' || step.kind === 'review';
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function onFiles(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setError(undefined);
    const statuses = files.map((f) => ({ name: f.name, status: { phase: 'reading' } as FileStatus }));
    const show = () => setStep({ kind: 'reading', files: statuses.map((s) => ({ ...s })) });
    show();
    let dict: Dictionary;
    try {
      dictionary.current ??= getDictionary();
      dict = await dictionary.current;
    } catch {
      dictionary.current = undefined;
      setError("We couldn't load LabKit's list of supported tests. Check your connection and try again.");
      setStep({ kind: 'start' });
      return;
    }
    const reports = [];
    for (const [i, f] of files.entries()) {
      try {
        const report = await parseInBrowser(f, dict, (s) => {
          statuses[i]!.status = s;
          show();
        });
        statuses[i]!.status = { phase: 'done', report };
        reports.push(report);
      } catch (e) {
        statuses[i]!.status = { phase: 'error', message: e instanceof Error ? e.message : "This file couldn't be read." };
      }
      show();
    }
    const model = buildReview(reports);
    if (!model.draws.length) {
      const errs = statuses.flatMap((s) => (s.status.phase === 'error' ? [`${s.name}: ${s.status.message}`] : []));
      setError(errs.length ? errs.join(' ') : "We couldn't find any lab results we recognize in that file. Try the PDF from your lab or patient portal.");
      setStep({ kind: 'start' });
      return;
    }
    for (const s of statuses) if (s.status.phase === 'error') model.warnings.unshift(`${s.name}: ${s.status.message}`);
    setStep({ kind: 'review', model });
    scrollTo(0, 0);
  }

  if (step.kind === 'reading') return <Reading files={step.files} />;
  if (step.kind === 'review') {
    return (
      <ReviewScreen
        model={step.model}
        dictionary={dictionary.current!}
        onChange={(model) => setStep({ kind: 'review', model })}
        onCancel={() => setStep({ kind: 'start' })}
        onSigned={(cards) => {
          setStep({ kind: 'done', cards });
          scrollTo(0, 0);
        }}
      />
    );
  }
  if (step.kind === 'done') return <Delivery cards={step.cards} onRestart={() => setStep({ kind: 'start' })} />;

  return (
    <>
      <section class="hero">
        <h1>Add your lab results to Apple&nbsp;Health</h1>
        <p class="lede">
          LabKit turns your lab report into a signed SMART Health Card. Add it to Apple Health to see your results and
          their trends over time.
        </p>
        <label class="button primary large file-button">
          Choose Lab Report
          <input
            type="file"
            accept={ACCEPT}
            multiple
            onChange={(e) => {
              const input = e.currentTarget;
              void onFiles(input.files).finally(() => (input.value = ''));
            }}
          />
        </label>
        <p class="muted small">A PDF from your lab or patient portal, or a photo of a printed report.</p>
        {/*
          Apple's official "Works with Apple Health" artwork, unmodified, from the Apple Developer site
          (developer.apple.com/licensing-trademarks/works-with-apple-health/). Rules: one badge per page,
          >= 30 px tall, clear space >= 1/4 of its height, subordinate to the main message. Hidden until the
          file exists in public/badges/.
        */}
        <img
          class="health-badge"
          src="/badges/works-with-apple-health.svg"
          alt="Works with Apple Health"
          height={40}
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
        {error && (
          <p class="error-box" role="alert">
            {error}
          </p>
        )}
      </section>

      <section class="panel">
        <h2>Private by Design</h2>
        <ul class="checks">
          <li>Your report is read inside this browser tab. The file never leaves your device.</li>
          <li>To sign a card, its results pass through our server once and are never stored or logged.</li>
          <li>No accounts, no ads, no trackers. Close the tab and it's gone.</li>
          <li>
            LabKit is open source, so anyone can check these claims: <SourceLink>read the code on GitHub</SourceLink>.
          </li>
        </ul>
      </section>

      <section class="panel">
        <h2>How It Works</h2>
        <ol class="steps">
          <li>Choose your lab report. We read the results, units, reference ranges, and collection date.</li>
          <li>Check anything we flag. A card can't be edited once it's in Apple Health.</li>
          <li>
            Tap <strong>Add to Apple Health</strong> on your iPhone, or download the card file and open it on your
            iPhone.
          </li>
        </ol>
      </section>

      <section class="panel">
        <h2>Supported Reports</h2>
        <p>
          Quest and Labcorp reports, other lab PDFs, and photos of printed reports, including results from
          direct-to-consumer testing services. If your provider already sends results to Apple Health through Health
          Records, you don't need LabKit.
        </p>
      </section>
    </>
  );
}

const found = (n: number) => `${n} result${n === 1 ? '' : 's'} found.`;

function Reading(props: { files: { name: string; status: FileStatus }[] }) {
  return (
    <div class="flow">
      <h1>Reading Your Report…</h1>
      <p class="muted">This happens on your device. Nothing is uploaded.</p>
      {props.files.map((f) => (
        <section class="panel" key={f.name}>
          <h2 class="file-name">{f.name}</h2>
          {f.status.phase === 'reading' && <p class="muted">Reading…</p>}
          {f.status.phase === 'ocr' && (
            <>
              <p>This file is a scan or photo; reading it may take a minute.</p>
              <progress max={1} value={f.status.progress} />
            </>
          )}
          {f.status.phase === 'done' && <p class="muted">{found(f.status.report.draws.reduce((n, d) => n + d.rows.length, 0))}</p>}
          {f.status.phase === 'error' && <p class="error-text">{f.status.message}</p>}
        </section>
      ))}
    </div>
  );
}
