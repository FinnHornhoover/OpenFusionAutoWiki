import { useMemo } from 'react';
import { useParams } from 'react-router-dom';

import type { ItemIndexEntry } from '../data/types';
import { useIndex } from '../data/useIndex';
import Dropdown from './Dropdown';
import EntityLink from './EntityLink';

interface SimilarItemsProps {
  /** The currently-viewed item. Only id/typeId/contentLevel are read. */
  current: { id: string; typeId: number; contentLevel: number };
}

/**
 * Renders a dropdown listing items that share (typeId, contentLevel) with the
 * one being viewed. Pulls from the items summary index — already cached after
 * a user has browsed /items. Hides itself when the bucket is empty.
 *
 * Additional similarity rules can be layered in later (rarity buckets, same
 * weapon class, same set, etc.) by extending the filter below.
 */
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
            {s.rarity && s.rarity !== 'Common' && s.rarity !== 'Any' && (
              <span className="muted"> · {s.rarity}</span>
            )}
            {!s.obtainable && <span className="muted"> · unobtainable</span>}
          </li>
        ))}
      </ul>
    </Dropdown>
  );
}
