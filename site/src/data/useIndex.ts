import { useEffect, useState } from 'react';

const cache = new Map<string, unknown[]>();
const inflight = new Map<string, Promise<unknown[]>>();

function key(slug: string, type: string): string {
  return `${slug}::${type}`;
}

async function load<T>(slug: string, type: string): Promise<T[]> {
  const k = key(slug, type);
  const hit = cache.get(k);
  if (hit) return hit as T[];
  let p = inflight.get(k);
  if (!p) {
    p = fetch(`/data/${slug}/index/${type}.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: unknown[]) => {
        cache.set(k, rows);
        return rows;
      })
      .catch(() => [])
      .finally(() => inflight.delete(k)) as Promise<unknown[]>;
    inflight.set(k, p);
  }
  return p as Promise<T[]>;
}

export interface UseIndexResult<T> {
  rows: T[] | null;
  loading: boolean;
}

export function useIndex<T>(slug: string | undefined, type: string | undefined): UseIndexResult<T> {
  const k = slug && type ? key(slug, type) : '';
  const [rows, setRows] = useState<T[] | null>(k ? (cache.get(k) as T[] | undefined) ?? null : null);
  const [loading, setLoading] = useState<boolean>(!!k && !cache.has(k));

  useEffect(() => {
    if (!slug || !type) {
      setRows(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(!cache.has(key(slug, type)));
    load<T>(slug, type).then((r) => {
      if (alive) {
        setRows(r);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [slug, type]);

  return { rows, loading };
}
