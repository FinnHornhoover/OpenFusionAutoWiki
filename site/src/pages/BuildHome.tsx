import { Link, useParams } from 'react-router-dom';

const ENTITY_TYPES = [
  { type: 'missions', label: 'Missions' },
  { type: 'npcs', label: 'NPCs' },
  { type: 'monsters', label: 'Monsters' },
  { type: 'items', label: 'Items' },
  { type: 'areas', label: 'Areas' },
  { type: 'nanos', label: 'Nanos' },
];

export default function BuildHome() {
  const { build } = useParams();
  if (!build) return null;

  return (
    <section>
      <h1>{build}</h1>
      <p className="muted">Browse this build:</p>
      <ul>
        {ENTITY_TYPES.map(({ type, label }) => (
          <li key={type}>
            <Link to={`/${build}/${type}`}>{label}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
