import { useMemo, useState } from 'react';

import { racingScore } from '../data/racingScore';
import type { InfectedZone, InfectedZoneRankReward, Ref } from '../data/types';
import EntityLink from './EntityLink';

interface Props {
  data: InfectedZone;
}

interface DropOption {
  key: string;
  ref: Ref;
}

interface OptimizationResult {
  reward: InfectedZoneRankReward;
  pods: number;
  elapsed: number;
  deadline: number;
  score: number;
  probability: number;
  expectedSeconds: number;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function itemKey(ref: Ref): string {
  return `${ref.type}:${ref.id}`;
}

function starsForScore(score: number, boundaries: number[]): number {
  const index = boundaries.findIndex((boundary) => score >= boundary);
  return index < 0 ? 0 : 5 - index;
}

function minimumPodsForRank(data: InfectedZone, stars: number, elapsed: number): { pods: number; score: number } | null {
  const threshold = data.rankScores[5 - stars];
  if (!Number.isFinite(threshold) || threshold <= 0) return null;
  if (racingScore(data, data.podCount, elapsed) < threshold) return null;

  let low = 0;
  let high = data.podCount;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (racingScore(data, middle, elapsed) >= threshold) high = middle;
    else low = middle + 1;
  }

  const score = racingScore(data, low, elapsed);
  return starsForScore(score, data.rankScores) === stars ? { pods: low, score } : null;
}

function latestTimeForRank(data: InfectedZone, stars: number, pods: number, elapsed: number): number {
  const threshold = data.rankScores[5 - stars];
  let low = elapsed;
  let high = data.timeLimitSeconds;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (racingScore(data, pods, middle) >= threshold) low = middle;
    else high = middle - 1;
  }
  return low;
}

function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${remainder}s`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

function formatChance(probability: number): string {
  const digits = probability < 0.001 ? 4 : probability < 0.01 ? 3 : 2;
  return `${(probability * 100).toFixed(digits)}%`;
}

export default function RacingDropOptimizer({ data }: Props) {
  const options = useMemo<DropOption[]>(() => {
    const byItem = new Map<string, DropOption>();
    for (const reward of data.rankRewards) {
      for (const drop of reward.crateDrops) {
        const key = itemKey(drop.ref);
        if (!byItem.has(key)) byItem.set(key, { key, ref: drop.ref });
      }
    }
    return [...byItem.values()].sort((a, b) => a.ref.name.localeCompare(b.ref.name));
  }, [data.rankRewards]);

  const maxTime = Math.max(1, data.timeLimitSeconds);
  const [selectedKey, setSelectedKey] = useState(() => options[0]?.key ?? '');
  const [minimumTime, setMinimumTime] = useState(() => Math.min(60, maxTime));
  const [preferredPodsInput, setPreferredPodsInput] = useState('');
  const [gender, setGender] = useState<'boy' | 'girl'>('boy');
  const safeMinimumTime = clampInteger(minimumTime, 1, maxTime);
  const preferredPods = preferredPodsInput === '' ? null : clampInteger(Number(preferredPodsInput), 0, data.podCount);
  const selected = options.find((option) => option.key === selectedKey) ?? options[0];

  const result = useMemo<OptimizationResult | null>(() => {
    if (!selected || data.podCount <= 0 || data.timeLimitSeconds <= 0 || data.rankScores.length < 5) return null;
    let best: OptimizationResult | null = null;

    for (const reward of data.rankRewards) {
      const probability = Math.min(1, reward.crateDrops
        .filter((drop) => itemKey(drop.ref) === selected.key)
        .reduce((sum, drop) => sum + (gender === 'boy' ? drop.boyProbability : drop.girlProbability), 0));
      if (probability <= 0) continue;

      for (let elapsed = safeMinimumTime; elapsed <= maxTime; elapsed += 1) {
        const run = preferredPods === null
          ? minimumPodsForRank(data, reward.stars, elapsed)
          : (() => {
            const score = racingScore(data, preferredPods, elapsed);
            return starsForScore(score, data.rankScores) === reward.stars ? { pods: preferredPods, score } : null;
          })();
        if (!run) continue;
        const deadline = latestTimeForRank(data, reward.stars, run.pods, elapsed);
        const candidate: OptimizationResult = {
          reward,
          pods: run.pods,
          elapsed,
          deadline,
          score: racingScore(data, run.pods, deadline),
          probability,
          expectedSeconds: elapsed / probability,
        };
        if (!best
          || candidate.expectedSeconds < best.expectedSeconds
          || (candidate.expectedSeconds === best.expectedSeconds && candidate.pods < best.pods)) {
          best = candidate;
        }
        break;
      }
    }
    return best;
  }, [data, gender, maxTime, preferredPods, safeMinimumTime, selected]);

  if (options.length === 0) return <p className="muted">No crate drops are available for this build.</p>;

  return (
    <div className="iz-calculator racing-drop-optimizer">
      <div className="iz-calculator-controls">
        <label>
          <span>Target item</span>
          <select className="styled-select" value={selected?.key} onChange={(event) => setSelectedKey(event.currentTarget.value)}>
            {options.map((option) => <option key={option.key} value={option.key}>{option.ref.name}</option>)}
          </select>
        </label>
        <label>
          <span>Character</span>
          <select className="styled-select" value={gender} onChange={(event) => setGender(event.currentTarget.value as 'boy' | 'girl')}>
            <option value="boy">Boy</option>
            <option value="girl">Girl</option>
          </select>
        </label>
        <label>
          <span>Minimum seconds</span>
          <input
            type="number"
            min={1}
            max={maxTime}
            step={1}
            value={minimumTime}
            onChange={(event) => setMinimumTime(clampInteger(event.currentTarget.valueAsNumber, 1, maxTime))}
          />
        </label>
        <label>
          <span>Preferred pods</span>
          <input
            type="number"
            min={0}
            max={data.podCount}
            step={1}
            value={preferredPodsInput}
            placeholder="Auto"
            onChange={(event) => {
              const value = event.currentTarget.value;
              setPreferredPodsInput(value === '' ? '' : String(clampInteger(event.currentTarget.valueAsNumber, 0, data.podCount)));
            }}
          />
        </label>
      </div>
      {result ? (
        <>
          <dl className="stat-grid iz-calculator-results">
            <dt>Target</dt>
            <dd>{selected ? <EntityLink entity={selected.ref} /> : null}</dd>
            <dt>Rank</dt>
            <dd>{result.reward.label}</dd>
            <dt>Pods</dt>
            <dd>{result.pods.toLocaleString()}</dd>
            <dt>Latest run time</dt>
            <dd>{formatDuration(result.elapsed)} (+{formatDuration(result.deadline - result.elapsed)} slack)</dd>
            <dt>Score</dt>
            <dd>{result.score.toLocaleString()}</dd>
            <dt>Drop chance</dt>
            <dd>{formatChance(result.probability)}</dd>
            <dt>Average runs</dt>
            <dd>{(1 / result.probability).toFixed(2)}</dd>
            <dt>Average drop time</dt>
            <dd>{formatDuration(result.expectedSeconds)}</dd>
          </dl>
        </>
      ) : (
        <p className="muted">This item cannot drop for the selected character at an attainable rank and time.</p>
      )}
    </div>
  );
}
