import type { ReactNode } from 'react';

import type { DropChance as DropChanceData } from '../data/types';
import InlineMeta from './InlineMeta';

function fmt(p: number): string {
  if (p <= 0) return '';
  // Keep tiny chances visible.
  const digits = p < 0.001 ? 4 : p < 0.01 ? 3 : 2;
  const pct = `${(p * 100).toFixed(digits)}%`;
  // Rounded odds are easier to scan than exact fractions.
  const denom = Math.ceil(1 / p);
  return `${pct} (~1/${denom.toLocaleString()})`;
}

interface Props {
  data: DropChanceData;
  /** Include a leading inline separator. */
  leadingSeparator?: boolean;
}

/**
 * Per-character drop chance after mob, crate, rarity, and gender rolls.
 *  - both 0 → renders nothing
 *  - boy === girl → "1.68%"
 *  - one side 0 → "1.68% (boys-only)" or "1.68% (girls-only)"
 *  - asymmetric -> boys and girls render on separate lines
 */
export default function DropChance({ data, leadingSeparator = true }: Props) {
  const { boyProbability: b, girlProbability: g } = data;
  if (b <= 0 && g <= 0) return null;
  const same = Math.abs(b - g) < 1e-9;
  let label: ReactNode;
  if (same) {
    label = fmt(b);
  } else if (b > 0 && g <= 0) {
    label = `${fmt(b)} (boys-only)`;
  } else if (g > 0 && b <= 0) {
    label = `${fmt(g)} (girls-only)`;
  } else {
    label = <>
      {fmt(b)} boys
      <br />
      {fmt(g)} girls
    </>;
  }

  return <InlineMeta leading={leadingSeparator}>{label}</InlineMeta>;
}
