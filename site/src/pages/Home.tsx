import { Link } from 'react-router-dom';
import ErrorState from '../components/ErrorState';
import { useManifest } from '../data/useManifest';

export default function Home() {
  const { manifest, loading, error } = useManifest();

  return (
    <section>
      <h1>FusionFall Wiki</h1>
      <p className="muted">
        Auto-generated reference for every FusionFall game build — missions, NPCs, monsters, items,
        areas, and nanos.
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
        <ul>
          {manifest.map((b) => (
            <li key={b.slug}>
              <Link to={`/${b.slug}`}>{b.displayName}</Link>
              <span className="muted"> — {b.date}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
