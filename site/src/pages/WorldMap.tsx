import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ErrorState from '../components/ErrorState';
import MapRouteTooltip from '../components/MapRouteTooltip';
import { MINIMAP_PX, worldToPx } from '../data/minimapCoords';
import { buildWorldMapMarkers, buildWorldTransportRoutes, buildWorldWarpRoutes, buildWorldBossPaths, MAP_MARKER_KIND_LABELS, MAP_MARKER_KINDS, type MapMarker, type MapMarkerKind } from '../data/mapMarkers';
import type { Area } from '../data/types';
import { useBuildEntry } from '../data/useBuildEntry';
import { TITLE_SEPARATOR, useDocumentTitle } from '../data/useDocumentTitle';

const WORLD_MARKER_SCREEN_SIZE = 32;
const WORLD_MARKER_CULL_BUFFER = WORLD_MARKER_SCREEN_SIZE * 2;
const MIN_WORLD_MAP_ZOOM = 1.5;
const INITIAL_WORLD_MAP_ZOOM = 2;
const MAX_WORLD_MAP_ZOOM = 24;

type VisibleMarkerKinds = Record<MapMarkerKind, boolean>;
type RenderedWorldMarker = MapMarker & { px: number; py: number };

function defaultVisibleMarkerKinds(): VisibleMarkerKinds {
  return Object.fromEntries(MAP_MARKER_KINDS.map((kind) => [kind, kind !== 'monster'])) as VisibleMarkerKinds;
}

const ROUTE_CLASS: Record<string, string> = {
  monkeyskyway: 'monkey-skyway',
  monkey: 'monkey-skyway',
  scamper: 'scamper',
  slider: 'slider',
  woosh: 'woosh',
  warp: 'warp',
};

function routeClass(moveType: string): string {
  const key = moveType.toLowerCase().replace(/[^a-z]/g, '');
  return ROUTE_CLASS[key] ?? 'other';
}

function clampZoom(value: number): number {
  return Math.min(MAX_WORLD_MAP_ZOOM, Math.max(MIN_WORLD_MAP_ZOOM, value));
}

interface PointerPoint {
  x: number;
  y: number;
}

