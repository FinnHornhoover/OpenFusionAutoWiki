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
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((rows: unknown[]) => {
        cache.set(k, rows);
        return rows;
      })
      .finally(() => {
        inflight.delete(k);
      }) as Promise<unknown[]>;
    inflight.set(k, p);
  }
  return p as Promise<T[]>;
}

export interface UseIndexResult<T> {
  rows: T[] | null;
  loading: boolean;
  error: string | null;
}

interface InternalState<T> {
  key: string;
  result: UseIndexResult<T>;
}

function initialState<T>(k: string): InternalState<T> {
  if (!k) return { key: k, result: { rows: null, loading: false, error: null } };
  const cached = cache.get(k) as T[] | undefined;
  return cached
    ? { key: k, result: { rows: cached, loading: false, error: null } }
    : { key: k, result: { rows: null, loading: true, error: null } };
}

export function useIndex<T>(slug: string | undefined, type: string | undefined): UseIndexResult<T> {
  const k = slug && type ? key(slug, type) : '';
  const [state, setState] = useState<InternalState<T>>(() => initialState<T>(k));

  if (state.key !== k) {
    setState(initialState<T>(k));
  }

  useEffect(() => {
    if (!k) return;
    let alive = true;
    load<T>(slug!, type!).then(
      (rows) => { if (alive) setState({ key: k, result: { rows, loading: false, error: null } }); },
      (err: unknown) => {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : 'Failed to load';
        setState({ key: k, result: { rows: null, loading: false, error: msg } });
      },
    );
    return () => {
      alive = false;
    };
  }, [k, slug, type]);

  return state.result;
}
