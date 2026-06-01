import { useMatch } from 'react-router-dom';
import { useManifest } from '../data/useManifest';
import { useBuildSwitch } from '../data/useBuildSwitch';

export default function BuildSwitcher() {
  // This lives outside the route tree, so read the build from the current URL.
  const match = useMatch('/:build/*');
  const build = match?.params.build;
  const switchBuild = useBuildSwitch();
  const { manifest, loading, error } = useManifest();

  if (error) {
    return <span className="muted" title={error}>Builds unavailable</span>;
  }
  if (loading) {
    return <span className="muted">Loading builds…</span>;
  }
  if (!manifest || manifest.length === 0) {
    return <span className="muted">No builds yet</span>;
  }

  return (
    <select
      className="styled-select build-select"
      value={build ?? ''}
      onChange={(e) => {
        const slug = e.target.value;
        switchBuild(slug);
      }}
      aria-label="Game build"
    >
      <option value="" disabled>Select build…</option>
      {manifest.map((b) => (
        <option key={b.slug} value={b.slug}>{b.displayName}</option>
      ))}
    </select>
  );
}
