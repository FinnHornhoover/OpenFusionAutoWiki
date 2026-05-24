import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import Icon from '../../components/Icon';
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
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const showSkeleton = useDelayedFlag(loading);

  const counts = useMemo(() => {
    const acc: Record<MissionTab, number> = { All: 0, Normal: 0, Guide: 0, Nano: 0 };
    for (const r of rows) {
      acc.All++;
      if ((MISSION_TYPE_TABS as readonly string[]).includes(r.type)) {
        acc[r.type as MissionTab]++;
      }
    }
    return acc;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const byType = activeTab === 'All' ? rows : rows.filter((r) => r.type === activeTab);
    const matched = needle ? byType.filter((r) => r.name.toLowerCase().includes(needle)) : byType;
    return matched.slice().sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      const ra = missionTypeRank(a.type);
      const rb = missionTypeRank(b.type);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  }, [rows, q, activeTab]);

  const start = page * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  function selectTab(t: MissionTab) {
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

      <input
        type="search"
        placeholder="Filter by name…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setPage(0); }}
        style={{ width: '100%', maxWidth: 360, marginBottom: 'var(--space-4)' }}
        aria-label="Filter missions"
      />
      {loading && showSkeleton && <EntityIndexSkeleton />}
      {!loading && filtered.length === 0 && <p className="muted">No matches.</p>}
      {!loading && filtered.length > 0 && (
        <>
          <ul className="entity-index">
            {pageRows.map((r) => (
              <li key={r.id} className="entity-index-row">
                {r.startNPC?.icon
                  ? <Icon src={r.startNPC.icon} alt={r.startNPC.name} size={28} />
                  : <span className="icon icon-empty" aria-hidden style={{ width: 28, height: 28 }} />}
                <span className="entity-index-main">
                  <Link to={`/${build}/missions/${r.id}`}>{r.name}</Link>
                  <span className="muted">
                    {' · '}Lv {r.level}
                    {r.difficulty && r.difficulty !== 'Normal' && ` · ${r.difficulty}`}
                    {r.type && r.type !== 'Normal' && ` · ${r.type}`}
                    {r.startNPC?.name && ` · from ${r.startNPC.name}`}
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
