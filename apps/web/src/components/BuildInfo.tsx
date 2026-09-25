import { useEffect, useState } from 'preact/hooks';
import { SOURCE_URL } from './Source';

type Manifest = { commit: string; run: string | null };

/** The commit this deployment was built from, read from the signed build manifest (SPEC §13.1). */
export function BuildInfo() {
  const [manifest, setManifest] = useState<Manifest | null | undefined>(undefined);

  useEffect(() => {
    fetch('/.well-known/labkit-build.json')
      .then((res) => (res.ok ? (res.json() as Promise<Manifest>) : null))
      .then((m) => setManifest(m && /^[0-9a-f]{40}$/.test(m.commit) ? m : null))
      .catch(() => setManifest(null));
  }, []);

  if (manifest === undefined) return null;
  if (manifest === null) return <p>This copy of LabKit wasn't built by the release workflow, so there's no build to verify.</p>;
  return (
    <p>
      This deployment was built from commit{' '}
      <a href={`${SOURCE_URL}/tree/${manifest.commit}`} target="_blank" rel="noopener noreferrer">
        <code>{manifest.commit.slice(0, 12)}</code>
      </a>
      {manifest.run && (
        <>
          {' '}
          (
          <a href={manifest.run} target="_blank" rel="noopener noreferrer">
            build and deploy log
          </a>
          )
        </>
      )}
      .
    </p>
  );
}
