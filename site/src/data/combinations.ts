import type { Ref } from './types';

export interface CombinationItem {
  id: string;
  name: string;
  icon: string;
  typeId: number;
  weaponType: string;
  level: number;
  rarity: string;
  rarityId: number;
  obtainable: boolean;
  guideItem: boolean;
  buyPrice: number;
  gender: string;
  singleDamage: number;
  multiDamage: number;
  defense: number;
  obtainCost: number;
  priceSource: 'player' | 'vendor' | 'estimate';
  vendor: Ref | null;
}
export interface CombinationRule {
  gap: number;
  looksMultiplier: number;
  statsMultiplier: number;
  probabilities: number[];
}
export interface CombinationData { items: CombinationItem[]; rules: CombinationRule[] }
export interface CombinationOptions {
  /** Academy only: guaranteed success for the initial uncombined level-zero style. */
  academyLevelZeroBonus?: boolean;
  ignoreObtainCost?: boolean;
  /** Maximum acquisition price per intermediate donor; null means unlimited. */
  priceLimit?: number | null;
  allowedRarities?: number[];
}
export interface CombinationStep {
  ignoreObtainCost: boolean;
  from: CombinationItem;
  item: CombinationItem;
  fee: number;
  probability: number;
  expectedFee: number;
  total: number;
  alternatives?: CombinationStep[];
}
/** Cost percentile for independent retries; purchases are paid only once.
 * Single random steps are exact. Multi-step estimates use a fixed seed and
 * 65,536 trials so rerenders never change the displayed scenario.
 */
export function combinationCostPercentile(steps: CombinationStep[], percentile: number): number {
  if (!(percentile > 0 && percentile < 1)) throw new RangeError('Percentile must be between 0 and 1');
  const fixed = steps.reduce((sum, step) => sum + (step.ignoreObtainCost ? 0 : step.item.obtainCost)
    + (step.probability === 1 ? step.fee : 0), 0);
  const random = steps.filter(step => step.probability < 1 && step.fee > 0);
  if (!random.length) return fixed;
  const attempts = (probability: number, quantile: number) => Math.max(1, Math.ceil(Math.log1p(-quantile) / Math.log1p(-probability)));
  if (random.length === 1) return fixed + random[0].fee * attempts(random[0].probability, percentile);
  let seed = 0x12345678;
  const samples = new Float64Array(65536);
  const trials = random.map(step => ({ fee: step.fee, logFailure: Math.log1p(-step.probability) }));
  for (let i = 0; i < samples.length; i++) {
    let cost = fixed;
    for (const trial of trials) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const uniform = ((seed >>> 0) + 0.5) / 4294967296;
      cost += trial.fee * Math.max(1, Math.ceil(Math.log1p(-uniform) / trial.logFailure));
    }
    samples[i] = cost;
  }
  samples.sort();
  return samples[Math.ceil(percentile * samples.length) - 1];
}

export interface CombinationResult { steps: CombinationStep[]; total: number; direct: CombinationStep | null }

export function compatible(a: CombinationItem, b: CombinationItem): boolean {
  return a.typeId >= 0 && a.typeId <= 3 && a.typeId === b.typeId
    && (a.typeId !== 0 || a.weaponType === b.weaponType)
    && a.rarityId >= 1 && a.rarityId <= 4 && b.rarityId >= 1 && b.rarityId <= 4;
}
/** Guide items may supply the appearance, but never the stats. */
export function statsDonor(item: CombinationItem): boolean {
  return item.obtainable === true && item.guideItem !== true;
}

export function combinationStep(from: CombinationItem, item: CombinationItem, rule?: CombinationRule, ignoreObtainCost = false, styleBuyPrice = from.buyPrice, guaranteedSuccess = false): CombinationStep | null {
  if (!statsDonor(item) || !compatible(from, item) || !rule || rule.gap !== Math.abs(from.level - item.level)) return null;
  const probability = guaranteedSuccess ? 1 : rule.probabilities[Math.abs(from.rarityId - item.rarityId)];
  const fee = Math.trunc(styleBuyPrice * rule.looksMultiplier + item.buyPrice * rule.statsMultiplier);
  if (!Number.isFinite(probability) || probability <= 0 || probability > 1
    || !Number.isFinite(fee) || fee < 0 || !Number.isFinite(item.obtainCost) || item.obtainCost < 0) return null;
  const expectedFee = fee / probability;
  return { from, item, fee, probability, expectedFee, ignoreObtainCost, total: (ignoreObtainCost ? 0 : item.obtainCost) + expectedFee };
}

