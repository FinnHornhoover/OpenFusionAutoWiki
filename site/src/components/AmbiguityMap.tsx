import type { NpcLocation } from '../data/types';
import MapSpot from './MapSpot';

export function ambiguityLocationLabel(location?: NpcLocation | null) {
  if (!location) return '';
  if (location.instanceID !== 0) return location.instanceName || `Instance ${location.instanceID}`;
  return location.areaZone === 'Unknown - Unknown' ? '' : location.areaZone;
}

export default function AmbiguityMap({ location, icon }: { location?: NpcLocation | null; icon?: string }) {
  return (
    <span className="ambiguity-map">
      {location ? <MapSpot compact size={48} icon={icon} x={location.x} y={location.y}
        areaId={location.areaId} instanceID={location.instanceID} title={ambiguityLocationLabel(location) || undefined} />
        : icon && <img src={icon} width={28} height={28} alt="" loading="lazy" />}
    </span>
  );
}
