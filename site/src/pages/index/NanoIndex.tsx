import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import Icon from '../../components/Icon';
import type { NanoIndexEntry } from '../../data/types';
import { useDelayedFlag } from '../../data/useDelayedFlag';

const PAGE_SIZE = 50;

const NANO_TYPE_TABS = ['Adaptium', 'Blastons', 'Cosmix'] as const;
type NanoTab = (typeof NANO_TYPE_TABS)[number] | 'All';

function tabFromParam(p: string | null): NanoTab {
  if (!p) return 'All';
  const lc = p.toLowerCase();
  for (const t of NANO_TYPE_TABS) {
    if (t.toLowerCase() === lc) return t;
  }
  return 'All';
}

interface Props {
  build: string;
  rows: NanoIndexEntry[];
  loading: boolean;
}

export default function NanoIndex({ build, rows, loading }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = tabFromParam(searchParams.get('type'));
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const showSkeleton = useDelayedFlag(loading);

  const visibleRows = useMemo(() => rows.filter((r) => r.id > 0), [rows]);

  const counts = useMemo(() => {
    const acc: Record<NanoTab, number> = { All: 0, Adaptium: 0, Blastons: 0, Cosmix: 0 };
    for (const r of visibleRows) {
      acc.All++;
      if ((NANO_TYPE_TABS as readonly string[]).includes(r.nanoType)) {
        acc[r.nanoType as NanoTab]++;
      }
    }
    return acc;
  }, [visibleRows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let pool = visibleRows;
    if (activeTab !== 'All') pool = pool.filter((r) => r.nanoType === activeTab);
    if (needle) pool = pool.filter((r) => r.name.toLowerCase().includes(needle));
    return pool.slice().sort((a, b) => a.id - b.id);
  }, [visibleRows, q, activeTab]);

  const start = page * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  function selectTab(t: NanoTab) {
    setPage(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (t === 'All') next.delete('type');
      else next.set('type', t.toLowerCase());
      return next;
    });
  }

  return (
    <>
      <p className="muted">{filtered.length.toLocaleString()} of {visibleRows.length.toLocaleString()}</p>

      <nav className="type-tabs" aria-label="Filter by nano type">
        {(['All', ...NANO_TYPE_TABS] as NanoTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={'type-tab' + (activeTab === t ? ' active' : '')}
            onClick={() => selectTab(t)}
            disabled={t !== 'All' && counts[t] === 0}
          >
            {t} <span className="type-tab-count">({counts[t].toLocaleString()})</span>
          </button>
        ))}
      </nav>

      <div className="index-controls">
        <input
          type="search"
          placeholder="Filter by name…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
          style={{ width: '100%', maxWidth: 360 }}
          aria-label="Filter nanos"
        />
      </div>

      {loading && showSkeleton && <EntityIndexSkeleton />}
      {!loading && filtered.length === 0 && <p className="muted">No matches.</p>}
      {!loading && filtered.length > 0 && (
        <>
          <table className="location-table source-table entity-index-table">
            <thead>
              <tr>
                <th>Nano</th>
                <th>Level</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="entity-index-name">
                      {r.icon
                        ? <Icon src={r.icon} alt={r.name} size={64} />
                        : <span className="icon icon-empty" aria-hidden />}
                      <Link className="entity-index-link" to={`/${build}/nanos/${r.id}`}>{r.name}</Link>
                    </div>
                  </td>
                  <td>{r.awardLevel > 0 ? r.awardLevel : <span className="muted">—</span>}</td>
                  <td>{r.nanoType || <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
