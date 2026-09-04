export interface RacingScoreCoefficients {
  maxScore: number;
  podCount: number;
  podFactor: number;
  scaleFactor: number;
  timeFactor: number;
  timeLimitSeconds: number;
}

export function racingScoreFloat(
  coefficients: RacingScoreCoefficients,
  pods: number,
  elapsedSeconds: number,
): number {
  return Math.exp(
    (coefficients.podFactor * pods) / coefficients.podCount
    - (coefficients.timeFactor * elapsedSeconds) / coefficients.timeLimitSeconds
    + coefficients.scaleFactor,
  );
}

export function racingScoreUncapped(
  coefficients: RacingScoreCoefficients,
  pods: number,
  elapsedSeconds: number,
): number {
  return Math.trunc(racingScoreFloat(coefficients, pods, elapsedSeconds));
}

export function racingScore(
  coefficients: RacingScoreCoefficients,
  pods: number,
  elapsedSeconds: number,
): number {
  const rawScore = racingScoreUncapped(coefficients, pods, elapsedSeconds);

  return coefficients.maxScore > 0
    ? Math.min(rawScore, coefficients.maxScore)
    : rawScore;
}
