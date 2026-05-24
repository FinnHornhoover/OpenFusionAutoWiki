import { useEffect, useState } from 'react';

export interface BuildEntry {
  slug: string;
  officialName: string;
  rev: string;
  nickname: string;
  fixed: boolean;
  displayName: string;
  date: string;
  tags: string[];
}

let cache: BuildEntry[] | null = null;
let inflight: Promise<BuildEntry[]> | null = null;

async function loadManifest(): Promise<BuildEntry[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch('/builds.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((data: BuildEntry[]) => {
      cache = Array.isArray(data) ? data : [];
      return cache;
    })
    .catch(() => {
      cache = [];
      return cache;
    });
  return inflight;
}

export function useManifest() {
  const [manifest, setManifest] = useState<BuildEntry[] | null>(cache);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    let alive = true;
    if (cache === null) {
      loadManifest().then((m) => {
        if (alive) {
          setManifest(m);
          setLoading(false);
        }
      });
    }
    return () => {
      alive = false;
    };
  }, []);

  return { manifest, loading };
}
