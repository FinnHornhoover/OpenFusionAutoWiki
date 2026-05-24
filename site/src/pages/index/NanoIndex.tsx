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

  const counts = useMemo(() => {
    const acc: Record<NanoTab, number> = { All: 0, Adaptium: 0, Blastons: 0, Cosmix: 0 };
    for (const r of rows) {
      acc.All++;
      if ((NANO_TYPE_TABS as readonly string[]).includes(r.nanoType)) {
        acc[r.nanoType as NanoTab]++;
      }
    }
    return acc;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let pool = rows;
    if (activeTab !== 'All') pool = pool.filter((r) => r.nanoType === activeTab);
    if (needle) pool = pool.filter((r) => r.name.toLowerCase().includes(needle));
    return pool.slice().sort((a, b) => a.id - b.id);
  }, [rows, q, activeTab]);

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
      <p className="muted">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()}</p>

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

      <input
        type="search"
        placeholder="Filter by name…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setPage(0); }}
        style={{ width: '100%', maxWidth: 360, marginBottom: 'var(--space-4)' }}
        aria-label="Filter nanos"
      />

      {loading && showSkeleton && <EntityIndexSkeleton />}
      {!loading && filtered.length === 0 && <p className="muted">No matches.</p>}
      {!loading && filtered.length > 0 && (
        <>
          <ul className="entity-index">
            {pageRows.map((r) => (
              <li key={r.id} className="entity-index-row">
                {r.icon
                  ? <Icon src={r.icon} alt={r.name} size={112} />
                  : <span className="icon icon-empty" aria-hidden style={{ width: 112, height: 112 }} />}
                <span className="entity-index-main">
                  <Link to={`/${build}/nanos/${r.id}`}>{r.name}</Link>
                  <span className="muted">
                    {r.awardLevel > 0 && ` · Lv ${r.awardLevel}`}
                    {r.nanoType && ` · ${r.nanoType}`}
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
