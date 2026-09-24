import { appleRedirectUrl } from '@labkit/core';
import { downloadCard } from '../lib/download';
import { isIosSafari } from '../lib/platform';
import { Coffee } from './Coffee';

export type Delivered = { jws: string; fileName: string; label: string; count: number };

export function Delivery(props: { cards: Delivered[]; onRestart: () => void }) {
  const ios = isIosSafari();
  const one = props.cards.length === 1;
  return (
    <div class="flow">
      <h1>Your {one ? 'Card Is' : 'Cards Are'} Ready</h1>

      {props.cards.map((c, i) => (
        <section class="panel card-out" key={c.fileName}>
          <div>
            <h2>{c.label}</h2>
            <p class="muted small">
              {c.count} result{c.count === 1 ? '' : 's'} · {c.fileName}
            </p>
          </div>
          <div class="actions">
            {ios && (
              <a class="button primary" href={appleRedirectUrl(c.jws)}>
                Add to Apple Health
              </a>
            )}
            <button class={`button${ios ? '' : ' primary'}`} onClick={() => downloadCard(c.jws, c.fileName)}>
              Download File
            </button>
            {i === props.cards.length - 1 && <Coffee />}
          </div>
        </section>
      ))}

      <section class="panel">
        <h2>Adding Your {one ? 'Card' : 'Cards'} to Apple Health</h2>
        {ios ? (
          <p>
            Tap <strong>Add to Apple Health</strong>{one ? '' : ' for each card'}. If that doesn't work, download the file,
            save it to <strong>On My iPhone</strong> (not iCloud Drive), then open it from the Files app and choose{' '}
            <strong>Share → Health</strong>.
          </p>
        ) : (
          <p>
            Send the {one ? 'file' : 'files'} to your iPhone with AirDrop or email. On your iPhone, save{' '}
            {one ? 'it' : 'each file'} to <strong>On My iPhone</strong> (not iCloud Drive, which Apple Health can't import
            from), then open it from the Files app and choose <strong>Share → Health</strong>.
          </p>
        )}
        {!one && <p class="muted small">Apple Health can't import a ZIP, so each card is a separate file.</p>}
      </section>

      <section class="panel">
        <h2>Good to Know</h2>
        <ul>
          <li>In Apple Health, each card appears as its own source, listed as labkit.health.</li>
          <li>Deleting a card in Apple Health removes all of its results. Individual results can't be removed.</li>
          <li>Results for the same test from different cards appear together in one trend chart.</li>
          <li>We didn't keep a copy. When you close this tab, your results are gone from this page too.</li>
        </ul>
      </section>

      <button class="button" onClick={props.onRestart}>
        Start Over
      </button>
    </div>
  );
}
