import { useEffect, useState } from 'react';
import { LruCache } from './lruCache';

export interface RouteEntityTarget {
  kind: 'entity';
  id: number | string;
  chunk: number;
  canonical: string;
}

export interface RouteAmbiguityMatch {
  id: number | string;
  name: string;
  routeId: string;
  icon: string;
  detail: string;
}

export interface RouteAmbiguityTarget {
  kind: 'ambiguity';
  canonical: string;
  title: string;
  matches: RouteAmbiguityMatch[];
}

export type RouteTarget = RouteEntityTarget | RouteAmbiguityTarget;
export type RouteMap = Record<string, RouteTarget>;

const cache = new LruCache<string, RouteMap>(64);
const inflight = new Map<string, Promise<RouteMap>>();

function keyFor(slug: string, type: string): string {
  return `${slug}::${type}`;
}

export async function loadRouteMap(slug: string, type: string): Promise<RouteMap> {
  const key = keyFor(slug, type);
  const hit = cache.get(key);
  if (hit) return hit;
  let p = inflight.get(key);
  if (!p) {
    p = fetch(`/data/${slug}/routes/${type}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((obj: RouteMap) => {
        cache.set(key, obj);
        return obj;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, p);
  }
  return p;
}

export function canonicalRoute(map: RouteMap | null, id: number | string): string {
  const target = map?.[String(id)];
  return target?.kind === 'entity' ? target.canonical : String(id);
}

export function useRouteMap(slug: string | undefined, type: string | undefined): RouteMap | null {
  const key = slug && type ? keyFor(slug, type) : '';
  const [state, setState] = useState<{ key: string; map: RouteMap | null }>(() => ({ key, map: null }));

  if (state.key !== key) {
    setState({ key, map: null });
  }

  useEffect(() => {
    if (!slug || !type) return;
    let alive = true;
    loadRouteMap(slug, type).then(
      (map) => {
        if (alive) setState({ key: keyFor(slug, type), map });
      },
      () => {
        if (alive) setState({ key: keyFor(slug, type), map: null });
      },
    );
    return () => {
      alive = false;
    };
  }, [key, slug, type]);

  return state.map;
}
