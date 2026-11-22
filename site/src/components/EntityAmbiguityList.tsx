import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { RouteAmbiguityMatch } from '../data/routeMap';
import type { InstanceIndexEntry, ItemIndexEntry, ItemSetIndexEntry, MissionIndexEntry, MobIndexEntry, NanoIndexEntry } from '../data/types';
import { useIndex } from '../data/useIndex';
import { warpIcon } from '../data/mapMarkers';
import AmbiguityMap, { ambiguityLocationLabel } from './AmbiguityMap';
import Icon from './Icon';
import InlineMeta from './InlineMeta';

type Entry = InstanceIndexEntry | ItemIndexEntry | ItemSetIndexEntry | MissionIndexEntry | MobIndexEntry | NanoIndexEntry;

function Details({ entry }: { entry: Entry }) {
  if ('itemId' in entry) return (
    <InlineMeta>
      <span>{entry.displayType || entry.weaponType || entry.type}</span>
      <span>Level {entry.contentLevel ?? 0}</span>
      {entry.rarity && entry.rarity !== 'Any' && <span>{entry.rarity}</span>}
      {entry.gender && entry.gender !== 'Any' && <span>{entry.gender}</span>}
      {entry.requiredLevel > 0 && entry.requiredLevel !== entry.contentLevel && <span>Requires level {entry.requiredLevel}</span>}
    </InlineMeta>
  );
  if ('standardHP' in entry) return (
    <InlineMeta>
      {entry.level > 0 && <span>Level {entry.level}</span>}
      {entry.standardHP > 0 && <span>{entry.standardHP.toLocaleString()} HP</span>}
      {entry.colorType && <span>{entry.colorType}</span>}
      {ambiguityLocationLabel(entry.firstLocation) && <span>{ambiguityLocationLabel(entry.firstLocation)}</span>}
      {(entry.inGame || entry.instanceCount > 0) && <span>{entry.instanceCount.toLocaleString()} spawn{entry.instanceCount === 1 ? '' : 's'}</span>}
    </InlineMeta>
  );
  if ('difficulty' in entry) {
    const npc = entry.displayNPC ?? entry.startNPC;
    return (
      <InlineMeta>
        {entry.level > 0 && <span>Level {entry.level}</span>}
        {entry.difficulty && <span>{entry.difficulty}</span>}
        {entry.type && <span>{entry.type}</span>}
        {npc && <span>{npc.name}</span>}
      </InlineMeta>
    );
  }
  if ('infectedZoneId' in entry) {
    const entrance = entry.firstEntry;
    const location = ambiguityLocationLabel(entrance?.entryLocation)
      || (entry.areaZone !== 'Unknown - Unknown' ? entry.areaZone : '');
    return (
      <InlineMeta>
        {(entrance?.npc || location) && <span>Entry: {entrance?.npc?.name || location}</span>}
        {entrance?.npc && location && <span>{location}</span>}
        {entry.infectedZoneName && <span>{entry.infectedZoneName}</span>}
      </InlineMeta>
    );
  }
  if ('nanoType' in entry) return (
    <InlineMeta>
      <span>Level {entry.awardLevel ?? 0}</span>
      {entry.nanoType && <span>{entry.nanoType}</span>}
    </InlineMeta>
  );
  return <InlineMeta><span>{entry.itemCount} items</span></InlineMeta>;
}

export default function EntityAmbiguityList({ build, type, matches }: {
  build: string;
  type: string;
  matches: RouteAmbiguityMatch[];
}) {
  const { rows, error } = useIndex<Entry>(build, type);
  const entries = useMemo(() => new Map(rows?.map((row) => [String(row.id), row])), [rows]);
  return (
    <>
      {error && <p role="status" className="muted">Additional entry details could not be loaded.</p>}
      {matches.map((match) => {
        const entry = entries.get(String(match.id));
        const unobtainable = entry && 'obtainable' in entry && entry.obtainable === false;
        const outOfGame = (entry && 'inGame' in entry && entry.inGame === false) || /(^| - )out of game$/i.test(match.detail);
        const unavailable = unobtainable ? 'unobtainable' : outOfGame ? 'out of game' : undefined;
        let icon = match.icon;
        if (entry && 'difficulty' in entry) icon = (entry.displayNPC ?? entry.startNPC)?.icon || icon;
        if (entry && 'infectedZone' in entry) icon = entry.firstEntry?.npc?.icon || entry.infectedZone?.icon || icon;
        const monster = entry && 'standardHP' in entry ? entry : undefined;
        const instance = entry && 'infectedZoneId' in entry ? entry : undefined;
        return (
          <div key={String(match.id)} className={'entity-index-row entity-ambiguity-row' + (unavailable ? ' entity-index-row-muted' : '')}>
            {type === 'monsters' && <AmbiguityMap location={monster?.firstLocation} icon={monster?.mapIcon} />}
            {type === 'instances' && <AmbiguityMap location={instance?.firstEntry?.entryLocation} icon={warpIcon(instance?.firstEntry?.npc?.name)} />}
            <Link className="entity-ambiguity-link" to={`/${build}/${type}/${match.routeId}`}
              aria-label={unavailable ? `${match.name} (${match.id}), ${unavailable}` : undefined}>
              <Icon src={icon || match.icon} size={48} className={type === 'items' ? 'icon-item' : undefined} />
              <span className="entity-ambiguity-labels">
                <span className="entity-ambiguity-name">
                  <span className="entity-index-link">{match.name}</span>
                  <code className="entity-index-id-code">{match.id}</code>
                </span>
                {entry ? <Details entry={entry} /> : type !== 'monsters' && match.detail && <span className="muted">{match.detail}</span>}
              </span>
            </Link>
          </div>
        );
      })}
    </>
  );
}
