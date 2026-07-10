import { Link, useParams } from 'react-router-dom';
import type { Ref } from '../data/types';
import { canonicalRoute, useRouteMap } from '../data/routeMap';
import { useBuildMeta } from '../data/useBuildMeta';
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

  if (!entity || !route) return null;
  const routeId = canonicalRoute(routes, entity.id);

  const body = (
    <span className="entity-link-body">
      {withIcon && entity.icon ? <Icon src={entity.icon} alt={entity.name} size={iconSize} /> : null}
      <span className="entity-link-name">{entity.name}</span>
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
