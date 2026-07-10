import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import Icon from '../../components/Icon';
import IndexFilterDropdown from '../../components/IndexFilterDropdown';
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

function parseCsvParam(value: string | null): Set<string> {
  return new Set((value ?? '').split(',').map((v) => v.trim()).filter(Boolean));
}

function serializeCsvParam(values: Iterable<string>): string | null {
  const sorted = [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return sorted.length > 0 ? sorted.join(',') : null;
}

interface Props {
  build: string;
  rows: MobIndexEntry[];
  loading: boolean;
}

export default function MobIndex({ build, rows, loading }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = tabFromParam(searchParams.get('color'));
  const activeLevels = useMemo(() => parseCsvParam(searchParams.get('levels')), [searchParams]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [hideOutOfGame, setHideOutOfGame] = useState(true);
  const showSkeleton = useDelayedFlag(loading);

  const levelOptions = useMemo(() => {
    return [...new Set(rows.map((r) => r.level).filter((level) => level > 0))].sort((a, b) => a - b);
  }, [rows]);

  const counts = useMemo(() => {
    const acc: Record<ColorTab, number> = { All: 0, Adaptium: 0, Blastons: 0, Cosmix: 0 };
    for (const r of rows) {
      if (hideOutOfGame && !r.inGame) continue;
      if (activeLevels.size > 0 && !activeLevels.has(String(r.level))) continue;
      acc.All++;
      if ((COLOR_TYPE_TABS as readonly string[]).includes(r.colorType)) {
        acc[r.colorType as ColorTab]++;
      }
    }
    return acc;
  }, [rows, hideOutOfGame, activeLevels]);

  const levelCounts = useMemo(() => {
    const acc = new Map<number, number>();
    for (const level of levelOptions) acc.set(level, 0);
    for (const r of rows) {
      if (hideOutOfGame && !r.inGame) continue;
      if (activeTab !== 'All' && r.colorType !== activeTab) continue;
      if (r.level > 0) acc.set(r.level, (acc.get(r.level) ?? 0) + 1);
    }
    return acc;
  }, [activeTab, hideOutOfGame, levelOptions, rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let pool = rows;
    if (hideOutOfGame) pool = pool.filter((r) => r.inGame);
    if (activeTab !== 'All') pool = pool.filter((r) => r.colorType === activeTab);
    if (activeLevels.size > 0) pool = pool.filter((r) => activeLevels.has(String(r.level)));
    if (needle) pool = pool.filter((r) => r.name.toLowerCase().includes(needle));
    return pool.slice().sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      if (a.standardHP !== b.standardHP) return a.standardHP - b.standardHP;
      return a.name.localeCompare(b.name) || a.id - b.id;
    });
  }, [rows, q, activeTab, activeLevels, hideOutOfGame]);

  const start = page * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  function updateParam(name: string, value: string | null) {
    setPage(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === null) next.delete(name);
      else next.set(name, value);
      return next;
    });
  }

  function selectTab(t: ColorTab) {
    updateParam('color', t === 'All' ? null : t.toLowerCase());
  }

  function toggleLevel(level: number) {
    const next = new Set(activeLevels);
    const value = String(level);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    updateParam('levels', serializeCsvParam(next));
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
        <IndexFilterDropdown summary={<>Level {activeLevels.size > 0 && <span className="type-tab-count">({activeLevels.size})</span>}</>}>
            <button type="button" className="link-button" onClick={() => updateParam('levels', null)} disabled={activeLevels.size === 0}>Clear levels</button>
            <div className="index-filter-options">
              {levelOptions.map((level) => (
                <label key={level} className="checkbox index-filter-option">
                  <input
                    type="checkbox"
                    checked={activeLevels.has(String(level))}
                    onChange={() => toggleLevel(level)}
                    disabled={(levelCounts.get(level) ?? 0) === 0}
                  />
                  <span>Level {level} <span className="type-tab-count">({(levelCounts.get(level) ?? 0).toLocaleString()})</span></span>
                </label>
              ))}
            </div>
        </IndexFilterDropdown>
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
          <div className="table-scroll">
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
                        <Link className="entity-index-link" to={`/${build}/monsters/${r.routeId ?? r.id}`}>{r.name}</Link>
                      </div>
                    </td>
                    <td>{r.level > 0 ? r.level : <span className="muted">—</span>}</td>
                    <td>{r.standardHP > 0 ? r.standardHP.toLocaleString() : <span className="muted">—</span>}</td>
                    <td>{r.colorType || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
