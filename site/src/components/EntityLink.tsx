import { Link, useParams } from 'react-router-dom';
import type { MissionIndexEntry, Ref } from '../data/types';
import { canonicalRoute, useRouteMap } from '../data/routeMap';
import { useBuildMeta } from '../data/useBuildMeta';
import { useIndex } from '../data/useIndex';
import Icon from './Icon';

/** Entity type → URL segment used in routes. */
const ROUTE_FOR: Record<Ref['type'], string> = {
  mission: 'missions',
  npc: 'npcs',
  item: 'items',
  monster: 'monsters',
  nano: 'nanos',
  instance: 'instances',
  'infected-zone': 'infected-zones',
  code: 'codes',
  'item-set': 'item-sets',
};

interface EntityLinkProps {
  /** The target entity. Named `entity` (not `ref`) because React reserves `ref` for forwardRef. */
  entity?: Ref | null;
  withIcon?: boolean;
  iconSize?: number;
}

/**
 * Renders a cross-reference as a link when the target entity type is built
 * for the current build, otherwise as plain text. Always shows the icon if
 * one is known.
 */
export default function EntityLink({ entity, withIcon = true, iconSize = 96 }: EntityLinkProps) {
  const { build } = useParams();
  const meta = useBuildMeta(build);
  const route = entity ? ROUTE_FOR[entity.type] : undefined;
  const isBuilt = Boolean(build) && Boolean(route) && Boolean(meta?.builtTypes?.includes(route!));
  const routes = useRouteMap(isBuilt ? build : undefined, isBuilt ? route : undefined);
  const { rows: missionRows } = useIndex<MissionIndexEntry>(
    entity?.type === 'mission' ? build : undefined,
    entity?.type === 'mission' ? 'missions' : undefined,
  );

  if (!entity || !route) return null;
  const routeId = canonicalRoute(routes, entity.id);
  const mission = entity.type === 'mission'
    ? missionRows?.find((row) => String(row.id) === String(entity.id))
    : undefined;
  const missionMeta = mission
    ? [mission.level > 0 ? `Lv${mission.level}` : '', mission.type].filter(Boolean).join(' ')
    : '';
  const icon = entity.icon || mission?.displayNPC?.icon || '';
  const name = <span className="entity-link-name">{entity.name}</span>;

  const body = (
    <span className="entity-link-body">
      {withIcon && icon ? <Icon src={icon} alt={entity.name} size={iconSize} className={entity.type === 'item' ? 'icon-item' : undefined} /> : null}
      {missionMeta ? (
        <span className="mission-link-text">
          <span className="mission-link-meta">{missionMeta}</span>
          {name}
        </span>
      ) : name}
    </span>
  );

  if (isBuilt) {
    return (
      <Link className="entity-link" to={`/${build}/${route}/${routeId}`}>
        {body}
      </Link>
    );
  }
  return <span className="entity-link entity-link-unbuilt">{body}</span>;
}
