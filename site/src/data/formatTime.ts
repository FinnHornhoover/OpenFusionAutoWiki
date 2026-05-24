export function formatDurationSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '';

  const seconds = Math.round(totalSeconds);
  const units: Array<[string, number]> = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];
  const parts: string[] = [];
  let remaining = seconds;

  for (const [label, size] of units) {
    const value = Math.floor(remaining / size);
    if (value <= 0) continue;
    parts.push(`${value} ${label}${value === 1 ? '' : 's'}`);
    remaining -= value * size;
    if (parts.length === 2) break;
  }

  return parts.join(', ');
}
