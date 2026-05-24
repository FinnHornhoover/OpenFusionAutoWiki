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
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data: BuildEntry[]) => {
      cache = Array.isArray(data) ? data : [];
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export interface UseManifestResult {
  manifest: BuildEntry[] | null;
  loading: boolean;
  error: string | null;
}

export function useManifest(): UseManifestResult {
  const [state, setState] = useState<UseManifestResult>({
    manifest: cache,
    loading: cache === null,
    error: null,
  });

  useEffect(() => {
    if (cache !== null) return;
    let alive = true;
    loadManifest().then(
      (m) => { if (alive) setState({ manifest: m, loading: false, error: null }); },
      (err: unknown) => {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : 'Failed to load builds';
        setState({ manifest: null, loading: false, error: msg });
      },
    );
    return () => { alive = false; };
  }, []);

  return state;
}
