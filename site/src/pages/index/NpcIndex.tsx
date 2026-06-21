import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import Icon from '../../components/Icon';
import type { NpcIndexEntry } from '../../data/types';
import { useDelayedFlag } from '../../data/useDelayedFlag';

const PAGE_SIZE = 50;

/** NPC categories surfaced as tabs. Order follows FFInfoPacks' NPC_TYPES ids, with Unknown for fallback rows. */
const NPC_TAB_CATEGORIES = [
  'Normal',
  'Vendor',
  'Quest',
  'VendorQuest',
  'Warp',
  'Defense',
  'NanoCreateMachine',
  'NanoTuneMachine',
  'NanoManager',
  'Xcom',
  'IXcom',
  'Bank',
  'StartEcom',
  'EndEcom',
  'SCAMPER',
  'MonkeySkyway',
  'RXcom',
  'Guide1',
  'Guide2',
  'Guide3',
  'Guide4',
  'Guide5',
  'GuideStarter',
  'Offer',
  'NoReaction',
  'Combi',
  'Enchant',
  'Invisible',
  'InvisibleWarp',
  'InvisibleNoClick',
  'NonCheck',
  'Location',
  'Unknown',
] as const;
type NpcTab = (typeof NPC_TAB_CATEGORIES)[number] | 'All';

const NPC_CAT_RANK = new Map<string, number>(
  NPC_TAB_CATEGORIES.map((c, i) => [c, i] as const),
);
function npcCategoryRank(c: string): number {
  return NPC_CAT_RANK.get(c) ?? NPC_TAB_CATEGORIES.length;
}


interface NpcIndexMemberView {
  id: number;
  category: string;
  inGame: boolean;
}

function npcMembers(r: NpcIndexEntry): NpcIndexMemberView[] {
  if (r.members?.length) return r.members;
  return typeof r.id === 'number' ? [{ id: r.id, category: r.category, inGame: r.inGame }] : [];
}

function visibleNpcMembers(r: NpcIndexEntry, hideOutOfGame: boolean): NpcIndexMemberView[] {
  const members = npcMembers(r);
  return hideOutOfGame ? members.filter((m) => m.inGame) : members;
}

function statusFromMembers(members: NpcIndexMemberView[]): 'in-game' | 'out-of-game' | 'mixed' {
  const inGame = members.some((m) => m.inGame);
  const outOfGame = members.some((m) => !m.inGame);
  if (inGame && outOfGame) return 'mixed';
  return inGame ? 'in-game' : 'out-of-game';
}

function npcStatus(r: NpcIndexEntry, hideOutOfGame: boolean): 'in-game' | 'out-of-game' | 'mixed' {
  const members = visibleNpcMembers(r, hideOutOfGame);
  if (members.length > 0) return statusFromMembers(members);
  return r.status ?? (r.inGame ? 'in-game' : 'out-of-game');
}

function npcCategories(r: NpcIndexEntry, hideOutOfGame: boolean): string[] {
  const allMembers = npcMembers(r);
  if (allMembers.length > 0) {
    const members = visibleNpcMembers(r, hideOutOfGame);
    return Array.from(new Set(members.map((m) => m.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }
  return r.categories?.length ? r.categories : (r.category ? [r.category] : []);
}

function npcCategory(r: NpcIndexEntry, hideOutOfGame: boolean): string {
  const categories = npcCategories(r, hideOutOfGame);
  if (categories.length === 0) return '';
  return categories.length === 1 ? categories[0] : 'Mixed';
}

function npcVisibleIdCount(r: NpcIndexEntry, hideOutOfGame: boolean): number {
  const allMembers = npcMembers(r);
  if (allMembers.length > 0) return visibleNpcMembers(r, hideOutOfGame).length;
  return r.idCount;
}

function npcRouteId(r: NpcIndexEntry, hideOutOfGame: boolean): string | number {
  const members = visibleNpcMembers(r, hideOutOfGame);
  return members.length === 1 ? members[0].id : r.id;
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
    const acc = Object.fromEntries((['All', ...NPC_TAB_CATEGORIES] as NpcTab[]).map((t) => [t, 0])) as Record<NpcTab, number>;
    for (const r of rows) {
      if (npcVisibleIdCount(r, hideOutOfGame) === 0) continue;
      acc.All++;
      const categories = npcCategories(r, hideOutOfGame);
      for (const category of categories) {
        if ((NPC_TAB_CATEGORIES as readonly string[]).includes(category)) {
          acc[category as NpcTab]++;
        }
      }
    }
    return acc;
  }, [rows, hideOutOfGame]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let pool = rows;
    pool = pool.filter((r) => npcVisibleIdCount(r, hideOutOfGame) > 0);
    if (activeTab !== 'All') pool = pool.filter((r) => npcCategories(r, hideOutOfGame).includes(activeTab));
    if (needle) pool = pool.filter((r) => r.name.toLowerCase().includes(needle));
    return pool.slice().sort((a, b) => {
      const aCategory = npcCategory(a, hideOutOfGame);
      const bCategory = npcCategory(b, hideOutOfGame);
      const ra = npcCategoryRank(aCategory);
      const rb = npcCategoryRank(bCategory);
      if (ra !== rb) return ra - rb;
      // For categories outside the tab list, group alphabetically by category first.
      if (ra === NPC_TAB_CATEGORIES.length && aCategory !== bCategory) {
        return aCategory.localeCompare(bCategory);
      }
      return a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id));
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
          <table className="location-table source-table entity-index-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>NPC</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className={npcStatus(r, hideOutOfGame) === 'in-game' ? undefined : 'entity-index-row-muted'}>
                  <td>{npcVisibleIdCount(r, hideOutOfGame) === 1 ? <code className="entity-index-id-code">{npcRouteId(r, hideOutOfGame)}</code> : <em>{npcVisibleIdCount(r, hideOutOfGame).toLocaleString()} IDs</em>}</td>
                  <td>
                    <div className="entity-index-name">
                      {r.icon
                        ? <Icon src={r.icon} alt={r.name} size={64} />
                        : <span className="icon icon-empty" aria-hidden />}
                      <Link className="entity-index-link" to={`/${build}/npcs/${npcRouteId(r, hideOutOfGame)}`}>{r.name}</Link>
                    </div>
                  </td>
                  <td>{npcCategory(r, hideOutOfGame) || <span className="muted">—</span>}</td>
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
