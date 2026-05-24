import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import Icon from '../../components/Icon';
import type { NpcIndexEntry } from '../../data/types';
import { useDelayedFlag } from '../../data/useDelayedFlag';

const PAGE_SIZE = 50;

/**
 * NPC categories surfaced as tabs. "All" is implicit. Categories not in this
 * list still show under "All" but don't get a tab of their own. Order matches
 * how a reader actually browses: people you talk to first, then services, then
 * environment markers.
 */
const NPC_TAB_CATEGORIES = ['Quest', 'Vendor', 'Normal', 'Combi', 'Bank', 'Warp', 'Location'] as const;
type NpcTab = (typeof NPC_TAB_CATEGORIES)[number] | 'All';

const NPC_CAT_RANK = new Map<string, number>(
  NPC_TAB_CATEGORIES.map((c, i) => [c, i] as const),
);
function npcCategoryRank(c: string): number {
  return NPC_CAT_RANK.get(c) ?? NPC_TAB_CATEGORIES.length;
}

function tabFromParam(p: string | null): NpcTab {
  if (!p) return 'All';
  const lc = p.toLowerCase();
  for (const t of NPC_TAB_CATEGORIES) {
    if (t.toLowerCase() === lc) return t;
  }
  return 'All';
}

interface Props {
  build: string;
  rows: NpcIndexEntry[];
  loading: boolean;
}

export default function NpcIndex({ build, rows, loading }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = tabFromParam(searchParams.get('category'));
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [hideOutOfGame, setHideOutOfGame] = useState(true);
  const showSkeleton = useDelayedFlag(loading);

  const counts = useMemo(() => {
    const acc: Record<NpcTab, number> = { All: 0, Quest: 0, Vendor: 0, Normal: 0, Combi: 0, Bank: 0, Warp: 0, Location: 0 };
    for (const r of rows) {
      if (hideOutOfGame && !r.inGame) continue;
      acc.All++;
      if ((NPC_TAB_CATEGORIES as readonly string[]).includes(r.category)) {
        acc[r.category as NpcTab]++;
      }
    }
    return acc;
  }, [rows, hideOutOfGame]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let pool = rows;
    if (hideOutOfGame) pool = pool.filter((r) => r.inGame);
    if (activeTab !== 'All') pool = pool.filter((r) => r.category === activeTab);
    if (needle) pool = pool.filter((r) => r.name.toLowerCase().includes(needle));
    return pool.slice().sort((a, b) => {
      const ra = npcCategoryRank(a.category);
      const rb = npcCategoryRank(b.category);
      if (ra !== rb) return ra - rb;
      // For categories outside the tab list, group alphabetically by category first.
      if (ra === NPC_TAB_CATEGORIES.length && a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.name.localeCompare(b.name) || a.id - b.id;
    });
  }, [rows, q, activeTab, hideOutOfGame]);

  const start = page * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  function selectTab(t: NpcTab) {
    setPage(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (t === 'All') next.delete('category');
      else next.set('category', t.toLowerCase());
      return next;
    });
  }

  return (
    <>
      <p className="muted">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()}</p>

      <nav className="type-tabs" aria-label="Filter by NPC category">
        {(['All', ...NPC_TAB_CATEGORIES] as NpcTab[]).map((t) => (
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
          aria-label="Filter NPCs"
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={hideOutOfGame}
            onChange={(e) => { setHideOutOfGame(e.target.checked); setPage(0); }}
          />
          <span>Hide out-of-game NPCs</span>
        </label>
      </div>

      {loading && showSkeleton && <EntityIndexSkeleton />}
      {!loading && filtered.length === 0 && <p className="muted">No matches.</p>}
      {!loading && filtered.length > 0 && (
        <>
          <ul className="entity-index">
            {pageRows.map((r) => (
              <li key={r.id} className="entity-index-row">
                {r.icon
                  ? <Icon src={r.icon} alt={r.name} size={28} />
                  : <span className="icon icon-empty" aria-hidden style={{ width: 28, height: 28 }} />}
                <span className="entity-index-main">
                  <Link to={`/${build}/npcs/${r.id}`}>{r.name}</Link>
                  <span className="muted">
                    {r.category && ` · ${r.category}`}
                    {r.instanceCount > 0 && ` · ${r.instanceCount} spawn${r.instanceCount === 1 ? '' : 's'}`}
                    {!r.inGame && ' · cut'}
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
