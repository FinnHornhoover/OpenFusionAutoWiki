import { useParams } from 'react-router-dom';

export default function EntityIndex() {
  const { build, type } = useParams();
  return (
    <section>
      <h1>{type}</h1>
      <p className="muted">Build: {build}</p>
      <div className="placeholder">
        Index will list all {type} once the build pipeline is wired up.
      </div>
    </section>
  );
}
