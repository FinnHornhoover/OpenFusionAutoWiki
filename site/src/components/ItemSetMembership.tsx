import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { ItemSet } from '../data/types';
import Dropdown from './Dropdown';

const cache = new Map<string, Promise<Record<string, ItemSet>>>();

async function loadItemSets(build: string): Promise<Record<string, ItemSet>> {
  let promise = cache.get(build);
  if (!promise) {
    promise = fetch(`/data/${build}/item_sets.json`).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<Record<string, ItemSet>>;
    });
    cache.set(build, promise);
  }
  return promise;
}

interface Props {
  build: string;
  itemId: string;
}

export default function ItemSetMembership({ build, itemId }: Props) {
  const [sets, setSets] = useState<Record<string, ItemSet> | null>(null);

  useEffect(() => {
    let alive = true;
    loadItemSets(build).then(
      (rows) => { if (alive) setSets(rows); },
      () => { if (alive) setSets({}); },
    );
    return () => { alive = false; };
  }, [build]);

  const matches = useMemo(() => {
    if (!sets) return [];
    return Object.values(sets)
      .filter((set) => set.items.some((item) => String(item.id) === itemId))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  }, [sets, itemId]);

  if (!sets || matches.length === 0) return null;

  return (
    <Dropdown summary={`Item sets (${matches.length})`} open>
      <ul className="ref-list">
        {matches.map((set) => (
          <li key={set.id}>
            <Link className="entity-link" to={`/${build}/item-sets/${set.id}`}>
              <span className="entity-link-body">
                <span className="entity-link-name">{set.name}</span>
              </span>
            </Link>
            <span className="muted source-card-meta">{set.items.length.toLocaleString()} items</span>
          </li>
        ))}
      </ul>
    </Dropdown>
  );
}
