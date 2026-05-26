import { Link, useParams } from 'react-router-dom';
import { buildPageSubtitle, buildPageTitle, useBuildEntry } from '../data/useBuildEntry';
import { useDocumentTitle } from '../data/useDocumentTitle';

const ENTITY_TYPES = [
  { type: 'missions', label: 'Missions' },
  { type: 'npcs', label: 'NPCs' },
  { type: 'monsters', label: 'Monsters' },
  { type: 'items', label: 'Items' },
  { type: 'areas', label: 'Areas' },
  { type: 'instances', label: 'Instances' },
  { type: 'nanos', label: 'Nanos' },
];

export default function BuildHome() {
  const { build } = useParams();
  const entry = useBuildEntry(build);
  useDocumentTitle(entry ? buildPageTitle(entry) : build ?? null);
  if (!build) return null;

  return (
    <section>
      <h1>{entry ? buildPageTitle(entry) : build}</h1>
      {entry && <p className="build-subtitle muted">{buildPageSubtitle(entry)}</p>}
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
