import { Link } from 'react-router-dom';
import ErrorState from '../components/ErrorState';
import { useDocumentTitle } from '../data/useDocumentTitle';
import { useManifest } from '../data/useManifest';

export default function Home() {
  const { manifest, loading, error } = useManifest();
  useDocumentTitle(null);

  return (
    <section className="home-page">
      <h1>FusionFall Wiki</h1>
      <p className="muted">
        Auto-generated reference for every FusionFall game build.
        <br />
        Just select a build below or from the above build buttons to get started.
      </p>

      <h2>Builds</h2>
      {error && (
        <ErrorState
          title="Couldn't load builds"
          message="The build manifest failed to load."
          detail={error}
        />
      )}
      {!error && loading && <p className="muted">Loading…</p>}
      {!error && !loading && (!manifest || manifest.length === 0) && (
        <div className="placeholder">
          No builds available yet. Run <code>npm run build:data</code> to populate.
        </div>
      )}
      {manifest && manifest.length > 0 && (
        <ul className="home-link-list build-list">
          {manifest.map((b) => (
            <li key={b.slug}>
              <Link className="home-link-card" to={`/${b.slug}`}>
                <span className="home-link-title">{b.displayName}</span>
                <span className="home-link-meta">{b.date}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
