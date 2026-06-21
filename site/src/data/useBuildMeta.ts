import { useEffect, useState } from 'react';
import { LruCache } from './lruCache';
import type { BuildMeta } from './types';

const cache = new LruCache<string, BuildMeta>(24);
const inflight = new Map<string, Promise<BuildMeta>>();

async function load(slug: string): Promise<BuildMeta> {
  const hit = cache.get(slug);
  if (hit) return hit;
  let p = inflight.get(slug);
  if (!p) {
    p = fetch(`/data/${slug}/meta.json`)
      .then((r) => (r.ok ? r.json() : { builtTypes: [] }))
      .then((m: BuildMeta) => {
        cache.set(slug, m);
        return m;
      })
      .catch(() => ({ builtTypes: [] }))
      .finally(() => inflight.delete(slug)) as Promise<BuildMeta>;
    inflight.set(slug, p);
  }
  return p;
}

export function useBuildMeta(slug: string | undefined): BuildMeta | null {
  const [meta, setMeta] = useState<BuildMeta | null>(slug ? cache.get(slug) ?? null : null);
  useEffect(() => {
    if (!slug) {
      setMeta(null);
      return;
    }
    let alive = true;
    load(slug).then((m) => {
      if (alive) setMeta(m);
    });
    return () => {
      alive = false;
    };
  }, [slug]);
  return meta;
}
