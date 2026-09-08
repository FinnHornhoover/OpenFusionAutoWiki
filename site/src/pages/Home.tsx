import { Link } from 'react-router-dom';
import ErrorState from '../components/ErrorState';
import { useDocumentTitle } from '../data/useDocumentTitle';
import { useManifest } from '../data/useManifest';

export default function Home() {
  const { manifest, loading, error } = useManifest();
  useDocumentTitle(null);

  return (
    <section className="home-page">
      <div className="home-header">
        <img src="/assets/FusionFallWiki_Welcome.png" alt="FusionFall Wiki Logo" className="home-logo" width="60%" height="60%" />
        <p className="muted">
          Auto-generated reference for every FusionFall game build.
          <br />
          Just select a build below or from the above build buttons to get started.
        </p>
      </div>

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
