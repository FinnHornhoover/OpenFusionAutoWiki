import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import Icon from '../../components/Icon';
import IndexFilterDropdown from '../../components/IndexFilterDropdown';
import type { ItemIndexEntry } from '../../data/types';
import { useDelayedFlag } from '../../data/useDelayedFlag';

const PAGE_SIZE = 50;

const ITEM_SUPERCLASS_TABS = ['Weapon', 'Armor', 'Accessory', 'General', 'Vehicle'] as const;
type ItemSuperclass = (typeof ITEM_SUPERCLASS_TABS)[number] | 'All';

const ARMOR_TYPES = new Set(['Body', 'Legs', 'Shoes']);
const ACCESSORY_TYPES = new Set(['Hat', 'Glasses', 'Backpack']);
const GENERAL_TYPES = new Set(['General', 'CRATE']);
const TYPE_RANK = new Map<string, number>([
  'Thrown', 'Pistol', 'Rifle', 'Shattergun', 'Rocket', 'Body', 'Legs', 'Shoes',
  'Hat', 'Glasses', 'Backpack', 'General', 'CRATE', 'Vehicle',
].map((t, i) => [t, i] as const));
const SUPERCLASS_RANK = new Map<ItemSuperclass, number>(
  (['All', ...ITEM_SUPERCLASS_TABS] as ItemSuperclass[]).map((t, i) => [t, i] as const),
);

/**
 * Game's rarity progression (lowest -> highest). "Any" is the enum sentinel
 * (RarityID=0) and isn't a real item rarity -- omitted from the tab list.
 */
const RARITY_TABS = ['Common', 'Uncommon', 'Rare', 'Ultra Rare', 'Amazing!'] as const;
type RarityTab = (typeof RARITY_TABS)[number] | 'All';
const RARITY_RANK = new Map<string, number>(RARITY_TABS.map((r, i) => [r, i] as const));
function rarityRank(r: string): number {
  return RARITY_RANK.get(r) ?? RARITY_TABS.length;
}

