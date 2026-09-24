import { About } from './pages/About';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';
import { Privacy } from './pages/Privacy';
import { Terms } from './pages/Terms';
import { useEffect } from 'preact/hooks';
import { SourceLink } from './components/Source';
import { onLinkClick, usePath } from './lib/router';

const ROUTES: Record<string, { page: () => preact.JSX.Element; title: string }> = {
  '/': { page: Home, title: 'LabKit · Add lab results to Apple Health' },
  '/about': { page: About, title: 'About · LabKit' },
  '/privacy': { page: Privacy, title: 'Privacy · LabKit' },
  '/terms': { page: Terms, title: 'Terms · LabKit' },
};
const NOT_FOUND = { page: NotFound, title: 'Page Not Found · LabKit' };

export function App() {
  const path = usePath();
  const route = ROUTES[path.replace(/\/+$/, '') || '/'] ?? NOT_FOUND;
  const Page = route.page;
  useEffect(() => {
    document.title = route.title;
  }, [route]);
  return (
    <div class="shell" onClick={onLinkClick}>
      <header class="site-header">
        {/* A real page load (not client-side routing), so it starts fresh. The beforeunload prompt still protects unsaved results. */}
        <a
          href="/"
          class="brand"
          aria-label="LabKit home"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            location.assign('/');
          }}
        >
          <span class="brand-mark" aria-hidden="true">L</span>
          LabKit
        </a>
        <nav>
          <a href="/about">About</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </header>
      <main>
        <Page />
      </main>
      <footer class="site-footer">
        <p>
          LabKit adds your lab results to Apple Health. It doesn't interpret results and isn't medical advice.
        </p>
        <p>
          <a href="/about">About</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <SourceLink>GitHub</SourceLink>
        </p>
      </footer>
    </div>
  );
}
