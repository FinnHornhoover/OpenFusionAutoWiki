import { useEffect, useState } from 'react';

const CHUNK_SIZE = 250;

function chunkOf(id: number): number {
  return Math.floor(id / CHUNK_SIZE);
}

const cache = new Map<string, Record<string, unknown>>();
const inflight = new Map<string, Promise<Record<string, unknown>>>();

function chunkKey(slug: string, type: string, chunk: number): string {
  return `${slug}::${type}::${chunk}`;
}

async function loadChunk(slug: string, type: string, chunk: number): Promise<Record<string, unknown>> {
  const k = chunkKey(slug, type, chunk);
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

interface InternalState<T> {
  key: string;
  result: UseEntityResult<T>;
}

function initialState<T>(key: string): InternalState<T> {
  return { key, result: { entity: null, loading: !!key, notFound: !key } };
}

export function useEntity<T>(
  slug: string | undefined,
  type: string | undefined,
  id: string | undefined,
): UseEntityResult<T> {
  const key = slug && type && id ? `${slug}::${type}::${id}` : '';
  const [state, setState] = useState<InternalState<T>>(() => initialState<T>(key));

  // Sync invalidation when the target changes. React permits setState during render
  // if conditional — it re-renders with the new state before committing.
  if (state.key !== key) {
    setState(initialState<T>(key));
  }

  useEffect(() => {
    if (!key) return;
    const numericId = parseInt(id!, 10);
    if (!Number.isFinite(numericId)) {
      setState({ key, result: { entity: null, loading: false, notFound: true } });
      return;
    }
    let alive = true;
    loadChunk(slug!, type!, chunkOf(numericId)).then((bucket) => {
      if (!alive) return;
      const found = bucket[String(numericId)] as T | undefined;
      setState({
        key,
        result: found
          ? { entity: found, loading: false, notFound: false }
          : { entity: null, loading: false, notFound: true },
      });
    });
    return () => {
      alive = false;
    };
  }, [key, slug, type, id]);

  return state.result;
}
