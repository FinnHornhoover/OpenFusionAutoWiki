import type { Mission } from '../data/types';
import EntityLink from './EntityLink';
import Icon from './Icon';
import InlineMeta from './InlineMeta';

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
      {itemSelectionNeeded && items.length > 1 && (
        <p className="reward-note muted">Choose one item reward.</p>
      )}
      <ul className="reward-list">
        {taros > 0 && (
          <li className="reward-card">
            <img className="reward-card-icon" src="/ui/taros.png" alt="" width={48} height={48} loading="lazy" />
            <span className="reward-card-main">
              <strong>{taros.toLocaleString()}</strong>
              <span className="muted">Taros</span>
            </span>
          </li>
        )}
        {fm > 0 && (
          <li className="reward-card">
            <img className="reward-card-icon" src="/ui/fusion-matter.png" alt="" width={48} height={48} loading="lazy" />
            <span className="reward-card-main">
              <strong>{fm.toLocaleString()}</strong>
              <span className="muted">Fusion Matter</span>
            </span>
          </li>
        )}
        {nano && (
          <li className="reward-card">
            {nano.icon ? <Icon src={nano.icon} alt="" size={48} /> : <span className="icon icon-empty" aria-hidden style={{ width: 48, height: 48 }} />}
            <span className="reward-card-main">
              <EntityLink entity={nano} withIcon={false} />
              <span className="muted">Nano</span>
            </span>
          </li>
        )}
        {items.map((it, i) => (
          <li className="reward-card" key={`${it.ref.id}-${i}`}>
            {it.ref.icon ? <Icon src={it.ref.icon} alt="" size={48} /> : <span className="icon icon-empty" aria-hidden style={{ width: 48, height: 48 }} />}
            <span className="reward-card-main">
              <EntityLink entity={it.ref} withIcon={false} />
              <InlineMeta className="reward-card-meta muted">
                {it.rarity && <span>{it.rarity}</span>}
                {it.requiredLevel > 0 && <span>Lv {it.requiredLevel}</span>}
                {it.itemKind && <span>{it.itemKind}</span>}
              </InlineMeta>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
