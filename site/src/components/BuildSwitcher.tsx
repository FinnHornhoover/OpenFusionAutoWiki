import { useMatch, useNavigate } from 'react-router-dom';
import { useManifest } from '../data/useManifest';

export default function BuildSwitcher() {
  // useParams returns {} outside a matched <Route>, and this component lives in the
  // header next to QuickPicks. useMatch reads the current URL anywhere under <BrowserRouter>.
  const match = useMatch('/:build/*');
  const build = match?.params.build;
  const navigate = useNavigate();
  const { manifest, loading } = useManifest();

  if (loading) {
    return <span className="muted">Loading builds…</span>;
  }
  if (!manifest || manifest.length === 0) {
    return <span className="muted">No builds yet</span>;
  }

  return (
    <select
      value={build ?? ''}
      onChange={(e) => {
        const slug = e.target.value;
        if (slug) navigate(`/${slug}`);
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