function distance(a: PointerPoint, b: PointerPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: PointerPoint, b: PointerPoint): PointerPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function useAreas(build: string | undefined) {
  const [state, setState] = useState<{ areas: Area[]; loading: boolean; error: string | null }>({ areas: [], loading: Boolean(build), error: null });

  useEffect(() => {
    if (!build) return;
    let alive = true;
    setState({ areas: [], loading: true, error: null });
    fetch(`/data/${build}/areas/0.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Record<string, Area>>;
      })
      .then((bucket) => {
        if (!alive) return;
        setState({ areas: Object.values(bucket), loading: false, error: null });
      }, (err: unknown) => {
        if (!alive) return;
        setState({ areas: [], loading: false, error: err instanceof Error ? err.message : 'Failed to load areas' });
      });
    return () => {
      alive = false;
    };
  }, [build]);

  return state;
}

export default function WorldMap() {
  const { build } = useParams();
  const entry = useBuildEntry(build);
  const { areas, loading, error } = useAreas(build);
  const [offset, setOffset] = useState({ x: -520, y: -520 });
  const [zoom, setZoom] = useState(INITIAL_WORLD_MAP_ZOOM);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [hoverRoutes, setHoverRoutes] = useState<string[]>([]);
  const [hoverRoute, setHoverRoute] = useState<{ key: string; x: number; y: number } | null>(null);
  const [hoverMarkerId, setHoverMarkerId] = useState<string | null>(null);
  const [visibleKinds, setVisibleKinds] = useState<VisibleMarkerKinds>(() => defaultVisibleMarkerKinds());
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  const offsetRef = useRef(offset);
  const activePointers = useRef(new Map<number, PointerPoint>());
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const pinch = useRef<{ startDistance: number; startZoom: number; anchorX: number; anchorY: number } | null>(null);

  useDocumentTitle(entry ? `World Map${TITLE_SEPARATOR}${entry.displayName}` : build ? `World Map${TITLE_SEPARATOR}${build}` : null);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { offsetRef.current = offset; }, [offset]);
  useEffect(() => () => {
    activePointers.current.clear();
    drag.current = null;
    pinch.current = null;
  }, []);

  const markers = useMemo(() => build && areas.length > 0 ? buildWorldMapMarkers(areas, build) : [], [areas, build]);
  const visibleMarkers = useMemo<RenderedWorldMarker[]>(() => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0) return [];

    const buffer = WORLD_MARKER_CULL_BUFFER / zoom;
    const left = -offset.x / zoom - buffer;
    const top = -offset.y / zoom - buffer;
    const right = (viewportSize.width - offset.x) / zoom + buffer;
    const bottom = (viewportSize.height - offset.y) / zoom + buffer;
    const rendered: RenderedWorldMarker[] = [];

    for (const marker of markers) {
      if (!visibleKinds[marker.kind]) continue;
      const pos = worldToPx(marker.x, marker.y);
      if (pos.px < left || pos.px > right || pos.py < top || pos.py > bottom) continue;
      rendered.push({ ...marker, px: pos.px, py: pos.py });
    }

    return rendered;
  }, [markers, offset.x, offset.y, viewportSize.height, viewportSize.width, visibleKinds, zoom]);
  const routes = useMemo(() => [
    ...(visibleKinds.transport ? buildWorldTransportRoutes(areas) : []),
    ...(visibleKinds['instance-warp'] ? buildWorldWarpRoutes(areas) : []),
  ], [areas, visibleKinds.transport, visibleKinds['instance-warp']]);
  const bossPaths = useMemo(() => visibleKinds['world-boss'] ? buildWorldBossPaths(areas) : [], [areas, visibleKinds]);
  const hoveredMarker = visibleMarkers.find((marker) => marker.id === hoverMarkerId);
  const markerRouteLabels = hoveredMarker
    ? [...new Set(routes.filter((route) => route.routeKeys.some((key) => hoverRoutes.includes(key))).map((route) => route.label))]
    : [];
  const markerScreenX = hoveredMarker ? offset.x + hoveredMarker.px * zoom : 0;
  const markerScreenY = hoveredMarker ? offset.y + hoveredMarker.py * zoom : 0;
  const markerScale = 1 / zoom;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateViewport = () => {
      const rect = viewport.getBoundingClientRect();
      const nextSize = { width: rect.width, height: rect.height };
      setViewportSize((prev) => {
        if (nextSize.width <= 0 || nextSize.height <= 0) return nextSize;

        const currentZoom = zoomRef.current;
        const currentOffset = offsetRef.current;
        if (prev.width <= 0 || prev.height <= 0) {
          const nextOffset = {
            x: nextSize.width / 2 - (MINIMAP_PX / 2) * currentZoom,
            y: nextSize.height / 2 - (MINIMAP_PX / 2) * currentZoom,
          };
          offsetRef.current = nextOffset;
          setOffset(nextOffset);
          return nextSize;
        }

        const centerX = (prev.width / 2 - currentOffset.x) / currentZoom;
        const centerY = (prev.height / 2 - currentOffset.y) / currentZoom;
        const nextOffset = {
          x: nextSize.width / 2 - centerX * currentZoom,
          y: nextSize.height / 2 - centerY * currentZoom,
        };
        offsetRef.current = nextOffset;
        setOffset(nextOffset);
        return nextSize;
      });
    };
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  function clearPointer(pointerId: number) {
    activePointers.current.delete(pointerId);
    if (drag.current?.pointerId === pointerId) drag.current = null;
    pinch.current = null;
  }


  function toggleMarkerKind(kind: MapMarkerKind) {
    setVisibleKinds((prev) => ({ ...prev, [kind]: !prev[kind] }));
    setHoverRoute(null);
    setHoverMarkerId(null);
    if ((kind === 'transport' || kind === 'world-boss' || kind === 'instance-warp') && visibleKinds[kind]) setHoverRoutes([]);
  }

  function hoverBossPath(pathId: string) {
    const boss = markers.find((marker) => marker.kind === 'world-boss' && marker.routeKeys?.includes(pathId));
    setHoverMarkerId(null);
    setHoverRoutes(boss?.routeKeys ?? [pathId]);
    setHoverRoute({ key: pathId, x: -offset.x + viewportSize.width / 2, y: -offset.y + 35 });
  }

  if (!build) return null;

  return (
    <section className="world-map-page">
      <p className="breadcrumb muted">
        <Link to={`/${build}`}>{entry ? entry.displayName : build}</Link>
      </p>
      <h1>World Map</h1>
      {error && <ErrorState title="Couldn't load the map" message="Area data failed to load." detail={error} />}
      {!error && (
        <div className="map-marker-toggles" aria-label="Map marker filters">
          {MAP_MARKER_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={'type-tab' + (visibleKinds[kind] ? ' active' : '')}
              aria-pressed={visibleKinds[kind]}
              onClick={() => toggleMarkerKind(kind)}
            >
              {MAP_MARKER_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      )}
      {loading && <p className="muted">Loading map...</p>}
      {!error && (
        <div
          ref={viewportRef}
          className="world-map-viewport"
          onWheel={(event) => {
            event.preventDefault();
            setHoverRoute(null);
            const rect = event.currentTarget.getBoundingClientRect();
            const nextZoom = clampZoom(zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2));
            const cursorX = event.clientX - rect.left;
            const cursorY = event.clientY - rect.top;
            const worldX = (cursorX - offset.x) / zoom;
            const worldY = (cursorY - offset.y) / zoom;
            setZoom(nextZoom);
            setOffset({
              x: cursorX - worldX * nextZoom,
              y: cursorY - worldY * nextZoom,
            });
          }}
          onPointerDown={(event) => {
            if ((event.target as Element).closest('a')) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

            if (activePointers.current.size >= 2) {
              const rect = event.currentTarget.getBoundingClientRect();
              const [first, second] = [...activePointers.current.values()];
              const mid = midpoint(first, second);
              const cursorX = mid.x - rect.left;
              const cursorY = mid.y - rect.top;
              pinch.current = {
                startDistance: distance(first, second),
                startZoom: zoom,
                anchorX: (cursorX - offset.x) / zoom,
                anchorY: (cursorY - offset.y) / zoom,
              };
              drag.current = null;
              return;
            }

            drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
          }}
          onPointerMove={(event) => {
            if (!activePointers.current.has(event.pointerId)) return;
            event.preventDefault();
            activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

            if (pinch.current && activePointers.current.size >= 2) {
              const rect = event.currentTarget.getBoundingClientRect();
              const [first, second] = [...activePointers.current.values()];
              const mid = midpoint(first, second);
              const nextZoom = clampZoom(pinch.current.startZoom * distance(first, second) / Math.max(1, pinch.current.startDistance));
              const cursorX = mid.x - rect.left;
              const cursorY = mid.y - rect.top;
              setZoom(nextZoom);
              setOffset({
                x: cursorX - pinch.current.anchorX * nextZoom,
                y: cursorY - pinch.current.anchorY * nextZoom,
              });
              return;
            }

            const active = drag.current;
            if (!active || active.pointerId !== event.pointerId) return;
            setOffset({ x: active.originX + event.clientX - active.startX, y: active.originY + event.clientY - active.startY });
          }}
          onPointerUp={(event) => { clearPointer(event.pointerId); }}
          onPointerCancel={(event) => { clearPointer(event.pointerId); }}
          onLostPointerCapture={(event) => { clearPointer(event.pointerId); }}
          onPointerLeave={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) clearPointer(event.pointerId); }}
        >
          <div
            className="world-map-canvas"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            } as CSSProperties}
          >
            <img src="/minimap/all.png" alt="" className="world-map-image" draggable={false} />
            {/* Cancel the canvas scale for strokes; only route coordinates scale with zoom. */}
            <svg
              className="world-map-routes"
              style={{ width: MINIMAP_PX * zoom, height: MINIMAP_PX * zoom, transform: `scale(${1 / zoom})` }}
              aria-label="Boss patrol, warp and transportation routes"
            >
              {bossPaths.map((path) => {
                const points = path.points.map((point) => {
                    const pos = worldToPx(point.x, point.y);
                    return `${pos.px * zoom},${pos.py * zoom}`;
                }).join(' ');
                return <g key={path.id}>
                  <polyline className={`world-boss-path${hoverRoutes.includes(path.id) ? ' is-active' : ''}`} points={points} />
                  <polyline className="map-route-hitbox" points={points}
                    tabIndex={0} role="img" aria-label={path.label}
                    onMouseEnter={() => hoverBossPath(path.id)}
                    onMouseMove={(event) => {
                      if (activePointers.current.size) return;
                      const rect = viewportRef.current?.getBoundingClientRect();
                      if (rect) setHoverRoute({ key: path.id, x: event.clientX - rect.left - offset.x, y: event.clientY - rect.top - offset.y });
                    }}
                    onMouseLeave={() => { setHoverRoute(null); setHoverRoutes([]); }}
                    onFocus={() => hoverBossPath(path.id)}
                    onBlur={() => { setHoverRoute(null); setHoverRoutes([]); }}
                  />
                </g>;
              })}
              {routes.map((route) => {
                const points = route.points.map((p) => {
                    const pos = worldToPx(p.x, p.y);
                    return `${pos.px * zoom},${pos.py * zoom}`;
                }).join(' ');
                const active = route.routeKeys.some((key) => hoverRoutes.includes(key));
                return <g key={route.key}>
                  <polyline
                    className={`world-map-route world-map-route-${routeClass(route.moveType)}${active ? ' is-active' : ''}`}
                    points={points}
                    style={{ pointerEvents: 'none' }}
                  />
                  <polyline
                    className="map-route-hitbox"
                    points={points}
                    tabIndex={0}
                    role="img"
                    aria-label={route.label}
                    onMouseEnter={() => { setHoverMarkerId(null); setHoverRoutes(route.routeKeys); }}
                    onMouseMove={(event) => {
                      if (activePointers.current.size) return;
                      const rect = viewportRef.current?.getBoundingClientRect();
                      if (rect) setHoverRoute({ key: route.key, x: event.clientX - rect.left - offset.x, y: event.clientY - rect.top - offset.y });
                    }}
                    onMouseLeave={() => { setHoverRoutes([]); setHoverRoute(null); }}
                    onFocus={() => {
                      setHoverMarkerId(null);
                      setHoverRoutes(route.routeKeys);
                      setHoverRoute({ key: route.key, x: -offset.x + viewportSize.width / 2, y: -offset.y + 35 });
                    }}
                    onBlur={() => { setHoverRoutes([]); setHoverRoute(null); }}
                  />
                </g>;
              })}
              {hoverRoute && (() => {
                const route = routes.find((r) => r.key === hoverRoute.key) ?? bossPaths.find((path) => path.id === hoverRoute.key);
                if (!route) return null;
                const x = Math.max(-offset.x + 12, Math.min(-offset.x + viewportSize.width - 12, hoverRoute.x));
                const y = Math.max(-offset.y + 22, Math.min(-offset.y + viewportSize.height - 12, hoverRoute.y - 12));
                return <text
                  className="map-route-label"
                  x={x}
                  y={y}
                  textAnchor={x > -offset.x + viewportSize.width / 2 ? 'end' : 'start'}
                  style={{ fontSize: 13, strokeWidth: 4 }}
                >{route.label}</text>;
              })()}
            </svg>
            {visibleMarkers.map((marker) => {
              return (
                <a
                  key={marker.id}
                  href={marker.to}
                  className={`world-map-marker world-map-marker-${marker.kind}${marker.id === hoverMarkerId ? ' is-active' : ''}`}
                  style={{ left: marker.px, top: marker.py, width: WORLD_MARKER_SCREEN_SIZE, height: WORLD_MARKER_SCREEN_SIZE, '--world-marker-scale': markerScale } as CSSProperties}
                  aria-label={marker.label}
                  aria-describedby={marker.id === hoverMarkerId && markerRouteLabels.length > 0 ? 'world-map-hover-routes' : undefined}
                  onMouseEnter={() => { setHoverMarkerId(marker.id); setHoverRoute(null); setHoverRoutes(marker.routeKeys ?? (marker.routeKey ? [marker.routeKey] : [])); }}
                  onMouseLeave={() => { setHoverMarkerId(null); setHoverRoutes([]); }}
                  onFocus={() => { setHoverMarkerId(marker.id); setHoverRoute(null); setHoverRoutes(marker.routeKeys ?? (marker.routeKey ? [marker.routeKey] : [])); }}
                  onBlur={() => { setHoverMarkerId(null); setHoverRoutes([]); }}
                >
                  <img src={marker.icon} alt="" draggable={false} />
                  <span className="world-map-marker-tooltip">{marker.label}</span>
                </a>
              );
            })}
          </div>
          {hoveredMarker && markerRouteLabels.length > 0 && (
            <MapRouteTooltip
              id="world-map-hover-routes"
              labels={markerRouteLabels}
              x={markerScreenX}
              y={markerScreenY}
              viewportWidth={viewportSize.width}
              viewportHeight={viewportSize.height}
            />
          )}
        </div>
      )}
    </section>
  );
}
