import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import Icon from '../../components/Icon';
import type { ItemIndexEntry } from '../../data/types';
import { useDelayedFlag } from '../../data/useDelayedFlag';

const PAGE_SIZE = 50;

/** Item type tabs in player-friendly order. */
const ITEM_TYPE_TABS = [
  'Weapon', 'Body', 'Legs', 'Shoes', 'Hat', 'Glasses',
  'Backpack', 'General', 'CRATE', 'Vehicle',
] as const;
type ItemTab = (typeof ITEM_TYPE_TABS)[number] | 'All';

/**
 * Game's rarity progression (lowest → highest). "Any" is the enum sentinel
 * (RarityID=0) and isn't a real item rarity — omitted from the tab list.
 */
const RARITY_TABS = ['Common', 'Uncommon', 'Rare', 'Ultra Rare', 'Amazing!'] as const;
type RarityTab = (typeof RARITY_TABS)[number] | 'All';
const RARITY_RANK = new Map<string, number>(RARITY_TABS.map((r, i) => [r, i] as const));
function rarityRank(r: string): number {
  return RARITY_RANK.get(r) ?? RARITY_TABS.length;
}

const GENDER_TABS = ['Any', 'Male', 'Female'] as const;
type GenderTab = (typeof GENDER_TABS)[number] | 'All';

function pickTab<T extends string>(p: string | null, choices: readonly T[]): T | 'All' {
  if (!p) return 'All';
  const lc = p.toLowerCase();
  for (const c of choices) {
    if (c.toLowerCase() === lc) return c;
  }
  return 'All';
}

interface Props {
  build: string;
  rows: ItemIndexEntry[];
  loading: boolean;
}

