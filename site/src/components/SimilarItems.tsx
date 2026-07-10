import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { ItemIndexEntry, ItemSet } from '../data/types';
import { canonicalRoute, useRouteMap } from '../data/routeMap';
import { useIndex } from '../data/useIndex';
import Dropdown from './Dropdown';
import EntityLink from './EntityLink';
import Icon from './Icon';

const itemSetCache = new Map<string, Promise<Record<string, ItemSet>>>();

const ARMOR_TYPES = new Set(['Body', 'Legs', 'Shoes']);
const ACCESSORY_TYPES = new Set(['Hat', 'Glasses', 'Backpack']);
const GENERAL_TYPES = new Set(['General', 'CRATE']);
type ItemSuperclass = 'Weapon' | 'Armor' | 'Accessory' | 'General' | 'Vehicle' | 'All';

interface SimilarItemsProps {
  current: { id: string; name: string; icon: string; type: string; displayType: string; rarity: string; contentLevel: number };
}

interface SimilarItemGroup {
  key: string;
  title: string;
  sortTitle: string;
  isSet: boolean;
  setId?: number;
  setRank: number;
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
  ].filter(Boolean).join(' - ');
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
  const itemSetRoutes = useRouteMap(build, 'item-sets');
  const [sets, setSets] = useState<Record<string, ItemSet> | null>(null);

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
    const currentRow = rowsById.get(current.id);
    const currentSuperclass = itemSuperclass(current);
    const sortedSets = Object.values(sets ?? {}).sort((a, b) => a.items.length - b.items.length || a.id - b.id);
    const setRankById = new Map(sortedSets.map((set, index) => [set.id, index] as const));
    const itemOrder = new Map<string, number>();
    for (const set of sortedSets) {
      for (const item of set.items) {
        const id = String(item.id);
        if (!itemOrder.has(id)) itemOrder.set(id, itemOrder.size);
      }
    }
    const byGroup = new Map<string, SimilarItemGroup>();
    const uniqueIds = new Set<string>();

    const addToGroup = (key: string, title: string, isSet: boolean, item: ItemIndexEntry, setRank = Number.MAX_SAFE_INTEGER, setId?: number) => {
      let group = byGroup.get(key);
      if (!group) {
        group = { key, title, sortTitle: title.toLowerCase(), isSet, setId, setRank, items: [] };
        byGroup.set(key, group);
      }
      if (!group.items.some((existing) => existing.id === item.id)) group.items.push(item);
      uniqueIds.add(item.id);
    };

    const directReason = ruleReason(current);
    if (currentRow) addToGroup('rule:' + directReason, directReason, false, currentRow);
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

    for (const set of sortedSets) {
      if (!set.items.some((item) => String(item.id) === current.id)) continue;
      const setRank = setRankById.get(set.id) ?? Number.MAX_SAFE_INTEGER;
      for (const item of set.items) {
        const id = String(item.id);
        const row = rowsById.get(id);
        if (row && itemSuperclass(row) === currentSuperclass) addToGroup('set:' + set.id + ':' + currentSuperclass, `${set.name} - ${currentSuperclass}`, true, row, setRank, set.id);
      }
    }

    const groups = [...byGroup.values()]
      .map((group) => ({
        ...group,
        items: group.items.slice().sort((a, b) => {
          if (a.obtainable !== b.obtainable) return a.obtainable ? -1 : 1;
          if (!group.isSet) return a.name.localeCompare(b.name);
          return (itemOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (itemOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name);
        }),
      }))
      .sort((a, b) => Number(a.isSet) - Number(b.isSet) || a.setRank - b.setRank || a.sortTitle.localeCompare(b.sortTitle));

    return { groups, uniqueCount: uniqueIds.size };
  }, [rows, sets, current]);


  if (loading || !sets || groups.length === 0) return null;

  return (
    <Dropdown summary={`Similar items (${uniqueCount})`} className="similar-items-dropdown" open={groups.length <= 3}>
      <div className="similar-items-wrap">
        <table className="location-table source-table similar-items-table">
          <tbody>
            {groups.map((group) => (
              <tr key={group.key}>
                <td>
                  {group.isSet && group.setId && build ? (
                    <Link className="similar-items-source-title similar-items-source-link" to={`/${build}/item-sets/${canonicalRoute(itemSetRoutes, group.setId)}`}>{group.title}</Link>
                  ) : (
                    <strong className="similar-items-source-title">{group.title}</strong>
                  )}
                  <div className="similar-items-grid">
                    {group.items.map((item) => (
                      item.id === current.id ? (
                        <span key={item.id} className={['similar-items-current', 'entity-link', item.obtainable ? '' : 'similar-items-muted'].filter(Boolean).join(' ')} aria-current="page">
                          <span className="entity-link-body">
                            {item.icon ? <Icon src={item.icon} alt={item.name} size={64} /> : null}
                            <span className="entity-link-name">{item.name}</span>
                          </span>
                        </span>
                      ) : (
                        <span key={item.id} className={item.obtainable ? undefined : 'similar-items-muted'}>
                          <EntityLink entity={{ type: 'item', id: item.id, name: item.name, icon: item.icon }} iconSize={64} />
                        </span>
                      )
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
