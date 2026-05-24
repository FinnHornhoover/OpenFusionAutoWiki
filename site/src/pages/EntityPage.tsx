import { useParams } from 'react-router-dom';

export default function EntityPage() {
  const { build, type, id } = useParams();
  return (
    <section>
      <h1>{type}/{id}</h1>
      <p className="muted">Build: {build}</p>
      <div className="placeholder">
        Entity page will render here using an MDX template + per-entity JSON.
      </div>
    </section>
  );
}
