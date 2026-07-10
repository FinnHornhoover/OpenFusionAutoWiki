import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import type { ItemIndexEntry, ItemSet } from '../data/types';
import { useIndex } from '../data/useIndex';
import Dropdown from './Dropdown';
import EntityLink from './EntityLink';

const itemSetCache = new Map<string, Promise<Record<string, ItemSet>>>();

const ARMOR_TYPES = new Set(['Body', 'Legs', 'Shoes']);
const ACCESSORY_TYPES = new Set(['Hat', 'Glasses', 'Backpack']);
const GENERAL_TYPES = new Set(['General', 'CRATE']);
type ItemSuperclass = 'Weapon' | 'Armor' | 'Accessory' | 'General' | 'Vehicle' | 'All';

interface SimilarItemsProps {
  current: { id: string; type: string; displayType: string; rarity: string; contentLevel: number };
}

interface SimilarItemGroup {
  key: string;
  title: string;
  sortTitle: string;
  isSet: boolean;
  items: ItemIndexEntry[];
}

function itemSuperclass(item: { type: string }): ItemSuperclass {
  if (item.type === 'Weapon') return 'Weapon';
  if (ARMOR_TYPES.has(item.type)) return 'Armor';
  if (ACCESSORY_TYPES.has(item.type)) return 'Accessory';
  if (GENERAL_TYPES.has(item.type)) return 'General';
  if (item.type === 'Vehicle') return 'Vehicle';
  return 'All';
}

function ruleReason(item: { contentLevel: number; rarity: string; displayType: string }): string {
  return [
    item.contentLevel > 0 ? `Lv${item.contentLevel}` : '',
    item.rarity,
    item.displayType,
  ].filter(Boolean).join(' ');
}

async function loadItemSets(build: string): Promise<Record<string, ItemSet>> {
  let promise = itemSetCache.get(build);
  if (!promise) {
    promise = fetch(`/data/${build}/item_sets.json`).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<Record<string, ItemSet>>;
    });
    itemSetCache.set(build, promise);
  }
  return promise;
}

export default function SimilarItems({ current }: SimilarItemsProps) {
  const { build } = useParams();
  const { rows, loading } = useIndex<ItemIndexEntry>(build, 'items');
  const [sets, setSets] = useState<Record<string, ItemSet> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    if (!build) {
      setSets({});
      return;
    }
    let alive = true;
    loadItemSets(build).then(
      (loaded) => { if (alive) setSets(loaded); },
      () => { if (alive) setSets({}); },
    );
    return () => { alive = false; };
  }, [build]);

  const { groups, uniqueCount } = useMemo(() => {
    const rowsById = new Map((rows ?? []).map((row) => [row.id, row] as const));
    const currentSuperclass = itemSuperclass(current);
    const byGroup = new Map<string, SimilarItemGroup>();
    const uniqueIds = new Set<string>();

    const addToGroup = (key: string, title: string, isSet: boolean, item: ItemIndexEntry) => {
      let group = byGroup.get(key);
      if (!group) {
        group = { key, title, sortTitle: title.toLowerCase(), isSet, items: [] };
        byGroup.set(key, group);
      }
      if (!group.items.some((existing) => existing.id === item.id)) group.items.push(item);
      uniqueIds.add(item.id);
    };

    const directReason = ruleReason(current);
    for (const row of rows ?? []) {
      if (
        row.id !== current.id &&
        row.displayType === current.displayType &&
        row.rarity === current.rarity &&
        row.contentLevel === current.contentLevel
      ) {
        addToGroup('rule:' + directReason, directReason, false, row);
      }
    }

    for (const set of Object.values(sets ?? {})) {
      if (!set.items.some((item) => String(item.id) === current.id)) continue;
      for (const item of set.items) {
        const id = String(item.id);
        if (id === current.id) continue;
        const row = rowsById.get(id);
        if (row && itemSuperclass(row) === currentSuperclass) addToGroup('set:' + set.id + ':' + currentSuperclass, `${set.name} - ${currentSuperclass}`, true, row);
      }
    }

    const groups = [...byGroup.values()]
      .map((group) => ({
        ...group,
        items: group.items.slice().sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => Number(a.isSet) - Number(b.isSet) || a.sortTitle.localeCompare(b.sortTitle));

    return { groups, uniqueCount: uniqueIds.size };
  }, [rows, sets, current]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setHasOverflow(el.scrollWidth > el.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [groups]);

  if (loading || !sets || groups.length === 0) return null;

  return (
    <Dropdown summary={`Similar items (${uniqueCount})`} className="similar-items-dropdown">
      <div ref={scrollRef} className={['table-scroll', 'similar-items-scroll', hasOverflow ? 'table-scroll-has-overflow' : ''].filter(Boolean).join(' ')}>
        <table className="location-table source-table similar-items-table">
          <tbody>
            {groups.map((group) => (
              <tr key={group.key}>
                <td>
                  <strong className="similar-items-source-title">{group.title}</strong>
                  <div className="similar-items-grid">
                    {group.items.map((item) => (
                      <EntityLink key={item.id} entity={{ type: 'item', id: item.id, name: item.name, icon: item.icon }} iconSize={64} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dropdown>
  );
}
