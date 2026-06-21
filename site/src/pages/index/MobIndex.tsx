import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import Icon from '../../components/Icon';
import type { MobIndexEntry } from '../../data/types';
import { useDelayedFlag } from '../../data/useDelayedFlag';

const PAGE_SIZE = 50;

/** Corruption flavor tabs. */
const COLOR_TYPE_TABS = ['Adaptium', 'Blastons', 'Cosmix'] as const;
type ColorTab = (typeof COLOR_TYPE_TABS)[number] | 'All';

function tabFromParam(p: string | null): ColorTab {
  if (!p) return 'All';
  const lc = p.toLowerCase();
  for (const t of COLOR_TYPE_TABS) {
    if (t.toLowerCase() === lc) return t;
  }
  return 'All';
}

interface Props {
  build: string;
  rows: MobIndexEntry[];
  loading: boolean;
}

export default function MobIndex({ build, rows, loading }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = tabFromParam(searchParams.get('color'));
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [hideOutOfGame, setHideOutOfGame] = useState(true);
  const showSkeleton = useDelayedFlag(loading);

  const counts = useMemo(() => {
    const acc: Record<ColorTab, number> = { All: 0, Adaptium: 0, Blastons: 0, Cosmix: 0 };
    for (const r of rows) {
      if (hideOutOfGame && !r.inGame) continue;
      acc.All++;
      if ((COLOR_TYPE_TABS as readonly string[]).includes(r.colorType)) {
        acc[r.colorType as ColorTab]++;
      }
    }
    return acc;
  }, [rows, hideOutOfGame]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let pool = rows;
    if (hideOutOfGame) pool = pool.filter((r) => r.inGame);
    if (activeTab !== 'All') pool = pool.filter((r) => r.colorType === activeTab);
    if (needle) pool = pool.filter((r) => r.name.toLowerCase().includes(needle));
    return pool.slice().sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      if (a.standardHP !== b.standardHP) return a.standardHP - b.standardHP;
      return a.name.localeCompare(b.name) || a.id - b.id;
    });
  }, [rows, q, activeTab, hideOutOfGame]);

  const start = page * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  function selectTab(t: ColorTab) {
    setPage(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (t === 'All') next.delete('color');
      else next.set('color', t.toLowerCase());
      return next;
    });
  }

  return (
    <>
      <p className="muted">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()}</p>

      <nav className="type-tabs" aria-label="Filter by color type">
        {(['All', ...COLOR_TYPE_TABS] as ColorTab[]).map((t) => (
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
          aria-label="Filter monsters"
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={hideOutOfGame}
            onChange={(e) => { setHideOutOfGame(e.target.checked); setPage(0); }}
          />
          <span>Hide out-of-game monsters</span>
        </label>
      </div>

      {loading && showSkeleton && <EntityIndexSkeleton />}
      {!loading && filtered.length === 0 && <p className="muted">No matches.</p>}
      {!loading && filtered.length > 0 && (
        <>
          <table className="location-table source-table entity-index-table">
            <thead>
              <tr>
                <th>Monster</th>
                <th>Level</th>
                <th>HP</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className={r.inGame ? undefined : 'entity-index-row-muted'}>
                  <td>
                    <div className="entity-index-name">
                      {r.icon
                        ? <Icon src={r.icon} alt={r.name} size={64} />
                        : <span className="icon icon-empty" aria-hidden />}
                      <Link className="entity-index-link" to={`/${build}/monsters/${r.id}`}>{r.name}</Link>
                    </div>
                  </td>
                  <td>{r.level > 0 ? r.level : <span className="muted">—</span>}</td>
                  <td>{r.standardHP > 0 ? r.standardHP.toLocaleString() : <span className="muted">—</span>}</td>
                  <td>{r.colorType || <span className="muted">—</span>}</td>
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