function pickTab<T extends string>(p: string | null, choices: readonly T[]): T | 'All' {
  if (!p) return 'All';
  const lc = p.toLowerCase();
  for (const c of choices) {
    if (c.toLowerCase() === lc) return c;
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

function itemSuperclass(r: ItemIndexEntry): ItemSuperclass {
  if (r.type === 'Weapon') return 'Weapon';
  if (ARMOR_TYPES.has(r.type)) return 'Armor';
  if (ACCESSORY_TYPES.has(r.type)) return 'Accessory';
  if (GENERAL_TYPES.has(r.type)) return 'General';
  if (r.type === 'Vehicle') return 'Vehicle';
  return 'All';
}

function itemTypeFilterLabel(r: ItemIndexEntry): string {
  if (r.type !== 'Weapon') return r.type;
  const weaponType = (r.weaponType ?? '').trim();
  if (weaponType && weaponType !== 'None' && weaponType !== 'Weapon') return weaponType;
  const displayType = (r.displayType ?? '').trim();
  if (displayType && displayType !== 'Weapon') return displayType;
  return '';
}

function typeRank(t: string): number {
  return TYPE_RANK.get(t) ?? TYPE_RANK.size;
}

interface Props {
  build: string;
  rows: ItemIndexEntry[];
  loading: boolean;
}

export default function ItemIndex({ build, rows, loading }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeClass = pickTab<typeof ITEM_SUPERCLASS_TABS[number]>(searchParams.get('class'), ITEM_SUPERCLASS_TABS);
  const activeType = searchParams.get('type') ?? '';
  const activeRarity = pickTab<typeof RARITY_TABS[number]>(searchParams.get('rarity'), RARITY_TABS);
  const activeLevels = useMemo(() => parseCsvParam(searchParams.get('levels')), [searchParams]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [hideUnobtainable, setHideUnobtainable] = useState(true);
  const showSkeleton = useDelayedFlag(loading);
  const nameNeedle = q.trim().toLowerCase();
  const hasNameFilter = nameNeedle.length > 0;
  const effectiveHideUnobtainable = hideUnobtainable && !hasNameFilter;

  const levelOptions = useMemo(() => {
    return [...new Set(rows.map((r) => r.contentLevel).filter((level) => level > 0))].sort((a, b) => a - b);
  }, [rows]);

  const matchClass = (r: ItemIndexEntry) => activeClass === 'All' || itemSuperclass(r) === activeClass;
  const matchType = (r: ItemIndexEntry) => !activeType || itemTypeFilterLabel(r).toLowerCase() === activeType.toLowerCase();
  const matchRarity = (r: ItemIndexEntry) => activeRarity === 'All' || r.rarity === activeRarity;
  const matchLevel = (r: ItemIndexEntry) => activeLevels.size === 0 || activeLevels.has(String(r.contentLevel));
  const matchName = hasNameFilter
    ? (r: ItemIndexEntry) => r.name.toLowerCase().includes(nameNeedle)
    : () => true;
  const matchObtainable = (r: ItemIndexEntry) => !effectiveHideUnobtainable || r.obtainable;

  const classCounts = useMemo(() => {
    const acc: Record<ItemSuperclass, number> = { All: 0, Weapon: 0, Armor: 0, Accessory: 0, General: 0, Vehicle: 0 };
    for (const r of rows) {
      if (!matchType(r) || !matchRarity(r) || !matchLevel(r) || !matchName(r) || !matchObtainable(r)) continue;
      acc.All++;
      const superclass = itemSuperclass(r);
      if (superclass !== 'All') acc[superclass]++;
    }
    return acc;
  }, [rows, activeType, activeRarity, activeLevels, q, effectiveHideUnobtainable]);

  const typeCounts = useMemo(() => {
    const acc = new Map<string, number>();
    for (const r of rows) {
      if (!matchClass(r) || !matchRarity(r) || !matchLevel(r) || !matchName(r) || !matchObtainable(r)) continue;
      const label = itemTypeFilterLabel(r);
      if (!label || label === 'Weapon') continue;
      acc.set(label, (acc.get(label) ?? 0) + 1);
    }
    return acc;
  }, [rows, activeClass, activeRarity, activeLevels, q, effectiveHideUnobtainable]);

  const typeOptions = useMemo(() => {
    return [...typeCounts.keys()].sort((a, b) => {
      const rankDelta = typeRank(a) - typeRank(b);
      return rankDelta || a.localeCompare(b, undefined, { numeric: true });
    });
  }, [typeCounts]);

  const rarityCounts = useMemo(() => {
    const acc: Record<RarityTab, number> = {
      All: 0, Common: 0, Uncommon: 0, Rare: 0, 'Ultra Rare': 0, 'Amazing!': 0,
    };
    for (const r of rows) {
      if (!matchClass(r) || !matchType(r) || !matchLevel(r) || !matchName(r) || !matchObtainable(r)) continue;
      acc.All++;
      if ((RARITY_TABS as readonly string[]).includes(r.rarity)) acc[r.rarity as RarityTab]++;
    }
    return acc;
  }, [rows, activeClass, activeType, activeLevels, q, effectiveHideUnobtainable]);

  const levelCounts = useMemo(() => {
    const acc = new Map<number, number>();
    for (const level of levelOptions) acc.set(level, 0);
    for (const r of rows) {
      if (!matchClass(r) || !matchType(r) || !matchRarity(r) || !matchName(r) || !matchObtainable(r)) continue;
      if (r.contentLevel > 0) acc.set(r.contentLevel, (acc.get(r.contentLevel) ?? 0) + 1);
    }
    return acc;
  }, [rows, activeClass, activeType, activeRarity, q, effectiveHideUnobtainable, levelOptions]);

  const filtered = useMemo(() => {
    const pool = rows.filter((r) =>
      matchClass(r) && matchType(r) && matchRarity(r) && matchLevel(r) && matchName(r) && matchObtainable(r),
    );
    return pool.sort((a, b) => {
      const classDelta = (SUPERCLASS_RANK.get(itemSuperclass(a)) ?? SUPERCLASS_RANK.size) - (SUPERCLASS_RANK.get(itemSuperclass(b)) ?? SUPERCLASS_RANK.size);
      if (classDelta !== 0) return classDelta;
      const typeDelta = typeRank(itemTypeFilterLabel(a)) - typeRank(itemTypeFilterLabel(b));
      if (typeDelta !== 0) return typeDelta;
      if (a.contentLevel !== b.contentLevel) return a.contentLevel - b.contentLevel;
      const ra = rarityRank(a.rarity);
      const rb = rarityRank(b.rarity);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  }, [rows, activeClass, activeType, activeRarity, activeLevels, q, effectiveHideUnobtainable]);

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

  function selectClass(t: ItemSuperclass) {
    setPage(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (t === 'All') next.delete('class');
      else next.set('class', t.toLowerCase());
      next.delete('type');
      return next;
    });
  }

  function toggleLevel(level: number) {
    const next = new Set(activeLevels);
    const value = String(level);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setParam('levels', serializeCsvParam(next));
  }

  return (
    <>
      <p className="muted">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()}</p>

      <nav className="type-tabs" aria-label="Filter by item superclass">
        {(['All', ...ITEM_SUPERCLASS_TABS] as ItemSuperclass[]).map((t) => (
          <button
            key={t}
            type="button"
            className={'type-tab' + (activeClass === t ? ' active' : '')}
            onClick={() => selectClass(t)}
            disabled={t !== 'All' && classCounts[t] === 0}
          >
            {t} <span className="type-tab-count">({classCounts[t].toLocaleString()})</span>
          </button>
        ))}
      </nav>

      <nav className="type-tabs" aria-label="Filter by item type">
        <button
          type="button"
          className={'type-tab' + (!activeType ? ' active' : '')}
          onClick={() => setParam('type', null)}
        >
          All <span className="type-tab-count">({[...typeCounts.values()].reduce((sum, count) => sum + count, 0).toLocaleString()})</span>
        </button>
        {typeOptions.map((t) => (
          <button
            key={t}
            type="button"
            className={'type-tab' + (activeType.toLowerCase() === t.toLowerCase() ? ' active' : '')}
            onClick={() => setParam('type', t)}
            disabled={(typeCounts.get(t) ?? 0) === 0}
          >
            {t} <span className="type-tab-count">({(typeCounts.get(t) ?? 0).toLocaleString()})</span>
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

      <div className="index-controls">
        <input
          type="search"
          placeholder="Filter by name..."
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
          style={{ width: '100%', maxWidth: 360 }}
          aria-label="Filter items"
        />
        <IndexFilterDropdown summary={<>Level {activeLevels.size > 0 && <span className="type-tab-count">({activeLevels.size})</span>}</>}>
            <button type="button" className="link-button" onClick={() => setParam('levels', null)} disabled={activeLevels.size === 0}>Clear levels</button>
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
                  <th>Item</th>
                  <th>Level</th>
                  <th>Rarity</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id} className={r.obtainable ? undefined : 'entity-index-row-muted'}>
                    <td>
                      <div className="entity-index-name">
                        {r.icon
                          ? <Icon src={r.icon} alt={r.name} size={64} />
                          : <span className="icon icon-empty" aria-hidden />}
                        <Link className="entity-index-link" to={`/${build}/items/${r.id}`}>{r.name}</Link>
                      </div>
                    </td>
                    <td>{r.contentLevel > 0 ? r.contentLevel : <span className="muted">-</span>}</td>
                    <td>{r.rarity && r.rarity !== 'Any' ? r.rarity : <span className="muted">-</span>}</td>
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
