import { Link } from 'react-router-dom';
import { useManifest } from '../data/useManifest';

export default function Home() {
  const { manifest, loading } = useManifest();

  return (
    <section>
      <h1>FusionFall Wiki</h1>
      <p className="muted">
        Auto-generated reference for every FusionFall game build — missions, NPCs, monsters, items,
        areas, and nanos.
      </p>

      <h2>Builds</h2>
      {loading && <p className="muted">Loading…</p>}
      {!loading && (!manifest || manifest.length === 0) && (
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
