import { useEffect, useState } from 'react';

export interface SearchRow {
  type: 'missions' | 'npcs' | 'items' | 'monsters' | 'areas' | 'instances' | 'nanos';
  id: number | string;
  name: string;
  icon: string;
}

const cache = new Map<string, SearchRow[]>();
const inflight = new Map<string, Promise<SearchRow[]>>();

async function load(slug: string): Promise<SearchRow[]> {
  const hit = cache.get(slug);
  if (hit) return hit;
  let p = inflight.get(slug);
  if (!p) {
    p = fetch(`/data/${slug}/search.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: SearchRow[]) => {
        cache.set(slug, rows);
        return rows;
      })
      .catch(() => [])
      .finally(() => inflight.delete(slug));
    inflight.set(slug, p);
  }
  return p;
}

export function useSearchIndex(slug: string | undefined): { rows: SearchRow[] | null; loading: boolean } {
  const [rows, setRows] = useState<SearchRow[] | null>(slug ? cache.get(slug) ?? null : null);
  const [loading, setLoading] = useState<boolean>(!!slug && !cache.has(slug));

  useEffect(() => {
    if (!slug) {
      setRows(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(!cache.has(slug));
    load(slug).then((r) => {
      if (alive) {
        setRows(r);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  return { rows, loading };
}