export default function ItemIndex({ build, rows, loading }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeType = pickTab<typeof ITEM_TYPE_TABS[number]>(searchParams.get('type'), ITEM_TYPE_TABS);
  const activeRarity = pickTab<typeof RARITY_TABS[number]>(searchParams.get('rarity'), RARITY_TABS);
  const activeGender = pickTab<typeof GENDER_TABS[number]>(searchParams.get('gender'), GENDER_TABS);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [hideUnobtainable, setHideUnobtainable] = useState(false);
  const showSkeleton = useDelayedFlag(loading);

  // Each axis matcher; "All" passes through.
  const matchType = (r: ItemIndexEntry) => activeType === 'All' || r.type === activeType;
  const matchRarity = (r: ItemIndexEntry) => activeRarity === 'All' || r.rarity === activeRarity;
  const matchGender = (r: ItemIndexEntry) => activeGender === 'All' || r.gender === activeGender;
  const matchName = (() => {
    const needle = q.trim().toLowerCase();
    return needle ? (r: ItemIndexEntry) => r.name.toLowerCase().includes(needle) : () => true;
  })();
  const matchObtainable = (r: ItemIndexEntry) => !hideUnobtainable || r.obtainable;

  // Counts per option of an axis are computed against everything ELSE applied.
  const typeCounts = useMemo(() => {
    const acc: Record<ItemTab, number> = {
      All: 0, Weapon: 0, Body: 0, Legs: 0, Shoes: 0, Hat: 0, Glasses: 0,
      Backpack: 0, General: 0, CRATE: 0, Vehicle: 0,
    };
    for (const r of rows) {
      if (!matchRarity(r) || !matchGender(r) || !matchName(r) || !matchObtainable(r)) continue;
      acc.All++;
      if ((ITEM_TYPE_TABS as readonly string[]).includes(r.type)) acc[r.type as ItemTab]++;
    }
    return acc;
  }, [rows, activeRarity, activeGender, q, hideUnobtainable]);

  const rarityCounts = useMemo(() => {
    const acc: Record<RarityTab, number> = {
      All: 0, Common: 0, Uncommon: 0, Rare: 0, 'Ultra Rare': 0, 'Amazing!': 0,
    };
    for (const r of rows) {
      if (!matchType(r) || !matchGender(r) || !matchName(r) || !matchObtainable(r)) continue;
      acc.All++;
      if ((RARITY_TABS as readonly string[]).includes(r.rarity)) acc[r.rarity as RarityTab]++;
    }
    return acc;
  }, [rows, activeType, activeGender, q, hideUnobtainable]);

  const genderCounts = useMemo(() => {
    const acc: Record<GenderTab, number> = { All: 0, Any: 0, Male: 0, Female: 0 };
    for (const r of rows) {
      if (!matchType(r) || !matchRarity(r) || !matchName(r) || !matchObtainable(r)) continue;
      acc.All++;
      if ((GENDER_TABS as readonly string[]).includes(r.gender)) acc[r.gender as GenderTab]++;
    }
    return acc;
  }, [rows, activeType, activeRarity, q, hideUnobtainable]);

  const filtered = useMemo(() => {
    const pool = rows.filter((r) =>
      matchType(r) && matchRarity(r) && matchGender(r) && matchName(r) && matchObtainable(r),
    );
    return pool.sort((a, b) => {
      if (a.typeId !== b.typeId) return a.typeId - b.typeId;
      if (a.contentLevel !== b.contentLevel) return a.contentLevel - b.contentLevel;
      const ra = rarityRank(a.rarity);
      const rb = rarityRank(b.rarity);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  }, [rows, activeType, activeRarity, activeGender, q, hideUnobtainable]);

  const start = page * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  function setParam(name: string, value: string | null) {
    setPage(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === null) next.delete(name);
      else next.set(name, value);
      return next;
    });
  }

  return (
    <>
      <p className="muted">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()}</p>

      <nav className="type-tabs" aria-label="Filter by item type">
        {(['All', ...ITEM_TYPE_TABS] as ItemTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={'type-tab' + (activeType === t ? ' active' : '')}
            onClick={() => setParam('type', t === 'All' ? null : t.toLowerCase())}
            disabled={t !== 'All' && typeCounts[t] === 0}
          >
            {t} <span className="type-tab-count">({typeCounts[t].toLocaleString()})</span>
          </button>
        ))}
      </nav>

      <nav className="type-tabs" aria-label="Filter by rarity">
        {(['All', ...RARITY_TABS] as RarityTab[]).map((r) => (
          <button
            key={r}
            type="button"
            className={'type-tab' + (activeRarity === r ? ' active' : '')}
            onClick={() => setParam('rarity', r === 'All' ? null : r.toLowerCase())}
            disabled={r !== 'All' && rarityCounts[r] === 0}
          >
            {r} <span className="type-tab-count">({rarityCounts[r].toLocaleString()})</span>
          </button>
        ))}
      </nav>

      <nav className="type-tabs" aria-label="Filter by gender">
        {(['All', ...GENDER_TABS] as GenderTab[]).map((g) => (
          <button
            key={g}
            type="button"
            className={'type-tab' + (activeGender === g ? ' active' : '')}
            onClick={() => setParam('gender', g === 'All' ? null : g.toLowerCase())}
            disabled={g !== 'All' && genderCounts[g] === 0}
          >
            {g} <span className="type-tab-count">({genderCounts[g].toLocaleString()})</span>
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
          aria-label="Filter items"
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={hideUnobtainable}
            onChange={(e) => { setHideUnobtainable(e.target.checked); setPage(0); }}
          />
          <span>Hide unobtainable</span>
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
                  <Link to={`/${build}/items/${r.id}`}>{r.name}</Link>
                  <span className="muted">
                    {' · '}{r.type}
                    {r.rarity && r.rarity !== 'Common' && r.rarity !== 'Any' && ` · ${r.rarity}`}
                    {r.gender && r.gender !== 'Any' && ` · ${r.gender}`}
                    {r.contentLevel > 0 && ` · Lv ${r.contentLevel}`}
                    {!r.obtainable && ' · unobtainable'}
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
