import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useRouteMap } from '../data/routeMap';

export default function AmbiguityLink() {
  const { build, type, id } = useParams();
  const routes = useRouteMap(build, type);
  const ambiguity = useMemo(() => {
    if (!routes || !id) return;
    const target = routes[id];
    if (!target || target.kind !== 'entity') return;
    return Object.values(routes).find((route) => route.kind === 'ambiguity'
      && route.matches.some((match) => match.routeId === target.canonical));
  }, [routes, id]);
  if (!ambiguity || ambiguity.kind !== 'ambiguity') return null;
  return (
    <p className="muted">
      See also: <Link to={`/${build}/${type}/${ambiguity.canonical}`}>{ambiguity.title} (Ambiguity)</Link>
    </p>
  );
}
