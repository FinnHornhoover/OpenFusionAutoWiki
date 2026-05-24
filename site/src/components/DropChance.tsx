import type { DropChance as DropChanceData } from '../data/types';

function fmt(p: number): string {
  if (p <= 0) return '';
  // More precision for small chances so 0.05% doesn't render as 0.00%.
  const digits = p < 0.001 ? 4 : p < 0.01 ? 3 : 2;
  const pct = `${(p * 100).toFixed(digits)}%`;
  // Simplified odds: ceil(1/p) → "~1/30" reads more naturally than "333/2000".
  const denom = Math.ceil(1 / p);
  return `${pct} (~1/${denom.toLocaleString()})`;
}

interface Props {
  data: DropChanceData;
  /** Render with a leading separator (" · "). Default true since most callers want it inline. */
  leadingSeparator?: boolean;
}

/**
 * Renders the per-character drop chance for a gendered item source, accounting
 * for the full mob → crate → rarity → gender chain.
 *  - both 0 → renders nothing
 *  - boy === girl → "1.68%"
 *  - one side 0 → "1.68% (boys-only)" or "1.68% (girls-only)"
 *  - asymmetric → "1.68% boys / 1.96% girls"
 */
export default function DropChance({ data, leadingSeparator = true }: Props) {
  const { boyProbability: b, girlProbability: g } = data;
  if (b <= 0 && g <= 0) return null;
  const sep = leadingSeparator ? ' · ' : '';

  const same = Math.abs(b - g) < 1e-9;
  if (same) {
    return <span className="muted">{sep}{fmt(b)}</span>;
  }
  if (b > 0 && g <= 0) {
    return <span className="muted">{sep}{fmt(b)} (boys-only)</span>;
  }
  if (g > 0 && b <= 0) {
    return <span className="muted">{sep}{fmt(g)} (girls-only)</span>;
  }
  return <span className="muted">{sep}{fmt(b)} boys / {fmt(g)} girls</span>;
}