/** Positive-edge shortest path, advancing donor stats while retaining the original style price.
 * Acquisition is paid once; only fees repeat on failure. No monotonic-level restriction.
 */
export function optimizeCombination(data: CombinationData, style: CombinationItem, level: number, rarityId: number, options: CombinationOptions = {}): CombinationResult | null {
  const { ignoreObtainCost = false, priceLimit = null, allowedRarities = [1, 2, 3, 4] } = options;
  const guaranteedFirstStep = options.academyLevelZeroBonus === true && style.level === 0;
  const rules = new Map(data.rules.map(rule => [rule.gap, rule]));
  const target = (item: CombinationItem) => item.level === level && item.rarityId === rarityId;
  const donors = data.items.filter(item => statsDonor(item) && compatible(style, item)
    && (target(item) || ((priceLimit === null || item.obtainCost <= priceLimit) && allowedRarities.includes(item.rarityId))));
  let direct: CombinationStep | null = null;
  for (const item of donors.filter(target)) {
    const step = combinationStep(style, item, rules.get(Math.abs(style.level - item.level)), ignoreObtainCost, style.buyPrice, guaranteedFirstStep);
    if (step && (!direct || step.total < direct.total)) direct = step;
  }
  if (target(style)) return { steps: [], total: 0, direct };
  const nodes = [style, ...donors];
  const distance = nodes.map(() => Infinity);
  const visited = nodes.map(() => false);
  const previous = nodes.map(() => -1);
  const edges: (CombinationStep | null)[] = nodes.map(() => null);
  distance[0] = 0;
  for (let iteration = 0; iteration < nodes.length; iteration++) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (!visited[i] && Number.isFinite(distance[i]) && (current < 0 || distance[i] < distance[current])) current = i;
    }
    if (current < 0) break;
    if (current > 0 && target(nodes[current])) {
      const steps: CombinationStep[] = [];
      for (let i = current; previous[i] >= 0; i = previous[i]) steps.push(edges[i]!);
      steps.reverse();
      for (let index = 0; index < steps.length; index++) {
        const step = steps[index];
        const next = steps[index + 1];
        const equalCost = (a: number, b: number) => Math.abs(a - b) <= 1e-8;
        step.alternatives = donors.flatMap(item => {
          if (item.id === step.item.id || item.level !== step.item.level || item.rarityId !== step.item.rarityId) return [];
          const alternative = combinationStep(step.from, item, rules.get(Math.abs(step.from.level - item.level)), ignoreObtainCost, style.buyPrice, guaranteedFirstStep && index === 0);
          if (!alternative || !equalCost(alternative.total, step.total)) return [];
          // A substitute must also leave the next combination's cost unchanged.
          if (next) {
            const following = combinationStep(item, next.item, rules.get(Math.abs(item.level - next.item.level)), ignoreObtainCost, style.buyPrice);
            if (!following || !equalCost(following.total, next.total)) return [];
          }
          return [alternative];
        }).sort((a, b) => a.item.name.localeCompare(b.item.name) || a.item.id.localeCompare(b.item.id));
      }
      return { steps, total: distance[current], direct };
    }
    visited[current] = true;
    for (let next = 1; next < nodes.length; next++) {
      if (visited[next]) continue;
      const step = combinationStep(nodes[current], nodes[next], rules.get(Math.abs(nodes[current].level - nodes[next].level)), ignoreObtainCost, style.buyPrice, guaranteedFirstStep && current === 0);
      if (step && distance[current] + step.total < distance[next]) {
        distance[next] = distance[current] + step.total;
        previous[next] = current;
        edges[next] = step;
      }
    }
  }
  return null;
}
