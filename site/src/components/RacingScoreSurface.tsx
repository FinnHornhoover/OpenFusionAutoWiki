import { useEffect, useMemo, useRef, useState } from 'react';

import { racingScoreUncapped } from '../data/racingScore';
import type { InfectedZone } from '../data/types';

interface Props { data: InfectedZone; }
interface Point { x: number; y: number; }
interface View { zoom: number; panX: number; panY: number; }
interface RankBand { color: string; points: string; }
interface HoverSample { pods: number; elapsed: number; score: number; }
interface DragState {
  pointerId: number;
  x: number;
  y: number;
  view: View;
}

const WIDTH = 760;
const HEIGHT = 500;
const PLOT_LEFT = 76;
const PLOT_RIGHT = 724;
const PLOT_TOP = 32;
const PLOT_BOTTOM = 430;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;
const CENTER_X = (PLOT_LEFT + PLOT_RIGHT) / 2;
const CENTER_Y = (PLOT_TOP + PLOT_BOTTOM) / 2;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const INITIAL_VIEW: View = { zoom: 1, panX: 0, panY: 0 };
const RANK_COLORS = {
  gold: '#d4af37',
  silver: '#e7ecf2',
  bronze: '#b87333',
  twoStar: '#8f99a5',
  oneStar: '#606b77',
  zeroStar: '#343e49',
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function project(podRatio: number, timeRatio: number, view: View): Point {
  const baseX = PLOT_LEFT + podRatio * PLOT_WIDTH;
  const baseY = PLOT_BOTTOM - timeRatio * PLOT_HEIGHT;
  return {
    x: CENTER_X + view.panX + (baseX - CENTER_X) * view.zoom,
    y: CENTER_Y + view.panY + (baseY - CENTER_Y) * view.zoom,
  };
}

function unproject(point: Point, view: View): Point {
  const baseX = CENTER_X + (point.x - CENTER_X - view.panX) / view.zoom;
  const baseY = CENTER_Y + (point.y - CENTER_Y - view.panY) / view.zoom;
  return {
    x: (baseX - PLOT_LEFT) / PLOT_WIDTH,
    y: (PLOT_BOTTOM - baseY) / PLOT_HEIGHT,
  };
}

function pointsAttribute(points: Point[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
}

function lineBetween(a: Point, b: Point) {
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${remainder}s`;
}

function clipByScoreBoundary(
  polygon: Point[],
  requiredScore: number,
  keepAbove: boolean,
  data: InfectedZone,
): Point[] {
  if (polygon.length === 0 || requiredScore <= 0) return polygon;
  const boundaryValue = (point: Point) =>
    data.podFactor * point.x - data.timeFactor * point.y + data.scaleFactor - Math.log(requiredScore);
  const inside = (value: number) => keepAbove ? value >= 0 : value <= 0;
  const clipped: Point[] = [];

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const startValue = boundaryValue(start);
    const endValue = boundaryValue(end);
    const startInside = inside(startValue);
    const endInside = inside(endValue);

    if (startInside) clipped.push(start);
    if (startInside !== endInside) {
      const amount = startValue / (startValue - endValue);
      clipped.push({
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
      });
    }
  }
  return clipped;
}

function colorForScore(score: number, thresholds: Map<number, number>): string {
  const colors = [
    RANK_COLORS.gold,
    RANK_COLORS.silver,
    RANK_COLORS.bronze,
    RANK_COLORS.twoStar,
    RANK_COLORS.oneStar,
  ];
  for (let stars = 5; stars >= 1; stars -= 1) {
    const threshold = thresholds.get(stars);
    if (threshold !== undefined && score >= threshold) return colors[5 - stars];
  }
  return RANK_COLORS.zeroStar;
}

function labelTextColor(score: number, thresholds: Map<number, number>): string {
  const fiveStar = thresholds.get(5);
  const fourStar = thresholds.get(4);
  return (fiveStar !== undefined && score >= fiveStar)
    || (fourStar !== undefined && score >= fourStar)
    ? '#17202a'
    : '#ffffff';
}

function constrainView(view: View): View {
  const maxPanX = (view.zoom - 1) * PLOT_WIDTH / 2;
  const maxPanY = (view.zoom - 1) * PLOT_HEIGHT / 2;
  return {
    ...view,
    panX: clamp(view.panX, -maxPanX, maxPanX),
    panY: clamp(view.panY, -maxPanY, maxPanY),
  };
}

function axisTicks(minimum: number, maximum: number): number[] {
  const span = maximum - minimum;
  if (span <= 0) return [minimum];
  const rawStep = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const multiplier = normalized <= 1.5 ? 1 : normalized <= 3 ? 2 : normalized <= 7 ? 5 : 10;
  const step = multiplier * magnitude;
  const first = Math.ceil((minimum - step * 1e-9) / step) * step;
  const ticks: number[] = [];
  for (let tick = first; tick <= maximum + step * 1e-9; tick += step) {
    ticks.push(Number(tick.toPrecision(12)));
  }
  return ticks;
}

function formatAxisValue(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function zoomView(current: View, factor: number, anchor: Point = { x: CENTER_X, y: CENTER_Y }): View {
  const zoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const ratio = zoom / current.zoom;
  return constrainView({
    zoom,
    panX: anchor.x - CENTER_X - (anchor.x - CENTER_X - current.panX) * ratio,
    panY: anchor.y - CENTER_Y - (anchor.y - CENTER_Y - current.panY) * ratio,
  });
}

export default function RacingScoreSurface({ data }: Props) {
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const [dragging, setDragging] = useState(false);
  const [hoverSample, setHoverSample] = useState<HoverSample | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const usable = data.podCount > 0 && data.timeLimitSeconds > 0 && data.podFactor > 0 && data.timeFactor > 0;
  const thresholds = useMemo(
    () => new Map(data.rankScores.map((score, index) => [5 - index, score])),
    [data.rankScores],
  );

  const bands = useMemo(() => {
    if (!usable) return null;
    const rectangle: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const ranked = [
      { stars: 5, color: RANK_COLORS.gold },
      { stars: 4, color: RANK_COLORS.silver },
      { stars: 3, color: RANK_COLORS.bronze },
      { stars: 2, color: RANK_COLORS.twoStar },
      { stars: 1, color: RANK_COLORS.oneStar },
    ].flatMap((rank) => {
      const requiredScore = thresholds.get(rank.stars);
      return requiredScore === undefined ? [] : [{ ...rank, requiredScore }];
    });
    const result: RankBand[] = [];
    let higherBoundary: number | null = null;

    for (const rank of ranked) {
      let polygon = clipByScoreBoundary(rectangle, rank.requiredScore, true, data);
      if (higherBoundary !== null) polygon = clipByScoreBoundary(polygon, higherBoundary, false, data);
      if (polygon.length >= 3) {
        result.push({
          color: rank.color,
          points: pointsAttribute(polygon.map((point) => project(point.x, point.y, view))),
        });
      }
      higherBoundary = rank.requiredScore;
    }

    let zeroStar = [...rectangle];
    if (higherBoundary !== null) zeroStar = clipByScoreBoundary(zeroStar, higherBoundary, false, data);
    if (zeroStar.length >= 3) {
      result.push({
        color: RANK_COLORS.zeroStar,
        points: pointsAttribute(zeroStar.map((point) => project(point.x, point.y, view))),
      });
    }
    return result;
  }, [data, thresholds, usable, view]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = svg.getBoundingClientRect();
      const anchor = {
        x: clamp((event.clientX - bounds.left) * WIDTH / bounds.width, PLOT_LEFT, PLOT_RIGHT),
        y: clamp((event.clientY - bounds.top) * HEIGHT / bounds.height, PLOT_TOP, PLOT_BOTTOM),
      };
      setView((current) => zoomView(current, Math.exp(-event.deltaY * 0.0015), anchor));
    };
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [usable]);

  if (!bands) return <p className="muted">Score map unavailable for this build.</p>;

  const visiblePodMin = clamp(unproject({ x: PLOT_LEFT, y: CENTER_Y }, view).x, 0, 1) * data.podCount;
  const visiblePodMax = clamp(unproject({ x: PLOT_RIGHT, y: CENTER_Y }, view).x, 0, 1) * data.podCount;
  const visibleTimeMin = clamp(unproject({ x: CENTER_X, y: PLOT_BOTTOM }, view).y, 0, 1) * data.timeLimitSeconds;
  const visibleTimeMax = clamp(unproject({ x: CENTER_X, y: PLOT_TOP }, view).y, 0, 1) * data.timeLimitSeconds;
  const podTicks = axisTicks(visiblePodMin, visiblePodMax);
  const timeTicks = axisTicks(visibleTimeMin, visibleTimeMax);
  const gridKey = podTicks.map((tick) => tick.toFixed(6)).join(',') + '|' + timeTicks.map((tick) => tick.toFixed(6)).join(',');
  const clipId = 'racing-score-map-' + data.id;
  const hoverPoint = hoverSample
    ? project(hoverSample.pods / data.podCount, hoverSample.elapsed / data.timeLimitSeconds, view)
    : null;

  function updateHover(cursor: Point) {
    if (cursor.x < PLOT_LEFT || cursor.x > PLOT_RIGHT || cursor.y < PLOT_TOP || cursor.y > PLOT_BOTTOM) {
      setHoverSample(null);
      return;
    }
    const ratios = unproject(cursor, view);
    if (ratios.x < 0 || ratios.x > 1 || ratios.y < 0 || ratios.y > 1) {
      setHoverSample(null);
      return;
    }
    const pods = Math.round(ratios.x * data.podCount);
    const elapsed = Math.round(ratios.y * data.timeLimitSeconds);
    setHoverSample({ pods, elapsed, score: racingScoreUncapped(data, pods, elapsed) });
  }

  return (
    <figure className="racing-score-surface racing-score-map">
      <div className="racing-score-viewport">
        <svg
          ref={svgRef}
          className={dragging ? 'is-pan' : ''}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`Racing rank map by pods collected and elapsed time for ${data.name}`}
          tabIndex={0}
          onDoubleClick={() => setView(INITIAL_VIEW)}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view };
            setDragging(true);
            setHoverSample(null);
          }}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const drag = dragRef.current;
            if (!drag) {
              updateHover({
                x: (event.clientX - bounds.left) * WIDTH / bounds.width,
                y: (event.clientY - bounds.top) * HEIGHT / bounds.height,
              });
              return;
            }
            if (drag.pointerId !== event.pointerId) return;
            setView(constrainView({
              ...drag.view,
              panX: drag.view.panX + (event.clientX - drag.x) * WIDTH / bounds.width,
              panY: drag.view.panY + (event.clientY - drag.y) * HEIGHT / bounds.height,
            }));
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId !== event.pointerId) return;
            dragRef.current = null;
            setDragging(false);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            setDragging(false);
          }}
          onPointerLeave={() => {
            if (!dragRef.current) setHoverSample(null);
          }}
          onKeyDown={(event) => {
            if (event.key === '+' || event.key === '=') setView((current) => zoomView(current, 1.2));
            else if (event.key === '-') setView((current) => zoomView(current, 1 / 1.2));
            else if (event.key === '0') setView(INITIAL_VIEW);
            else if (event.key.startsWith('Arrow')) {
              event.preventDefault();
              setView((current) => constrainView({
                ...current,
                panX: current.panX + (event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0),
                panY: current.panY + (event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0),
              }));
            }
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={PLOT_LEFT} y={PLOT_TOP} width={PLOT_WIDTH} height={PLOT_HEIGHT} />
            </clipPath>
          </defs>
          <g clipPath={'url(#' + clipId + ')'}>
            <g className="racing-score-bands" aria-hidden="true">
              {bands.map((band) => (
                <polygon key={band.color} points={band.points} fill={band.color} style={{ stroke: band.color }} />
              ))}
            </g>
            <g key={gridKey} className="racing-score-map-grid" aria-hidden="true">
              {podTicks.map((tick) => (
                <line key={'pod-grid-' + tick} {...lineBetween(project(tick / data.podCount, 0, view), project(tick / data.podCount, 1, view))} />
              ))}
              {timeTicks.map((tick) => (
                <line key={'time-grid-' + tick} {...lineBetween(project(0, tick / data.timeLimitSeconds, view), project(1, tick / data.timeLimitSeconds, view))} />
              ))}
            </g>
          </g>
          <g className="racing-score-map-grid" aria-hidden="true">
            <polygon points={PLOT_LEFT + ',' + PLOT_BOTTOM + ' ' + PLOT_RIGHT + ',' + PLOT_BOTTOM + ' ' + PLOT_RIGHT + ',' + PLOT_TOP + ' ' + PLOT_LEFT + ',' + PLOT_TOP} />
          </g>
          <g key={'axes-' + gridKey} className="racing-score-axes" aria-hidden="true">
            {podTicks.map((tick) => {
              const tickPoint = project(tick / data.podCount, 0, view);
              return <text key={'pods-' + tick} x={tickPoint.x} y={PLOT_BOTTOM + 22} textAnchor="middle">{formatAxisValue(tick)}</text>;
            })}
            {timeTicks.map((tick) => {
              const tickPoint = project(0, tick / data.timeLimitSeconds, view);
              return <text key={'time-' + tick} x={PLOT_LEFT - 10} y={tickPoint.y + 4} textAnchor="end">{formatSeconds(Math.round(tick))}</text>;
            })}
            <text className="racing-score-axis-label" x={CENTER_X} y={PLOT_BOTTOM + 52} textAnchor="middle">Pods</text>
            <text className="racing-score-axis-label" transform={'translate(' + (PLOT_LEFT - 54) + ' ' + CENTER_Y + ') rotate(-90)'} textAnchor="middle">Elapsed time</text>
          </g>
          {hoverSample && hoverPoint && (
            <g className="racing-score-probe" transform={`translate(${hoverPoint.x} ${hoverPoint.y})`} aria-hidden="true">
              <circle r="7" fill={colorForScore(hoverSample.score, thresholds)} />
              <g transform={`${hoverPoint.x > WIDTH - 285 ? 'translate(-282' : 'translate(12'} ${hoverPoint.y < 42 ? '12)' : '-38)'}`}>
                <rect width="270" height="30" rx="5" style={{ fill: colorForScore(hoverSample.score, thresholds) }} />
                <text x="135" y="20" textAnchor="middle" style={{ fill: labelTextColor(hoverSample.score, thresholds) }}>
                  Pods: {hoverSample.pods.toLocaleString()} · Time: {formatSeconds(hoverSample.elapsed)} · Score: {hoverSample.score.toLocaleString()}
                </text>
              </g>
            </g>
          )}
        </svg>
      </div>
      <figcaption className="racing-score-legend">
        {([
          [5, '5-star', RANK_COLORS.gold],
          [4, '4-star', RANK_COLORS.silver],
          [3, '3-star', RANK_COLORS.bronze],
          [2, '2-star', RANK_COLORS.twoStar],
          [1, '1-star', RANK_COLORS.oneStar],
        ] as const).map(([stars, label, color]) => thresholds.has(stars) && (
          <span key={stars}><i style={{ background: color }} />{label} ({thresholds.get(stars)!.toLocaleString()}+)</span>
        ))}
        <span><i style={{ background: RANK_COLORS.zeroStar }} />0-star ({'<'}{thresholds.get(1)!.toLocaleString()})</span>
      </figcaption>
    </figure>
  );
}
