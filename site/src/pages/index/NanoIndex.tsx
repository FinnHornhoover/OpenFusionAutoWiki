import { useMemo, useState } from 'react';
import { useIndexSort } from '../../data/useIndexSort';
import { Link, useSearchParams } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import InfiniteScroll from '../../components/InfiniteScroll';
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
  const [hideUnobtainable, setHideUnobtainable] = useState(true);
  const hasNameFilter = q.trim().length > 0;
  const effectiveHideUnobtainable = hideUnobtainable && !hasNameFilter;
  const showSkeleton = useDelayedFlag(loading);

  const visibleRows = useMemo(() => rows.filter((r) => r.id > 0), [rows]);

  const counts = useMemo(() => {
    const acc: Record<NanoTab, number> = { All: 0, Adaptium: 0, Blastons: 0, Cosmix: 0 };
    for (const r of visibleRows) {
      if (effectiveHideUnobtainable && r.obtainable === false) continue;
      acc.All++;
      if ((NANO_TYPE_TABS as readonly string[]).includes(r.nanoType)) {
        acc[r.nanoType as NanoTab]++;
      }
    }
    return acc;
  }, [visibleRows, effectiveHideUnobtainable]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let pool = visibleRows;
    if (effectiveHideUnobtainable) pool = pool.filter((r) => r.obtainable !== false);
    if (activeTab !== 'All') pool = pool.filter((r) => r.nanoType === activeTab);
    if (needle) pool = pool.filter((r) => r.name.toLowerCase().includes(needle));
    return pool.slice().sort((a, b) => a.id - b.id);
  }, [visibleRows, q, activeTab, effectiveHideUnobtainable]);

  const { sortedRows, sortHeader, resetSortButton } = useIndexSort(filtered, {
    name: r => r.name, level: r => r.awardLevel ?? 0, type: r => r.nanoType,
  }, () => setPage(0));
  const renderedRows = sortedRows.slice(0, (page + 1) * PAGE_SIZE);
  const hasMore = renderedRows.length < filtered.length;

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
            data-combat-type={t === 'All' ? undefined : t}
            onClick={() => selectTab(t)}
            disabled={t !== 'All' && counts[t] === 0}
          >
            {t} <span className="type-tab-count">({counts[t].toLocaleString()})</span>
          </button>
        ))}
      </nav>

      <div className="index-controls">
        {resetSortButton}
        <input
          type="search"
          placeholder="Filter by name…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
          style={{ width: '100%', maxWidth: 360 }}
          aria-label="Filter nanos"
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={effectiveHideUnobtainable}
            disabled={hasNameFilter}
            onChange={(e) => { setHideUnobtainable(e.target.checked); setPage(0); }}
          />
          <span>Hide unobtainable</span>
        </label>
      </div>

      {loading && showSkeleton && <EntityIndexSkeleton />}
      {!loading && filtered.length === 0 && <p className="muted">No matches.</p>}
      {!loading && filtered.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="location-table source-table entity-index-table">
              <thead>
                <tr>
                  {sortHeader('name', 'Nano')}
                  {sortHeader('level', 'Level')}
                  {sortHeader('type', 'Type')}
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((r) => (
                  <tr key={r.id} className={r.obtainable === false ? 'entity-index-row-muted' : undefined}>
                    <td>
                      <div className="entity-index-name">
                        {r.icon
                          ? <Icon src={r.icon} alt={r.name} size={64} />
                          : <span className="icon icon-empty" aria-hidden />}
                        <Link className="entity-index-link" to={`/${build}/nanos/${r.routeId ?? r.id}`}>{r.name}</Link>
                      </div>
                    </td>
                    <td>{r.awardLevel ?? 0}</td>
                    <td>{r.nanoType || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <InfiniteScroll
            hasMore={hasMore}
            shown={renderedRows.length}
            total={filtered.length}
            onLoadMore={() => setPage((current) => current + 1)}
          />
        </>
      )}
    </>
  );
}
