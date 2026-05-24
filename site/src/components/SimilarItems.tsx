import { useMemo } from 'react';
import { useParams } from 'react-router-dom';

import type { ItemIndexEntry } from '../data/types';
import { useIndex } from '../data/useIndex';
import Dropdown from './Dropdown';
import EntityLink from './EntityLink';

interface SimilarItemsProps {
  current: { id: string; typeId: number; contentLevel: number };
}

export default function SimilarItems({ current }: SimilarItemsProps) {
  const { build } = useParams();
  const { rows, loading } = useIndex<ItemIndexEntry>(build, 'items');

  const siblings = useMemo(() => {
    if (!rows) return [];
    return rows
      .filter(
        (r) =>
          r.id !== current.id &&
          r.typeId === current.typeId &&
          r.contentLevel === current.contentLevel,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, current.id, current.typeId, current.contentLevel]);

  if (loading || siblings.length === 0) return null;

  return (
    <Dropdown summary={`Similar items (${siblings.length})`}>
      <ul className="ref-list">
        {siblings.map((s) => (
          <li key={s.id}>
            <EntityLink entity={{ type: 'item', id: s.id, name: s.name, icon: s.icon }} />
          </li>
        ))}
      </ul>
    </Dropdown>
  );
}
