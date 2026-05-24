import type { Mission } from '../data/types';
import EntityLink from './EntityLink';

interface RewardBoxProps {
  rewards: Mission['rewards'];
}

export default function RewardBox({ rewards }: RewardBoxProps) {
  const { fm, taros, items, nano, itemSelectionNeeded } = rewards;
  const hasAny = fm > 0 || taros > 0 || items.length > 0 || nano !== null;

  if (!hasAny) {
    return <p className="muted">No rewards.</p>;
  }

  return (
    <div className="reward-box">
      <ul className="reward-stats">
        {taros > 0 && <li><strong>{taros.toLocaleString()}</strong> Taros</li>}
        {fm > 0 && <li><strong>{fm.toLocaleString()}</strong> Fusion Matter</li>}
      </ul>
      {nano && (
        <div className="reward-row">
          <span className="reward-label">Nano:</span> <EntityLink entity={nano} />
        </div>
      )}
      {items.length > 0 && (
        <div className="reward-row">
          <span className="reward-label">
            {itemSelectionNeeded ? 'Choose one:' : items.length === 1 ? 'Item:' : 'Items:'}
          </span>
          <ul className="reward-items">
            {items.map((it, i) => (
              <li key={`${it.ref.id}-${i}`}>
                <EntityLink entity={it.ref} />
                {it.rarity && <span className="muted"> · {it.rarity}</span>}
                {it.requiredLevel > 0 && <span className="muted"> · Lv {it.requiredLevel}</span>}
                {it.itemKind && <span className="muted"> · {it.itemKind}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
