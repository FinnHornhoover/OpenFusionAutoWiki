import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import type { ItemIndexEntry, ItemSet } from '../data/types';
import { useIndex } from '../data/useIndex';
import Dropdown from './Dropdown';
import EntityLink from './EntityLink';
import InlineMeta from './InlineMeta';

const itemSetCache = new Map<string, Promise<Record<string, ItemSet>>>();

const ARMOR_TYPES = new Set(['Body', 'Legs', 'Shoes']);
const ACCESSORY_TYPES = new Set(['Hat', 'Glasses', 'Backpack']);
const GENERAL_TYPES = new Set(['General', 'CRATE']);
type ItemSuperclass = 'Weapon' | 'Armor' | 'Accessory' | 'General' | 'Vehicle' | 'All';
type SimilarItem = ItemIndexEntry & { setNames: string[]; ruleMatch: boolean };

function itemSuperclass(item: { type: string }): ItemSuperclass {
  if (item.type === 'Weapon') return 'Weapon';
  if (ARMOR_TYPES.has(item.type)) return 'Armor';
  if (ACCESSORY_TYPES.has(item.type)) return 'Accessory';
  if (GENERAL_TYPES.has(item.type)) return 'General';
  if (item.type === 'Vehicle') return 'Vehicle';
  return 'All';
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

interface SimilarItemsProps {
  current: { id: string; type: string; displayType: string; rarity: string; contentLevel: number };
}

export default function SimilarItems({ current }: SimilarItemsProps) {
  const { build } = useParams();
  const { rows, loading } = useIndex<ItemIndexEntry>(build, 'items');
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

  const siblings = useMemo(() => {
    const byId = new Map<string, SimilarItem>();
    const rowsById = new Map((rows ?? []).map((row) => [row.id, row] as const));
    const currentSuperclass = itemSuperclass(current);

    const upsert = (item: ItemIndexEntry, patch: { setName?: string; ruleMatch?: boolean }) => {
      const id = String(item.id);
      const existing = byId.get(id);
      const setNames = existing?.setNames ?? [];
      if (patch.setName && !setNames.includes(patch.setName)) setNames.push(patch.setName);
      byId.set(id, {
        ...(existing ?? item),
        setNames,
        ruleMatch: (existing?.ruleMatch ?? false) || (patch.ruleMatch ?? false),
      });
    };

    for (const r of rows ?? []) {
      if (
        r.id !== current.id &&
        r.displayType === current.displayType &&
        r.rarity === current.rarity &&
        r.contentLevel === current.contentLevel
      ) {
        upsert(r, { ruleMatch: true });
      }
    }

    for (const set of Object.values(sets ?? {})) {
      if (!set.items.some((item) => String(item.id) === current.id)) continue;
      for (const item of set.items) {
        const id = String(item.id);
        if (id === current.id) continue;
        const row = rowsById.get(id);
        if (row && itemSuperclass(row) === currentSuperclass) upsert(row, { setName: set.name });
      }
    }

    return [...byId.values()].sort((a, b) => {
      const aReason = a.setNames.join(', ');
      const bReason = b.setNames.join(', ');
      if (!aReason && bReason) return -1;
      if (aReason && !bReason) return 1;
      if (aReason || bReason) return aReason.localeCompare(bReason) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
  }, [rows, sets, current]);

  if (loading || !sets || siblings.length === 0) return null;

  return (
    <Dropdown summary={`Similar items (${siblings.length})`}>
      <ul className="ref-list">
        {siblings.map((s) => {
          const ruleReason = [
            s.contentLevel > 0 ? `Lv${s.contentLevel}` : '',
            s.rarity,
            s.displayType,
          ].filter(Boolean).join(' ');
          return (
            <li key={s.id}>
              <EntityLink entity={{ type: 'item', id: s.id, name: s.name, icon: s.icon }} />
              <InlineMeta className="muted source-card-meta">
                {s.setNames.length > 0 && <span>{s.setNames.join(', ')}</span>}
                {s.setNames.length === 0 && s.ruleMatch && <span>{ruleReason}</span>}
              </InlineMeta>
            </li>
          );
        })}
      </ul>
    </Dropdown>
  );
}
