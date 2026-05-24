import { useParams } from 'react-router-dom';
import { useBuildEntry } from '../data/useBuildEntry';

export default function EntityPage() {
  const { build, type, id } = useParams();
  const entry = useBuildEntry(build);
  const buildLabel = entry ? entry.displayName : build;
  return (
    <section>
      <h1>{type}/{id}</h1>
      <p className="muted">Build: {buildLabel}</p>
      <div className="placeholder">
        Entity page will render here using an MDX template + per-entity JSON.
      </div>
    </section>
  );
}
