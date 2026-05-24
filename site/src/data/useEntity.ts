import { useEffect, useState } from 'react';

const CHUNK_SIZE = 250;

function chunkOf(id: number): number {
  return Math.floor(id / CHUNK_SIZE);
}

const cache = new Map<string, Record<string, unknown>>();
const inflight = new Map<string, Promise<Record<string, unknown>>>();

function key(slug: string, type: string, chunk: number): string {
  return `${slug}::${type}::${chunk}`;
}

async function loadChunk(slug: string, type: string, chunk: number): Promise<Record<string, unknown>> {
  const k = key(slug, type, chunk);
  const hit = cache.get(k);
  if (hit) return hit;
  let p = inflight.get(k);
  if (!p) {
    p = fetch(`/data/${slug}/${type}/${chunk}.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((obj: Record<string, unknown>) => {
        cache.set(k, obj);
        return obj;
      })
      .catch(() => ({}))
      .finally(() => inflight.delete(k));
    inflight.set(k, p);
  }
  return p;
}

export interface UseEntityResult<T> {
  entity: T | null;
  loading: boolean;
  notFound: boolean;
}

export function useEntity<T>(
  slug: string | undefined,
  type: string | undefined,
  id: string | undefined,
): UseEntityResult<T> {
  const [state, setState] = useState<UseEntityResult<T>>({ entity: null, loading: true, notFound: false });

  useEffect(() => {
    if (!slug || !type || !id) {
      setState({ entity: null, loading: false, notFound: true });
      return;
    }
    const numericId = parseInt(id, 10);
    if (!Number.isFinite(numericId)) {
      setState({ entity: null, loading: false, notFound: true });
      return;
    }
    let alive = true;
    setState({ entity: null, loading: true, notFound: false });
    loadChunk(slug, type, chunkOf(numericId)).then((bucket) => {
      if (!alive) return;
      const found = bucket[String(numericId)] as T | undefined;
      setState(found
        ? { entity: found, loading: false, notFound: false }
        : { entity: null, loading: false, notFound: true });
    });
    return () => {
      alive = false;
    };
  }, [slug, type, id]);

  return state;
}
