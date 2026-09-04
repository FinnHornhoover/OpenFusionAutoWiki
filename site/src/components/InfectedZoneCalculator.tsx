import { useMemo, useState } from 'react';

import { racingScore } from '../data/racingScore';
import type { InfectedZone } from '../data/types';

interface Props {
  data: InfectedZone;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function finalFm(base: number, scavenge: number, raceBoost: number): number {
  const scavenged = Math.trunc(base * scavenge);
  return Math.trunc(scavenged * raceBoost);
}

export default function InfectedZoneCalculator({ data }: Props) {
  const maxPods = Math.max(0, data.podCount);
  const maxTime = Math.max(0, data.timeLimitSeconds);
  const [pods, setPods] = useState(maxPods);
  const [elapsed, setElapsed] = useState(maxTime);
  const [scavenge, setScavenge] = useState(1);
  const [raceBoost, setRaceBoost] = useState(1);

  const usable = maxPods > 0 && maxTime > 0 && data.podFactor > 0 && data.timeFactor > 0;
  const result = useMemo(() => {
    if (!usable) return null;
    const safePods = clampNumber(pods, 0, maxPods);
    const safeElapsed = clampNumber(elapsed, 0, maxTime);
    const rawScore = Math.trunc(Math.exp(
      (data.podFactor * safePods) / maxPods
      - (data.timeFactor * safeElapsed) / maxTime
      + data.scaleFactor,
    ));
    const score = racingScore(data, safePods, safeElapsed);
    const baseFm = Math.trunc((1 + Math.exp(data.scaleFactor - 1) * data.podFactor * safePods) / maxPods);
    return {
      pods: safePods,
      elapsed: safeElapsed,
      score,
      rawScore,
      baseFm,
      boostedFm: finalFm(baseFm, scavenge, raceBoost),
    };
  }, [data.maxScore, data.podFactor, data.scaleFactor, data.timeFactor, elapsed, maxPods, maxTime, pods, raceBoost, scavenge, usable]);

  if (!usable) {
    return (
      <div className="iz-calculator">
        <p className="muted">Calculator unavailable for this build.</p>
      </div>
    );
  }

  return (
    <div className="iz-calculator">
      <div className="iz-calculator-controls">
        <label>
          <span>Pods</span>
          <input
            type="number"
            min={0}
            max={maxPods}
            step={1}
            value={pods}
            onChange={(e) => setPods(clampNumber(e.currentTarget.valueAsNumber, 0, maxPods))}
          />
        </label>
        <label>
          <span>Elapsed seconds</span>
          <input
            type="number"
            min={0}
            max={maxTime}
            step={1}
            value={elapsed}
            onChange={(e) => setElapsed(clampNumber(e.currentTarget.valueAsNumber, 0, maxTime))}
          />
        </label>
        <label>
          <span>Scavenge?</span>
          <select className="styled-select" value={scavenge} onChange={(e) => setScavenge(Number(e.currentTarget.value))}>
            <option value={1}>None</option>
            <option value={1.2}>Scavenge</option>
          </select>
        </label>
        <label>
          <span>Booster?</span>
          <select className="styled-select" value={raceBoost} onChange={(e) => setRaceBoost(Number(e.currentTarget.value))}>
            <option value={1}>None</option>
            <option value={1.5}>Racing Booster</option>
            <option value={1.75}>Super Booster DX</option>
          </select>
        </label>
      </div>
      <dl className="stat-grid iz-calculator-results">
        <dt>Time</dt>
        <dd>{formatTime(result?.elapsed ?? 0)}</dd>
        <dt>Score</dt>
        <dd>{result?.score.toLocaleString()}</dd>
        <dt>Unbounded score</dt>
        <dd>{result?.rawScore.toLocaleString()}</dd>
        <dt>Base FM</dt>
        <dd>{result?.baseFm.toLocaleString()}</dd>
        <dt>Final FM</dt>
        <dd>{result?.boostedFm.toLocaleString()}</dd>
      </dl>
    </div>
  );
}
