import { Link } from 'react-router-dom';
import type { NpcLocation } from '../data/types';
import Icon from './Icon';
import AmbiguityMap, { ambiguityLocationLabel } from './AmbiguityMap';

export default function NpcAmbiguityIdentity({ build, routeId, id, name, icon, mapIcon, inGame, location }: {
  build: string;
  routeId: string;
  id: number | string;
  name: string;
  icon: string;
  mapIcon?: string;
  inGame: boolean;
  location?: NpcLocation | null;
}) {
  const label = `${name} (${id})`;
  const locationLabel = ambiguityLocationLabel(location);
  return (
    <div className="npc-ambiguity-identity">
      <AmbiguityMap location={location} icon={mapIcon} />
      <Link className="npc-ambiguity-link entity-index-link" to={`/${build}/npcs/${routeId}`}
        aria-label={inGame ? undefined : `${label}, out of game`}>
        <Icon src={icon} size={48} />
        <span className="npc-ambiguity-labels">
          <span className="entity-ambiguity-name">
            <span>{name}</span>
            <code className="entity-index-id-code">{id}</code>
          </span>
          {locationLabel && <span className="npc-ambiguity-location muted">{locationLabel}</span>}
        </span>
      </Link>
    </div>
  );
}
