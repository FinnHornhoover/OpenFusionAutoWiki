import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import type { AreaIndexEntry } from '../../data/types';
import { useDelayedFlag } from '../../data/useDelayedFlag';

const PAGE_SIZE = 50;

interface Props {
  build: string;
  rows: AreaIndexEntry[];
  loading: boolean;
}

export default function AreaIndex({ build, rows, loading }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeZone = searchParams.get('zone') ?? 'All';
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const showSkeleton = useDelayedFlag(loading);

  // Zones are derived from the data — every build can have a different set.
  const zoneTabs = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.zoneName) set.add(r.zoneName);
    }
    return ['All', ...[...set].sort()];
  }, [rows]);

  const counts = useMemo(() => {
    const acc: Record<string, number> = { All: 0 };
    for (const z of zoneTabs) if (z !== 'All') acc[z] = 0;
    for (const r of rows) {
      acc.All++;
      if (r.zoneName && acc[r.zoneName] !== undefined) acc[r.zoneName]++;
    }
    return acc;
  }, [rows, zoneTabs]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let pool = rows;
    if (activeZone !== 'All') pool = pool.filter((r) => r.zoneName === activeZone);
    if (needle) pool = pool.filter((r) => r.name.toLowerCase().includes(needle) || r.zoneName.toLowerCase().includes(needle));
    return pool.slice().sort((a, b) => a.zoneName.localeCompare(b.zoneName) || a.name.localeCompare(b.name));
  }, [rows, q, activeZone]);

  const start = page * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  function selectZone(z: string) {
    setPage(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (z === 'All') next.delete('zone');
      else next.set('zone', z);
      return next;
    });
  }

  return (
    <>
      <p className="muted">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()}</p>

      <nav className="type-tabs" aria-label="Filter by zone">
        {zoneTabs.map((z) => (
          <button
            key={z}
            type="button"
            className={'type-tab' + (activeZone === z ? ' active' : '')}
            onClick={() => selectZone(z)}
            disabled={z !== 'All' && counts[z] === 0}
          >
            {z} <span className="type-tab-count">({counts[z].toLocaleString()})</span>
          </button>
        ))}
      </nav>

      <input
        type="search"
        placeholder="Filter by name…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setPage(0); }}
        style={{ width: '100%', maxWidth: 360, marginBottom: 'var(--space-4)' }}
        aria-label="Filter areas"
      />

      {loading && showSkeleton && <EntityIndexSkeleton />}
      {!loading && filtered.length === 0 && <p className="muted">No matches.</p>}
      {!loading && filtered.length > 0 && (
        <>
          <ul className="entity-index">
            {pageRows.map((r) => (
              <li key={r.id} className="entity-index-row">
                <span className="entity-index-main">
                  <Link to={`/${build}/areas/${r.id}`}>{r.name}</Link>
                  <span className="muted">
                    {r.zoneName && ` · ${r.zoneName}`}
                    {r.missionCount > 0 && ` · ${r.missionCount} mission${r.missionCount === 1 ? '' : 's'}`}
                    {r.npcCount > 0 && ` · ${r.npcCount} NPC type${r.npcCount === 1 ? '' : 's'}`}
                    {r.mobCount > 0 && ` · ${r.mobCount} mob type${r.mobCount === 1 ? '' : 's'}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <nav className="pager" aria-label="Pagination">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>‹ Prev</button>
              <span className="muted">Page {page + 1} / {totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>Next ›</button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
