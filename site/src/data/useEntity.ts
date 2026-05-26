import { useEffect, useState } from 'react';

const CHUNK_SIZE = 250;

/**
 * Type-aware chunk computation. Most entity types address by a numeric id; items
 * use a compound URL id "typeId-itemId" that maps onto the same numeric space the
 * build pipeline uses (typeId * 10000 + itemId); areas use a string slug and the
 * build pipeline puts them all in chunk 0 (there are only ~70 per build). NPC
 * ambiguity pages use name slugs and also live in chunk 0.
 */
function chunkFor(type: string, urlId: string): number {
  if (type === 'areas' || type === 'instances') return 0;
  if (type === 'npcs' && !/^\d+$/.test(urlId)) return 0;
  if (type === 'items') {
    const m = /^(\d+)-(\d+)$/.exec(urlId);
    if (!m) return -1;
    return Math.floor((parseInt(m[1], 10) * 10000 + parseInt(m[2], 10)) / CHUNK_SIZE);
  }
  const n = parseInt(urlId, 10);
  return Number.isFinite(n) ? Math.floor(n / CHUNK_SIZE) : -1;
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
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((obj: Record<string, unknown>) => {
        cache.set(k, obj);
        return obj;
      })
      .finally(() => {
        inflight.delete(k);
      });
    inflight.set(k, p);
  }
  return p;
}

export interface UseEntityResult<T> {
  entity: T | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

interface InternalState<T> {
  key: string;
  result: UseEntityResult<T>;
}

function initialState<T>(key: string): InternalState<T> {
  return {
    key,
    result: { entity: null, loading: !!key, notFound: !key, error: null },
  };
}

export function useEntity<T>(
  slug: string | undefined,
  type: string | undefined,
  id: string | undefined,
): UseEntityResult<T> {
  const key = slug && type && id ? `${slug}::${type}::${id}` : '';
  const [state, setState] = useState<InternalState<T>>(() => initialState<T>(key));

  if (state.key !== key) {
    setState(initialState<T>(key));
  }

  useEffect(() => {
    if (!key) return;
    const chunk = chunkFor(type!, id!);
    if (chunk < 0) {
      setState({ key, result: { entity: null, loading: false, notFound: true, error: null } });
      return;
    }
    let alive = true;
    loadChunk(slug!, type!, chunk).then(
      (bucket) => {
        if (!alive) return;
        const found = bucket[id!] as T | undefined;
        setState({
          key,
          result: found
            ? { entity: found, loading: false, notFound: false, error: null }
            : { entity: null, loading: false, notFound: true, error: null },
        });
      },
      (err: unknown) => {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : 'Failed to load entity';
        setState({ key, result: { entity: null, loading: false, notFound: false, error: msg } });
      },
    );
    return () => {
      alive = false;
    };
  }, [key, slug, type, id]);

  return state.result;
}
