import { Link, useParams } from 'react-router-dom';
import type { Ref } from '../data/types';
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
};

interface EntityLinkProps {
  ref?: Ref | null;
  withIcon?: boolean;
  iconSize?: number;
}

/**
 * Renders a cross-reference as a link when the target entity type is built
 * for the current build, otherwise as plain text. Always shows the icon if
 * one is known.
 */
export default function EntityLink({ ref, withIcon = true, iconSize = 24 }: EntityLinkProps) {
  const { build } = useParams();
  const meta = useBuildMeta(build);
  if (!ref) return null;

  const route = ROUTE_FOR[ref.type];
  const isBuilt = Boolean(build) && Boolean(meta?.builtTypes?.includes(route));

  const body = (
    <span className="entity-link-body">
      {withIcon && ref.icon ? <Icon src={ref.icon} alt={ref.name} size={iconSize} /> : null}
      <span className="entity-link-name">{ref.name}</span>
    </span>
  );

  if (isBuilt) {
    return (
      <Link className="entity-link" to={`/${build}/${route}/${ref.id}`}>
        {body}
      </Link>
    );
  }
  return <span className="entity-link entity-link-unbuilt">{body}</span>;
}
