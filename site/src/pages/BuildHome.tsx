import { Link, useParams } from 'react-router-dom';
import { buildPageSubtitle, buildPageTitle, useBuildEntry } from '../data/useBuildEntry';
import { useDocumentTitle } from '../data/useDocumentTitle';

const ENTITY_TYPES = [
  { type: 'map', label: 'World Map' },
  { type: 'player-stats', label: 'Player Stats' },
  { type: 'missions', label: 'Missions' },
  { type: 'npcs', label: 'NPCs' },
  { type: 'monsters', label: 'Monsters' },
  { type: 'items', label: 'Items' },
  { type: 'codes', label: 'Codes' },
  { type: 'areas', label: 'Areas' },
  { type: 'instances', label: 'Instances' },
  { type: 'infected-zones', label: 'Infected Zones' },
  { type: 'nanos', label: 'Nanos' },
];

export default function BuildHome() {
  const { build } = useParams();
  const entry = useBuildEntry(build);
  useDocumentTitle(entry ? buildPageTitle(entry) : build ?? null);
  if (!build) return null;

  return (
    <section className="build-home-page">
      <h1>{entry ? buildPageTitle(entry) : build}</h1>
      {entry && <p className="build-subtitle muted">{buildPageSubtitle(entry)}</p>}
      <p className="muted">Browse this build:</p>
      <ul className="home-link-list build-nav-list">
        {ENTITY_TYPES.map(({ type, label }) => (
          <li key={type}>
            <Link className="home-link-card" to={`/${build}/${type}`}>
              <span className="home-link-title">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
