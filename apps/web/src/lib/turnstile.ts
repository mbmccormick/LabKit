// Turnstile is the only external origin (CSP allows challenges.cloudflare.com).
// Loaded on demand at signing time, never on page load.
type Turnstile = {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<Turnstile> | undefined;

export function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile failed to initialize')));
    s.onerror = () => {
      loading = undefined;
      s.remove();
      reject(new Error('Could not load the human check. Check your connection and try again.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string;
