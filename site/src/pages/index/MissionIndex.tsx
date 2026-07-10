import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import Icon from '../../components/Icon';
import IndexFilterDropdown from '../../components/IndexFilterDropdown';
import type { MissionIndexEntry } from '../../data/types';
import { useDelayedFlag } from '../../data/useDelayedFlag';

const PAGE_SIZE = 50;

/** Visible mission types, in display order. "None" is intentionally hidden. */
const MISSION_TYPE_TABS = ['Normal', 'Guide', 'Nano'] as const;
type MissionTab = (typeof MISSION_TYPE_TABS)[number] | 'All';

const MISSION_TYPE_RANK = new Map<string, number>(
  MISSION_TYPE_TABS.map((t, i) => [t, i] as const),
);
function missionTypeRank(t: string): number {
  return MISSION_TYPE_RANK.get(t) ?? MISSION_TYPE_TABS.length;
}

function parseCsvParam(value: string | null): Set<string> {
  return new Set((value ?? '').split(',').map((v) => v.trim()).filter(Boolean));
}

function serializeCsvParam(values: Iterable<string>): string | null {
  const sorted = [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return sorted.length > 0 ? sorted.join(',') : null;
}

function tabFromParam(p: string | null): MissionTab {
  if (!p) return 'All';
  const lc = p.toLowerCase();
  for (const t of MISSION_TYPE_TABS) {
    if (t.toLowerCase() === lc) return t;
  }
  return 'All';
}

interface Props {
  build: string;
  rows: MissionIndexEntry[];
  loading: boolean;
}

export default function MissionIndex({ build, rows, loading }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = tabFromParam(searchParams.get('type'));
  const activeLevels = useMemo(() => parseCsvParam(searchParams.get('levels')), [searchParams]);
  const activeDifficulties = useMemo(() => parseCsvParam(searchParams.get('difficulty')), [searchParams]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const showSkeleton = useDelayedFlag(loading);

  const levelOptions = useMemo(() => {
    return [...new Set(rows.map((r) => r.level).filter((level) => level > 0))].sort((a, b) => a - b);
  }, [rows]);

  const difficultyOptions = useMemo(() => {
    return [...new Set(rows.map((r) => r.difficulty).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [rows]);

  const counts = useMemo(() => {
    const acc: Record<MissionTab, number> = { All: 0, Normal: 0, Guide: 0, Nano: 0 };
    for (const r of rows) {
      if (activeLevels.size > 0 && !activeLevels.has(String(r.level))) continue;
      if (activeDifficulties.size > 0 && !activeDifficulties.has(r.difficulty)) continue;
      acc.All++;
      if ((MISSION_TYPE_TABS as readonly string[]).includes(r.type)) {
        acc[r.type as MissionTab]++;
      }
    }
    return acc;
  }, [rows, activeDifficulties, activeLevels]);

  const levelCounts = useMemo(() => {
    const acc = new Map<number, number>();
    for (const level of levelOptions) acc.set(level, 0);
    for (const r of rows) {
      if (activeTab !== 'All' && r.type !== activeTab) continue;
      if (activeDifficulties.size > 0 && !activeDifficulties.has(r.difficulty)) continue;
      if (r.level > 0) acc.set(r.level, (acc.get(r.level) ?? 0) + 1);
    }
    return acc;
  }, [activeDifficulties, activeTab, levelOptions, rows]);

  const difficultyCounts = useMemo(() => {
    const acc = new Map<string, number>();
    for (const difficulty of difficultyOptions) acc.set(difficulty, 0);
    let all = 0;
    for (const r of rows) {
      if (activeTab !== 'All' && r.type !== activeTab) continue;
      if (activeLevels.size > 0 && !activeLevels.has(String(r.level))) continue;
      all++;
      if (r.difficulty) acc.set(r.difficulty, (acc.get(r.difficulty) ?? 0) + 1);
    }
    return { all, byDifficulty: acc };
  }, [activeLevels, activeTab, difficultyOptions, rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let pool = rows;
    if (activeTab !== 'All') pool = pool.filter((r) => r.type === activeTab);
    if (activeLevels.size > 0) pool = pool.filter((r) => activeLevels.has(String(r.level)));
    if (activeDifficulties.size > 0) pool = pool.filter((r) => activeDifficulties.has(r.difficulty));
    if (needle) pool = pool.filter((r) => r.name.toLowerCase().includes(needle));
    return pool.slice().sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      const ra = missionTypeRank(a.type);
      const rb = missionTypeRank(b.type);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  }, [rows, q, activeTab, activeDifficulties, activeLevels]);

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

  function selectTab(t: MissionTab) {
    updateParam('type', t === 'All' ? null : t.toLowerCase());
  }

  function toggleLevel(level: number) {
    const next = new Set(activeLevels);
    const value = String(level);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    updateParam('levels', serializeCsvParam(next));
  }

  function toggleDifficulty(difficulty: string) {
    const next = new Set(activeDifficulties);
    if (next.has(difficulty)) next.delete(difficulty);
    else next.add(difficulty);
    updateParam('difficulty', serializeCsvParam(next));
  }

  return (
    <>
      <p className="muted">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()}</p>

      <nav className="type-tabs" aria-label="Filter by mission type">
        {(['All', ...MISSION_TYPE_TABS] as MissionTab[]).map((t) => (
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

      <nav className="type-tabs" aria-label="Filter by mission difficulty">
        <button
          type="button"
          className={'type-tab' + (activeDifficulties.size === 0 ? ' active' : '')}
          onClick={() => updateParam('difficulty', null)}
        >
          All <span className="type-tab-count">({difficultyCounts.all.toLocaleString()})</span>
        </button>
        {difficultyOptions.map((difficulty) => (
          <button
            key={difficulty}
            type="button"
            className={'type-tab' + (activeDifficulties.has(difficulty) ? ' active' : '')}
            onClick={() => toggleDifficulty(difficulty)}
            disabled={(difficultyCounts.byDifficulty.get(difficulty) ?? 0) === 0}
          >
            {difficulty} <span className="type-tab-count">({(difficultyCounts.byDifficulty.get(difficulty) ?? 0).toLocaleString()})</span>
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
          aria-label="Filter missions"
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
      </div>
      {loading && showSkeleton && <EntityIndexSkeleton />}
      {!loading && filtered.length === 0 && <p className="muted">No matches.</p>}
      {!loading && filtered.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="location-table source-table entity-index-table">
              <thead>
                <tr>
                  <th>Mission</th>
                  <th>Level</th>
                  <th>Difficulty</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="entity-index-name">
                        {r.displayNPC?.icon
                          ? <Icon src={r.displayNPC.icon} alt={r.displayNPC.name} size={64} />
                          : <span className="icon icon-empty" aria-hidden />}
                        <Link className="entity-index-link" to={`/${build}/missions/${r.routeId ?? r.id}`}>{r.name}</Link>
                      </div>
                    </td>
                    <td>{r.level > 0 ? r.level : <span className="muted">—</span>}</td>
                    <td>{r.difficulty || <span className="muted">—</span>}</td>
                    <td>{r.type || <span className="muted">—</span>}</td>
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
