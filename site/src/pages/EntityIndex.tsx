import { useParams } from 'react-router-dom';
import { useBuildEntry } from '../data/useBuildEntry';

export default function EntityIndex() {
  const { build, type } = useParams();
  const entry = useBuildEntry(build);
  const buildLabel = entry ? entry.displayName : build;
  return (
    <section>
      <h1>{type}</h1>
      <p className="muted">Build: {buildLabel}</p>
      <div className="placeholder">
        Index will list all {type} once the build pipeline is wired up.
      </div>
    </section>
  );
}
