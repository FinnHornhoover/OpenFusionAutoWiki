import { Link } from 'react-router-dom';
import type { NpcLocation } from '../data/types';
import Icon from './Icon';
import MapSpot from './MapSpot';

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
  const locationLabel = location && (location.instanceID === 0
    ? location.areaZone === 'Unknown - Unknown' ? '' : location.areaZone
    : location.instanceName || `Instance ${location.instanceID}`);
  return (
    <div className="npc-ambiguity-identity">
      <span className="npc-ambiguity-map">
        {location ? <MapSpot compact size={48} icon={mapIcon} x={location.x} y={location.y}
          areaId={location.areaId} instanceID={location.instanceID} title={locationLabel || undefined} />
          : mapIcon && <img src={mapIcon} width={28} height={28} alt="" loading="lazy" />}
      </span>
      <Link className="npc-ambiguity-link entity-index-link" to={`/${build}/npcs/${routeId}`}
        aria-label={inGame ? undefined : `${label}, out of game`}>
        <Icon src={icon} size={48} />
        <span className="npc-ambiguity-labels">
          <span>{label}</span>
          {locationLabel && <span className="npc-ambiguity-location muted">{locationLabel}</span>}
        </span>
      </Link>
    </div>
  );
}
