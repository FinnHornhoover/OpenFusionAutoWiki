import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ErrorState from '../components/ErrorState';
import { MINIMAP_PX, worldToPx } from '../data/minimapCoords';
import { buildWorldMapMarkers, buildWorldTransportRoutes, MAP_MARKER_KIND_LABELS, MAP_MARKER_KINDS, type MapMarker, type MapMarkerKind } from '../data/mapMarkers';
import type { Area } from '../data/types';
import { buildPageTitle, useBuildEntry } from '../data/useBuildEntry';
import { useDocumentTitle } from '../data/useDocumentTitle';

const WORLD_MARKER_SCREEN_SIZE = 32;
const WORLD_MARKER_CULL_BUFFER = WORLD_MARKER_SCREEN_SIZE * 2;
const WORLD_ROUTE_SCREEN_WIDTH = 2;
const WORLD_ROUTE_ACTIVE_SCREEN_WIDTH = 4;
const MIN_WORLD_MAP_ZOOM = 1.5;
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
};

function routeClass(moveType: string): string {
  const key = moveType.toLowerCase().replace(/[^a-z]/g, '');
  return ROUTE_CLASS[key] ?? 'other';
}

function clampZoom(value: number): number {
  return Math.min(MAX_WORLD_MAP_ZOOM, Math.max(MIN_WORLD_MAP_ZOOM, value));
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
  const [zoom, setZoom] = useState(MIN_WORLD_MAP_ZOOM);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [hoverRoutes, setHoverRoutes] = useState<string[]>([]);
  const [visibleKinds, setVisibleKinds] = useState<VisibleMarkerKinds>(() => defaultVisibleMarkerKinds());
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  useDocumentTitle(entry ? `World Map · ${buildPageTitle(entry)}` : build ? `World Map · ${build}` : null);

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
  const routes = useMemo(() => visibleKinds.transport ? buildWorldTransportRoutes(areas) : [], [areas, visibleKinds.transport]);
  const markerScale = 1 / zoom;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const applyZoom = () => {
      const rect = viewport.getBoundingClientRect();
      const nextZoom = MIN_WORLD_MAP_ZOOM;
      setViewportSize({ width: rect.width, height: rect.height });
      setZoom(nextZoom);
      setOffset({
        x: rect.width / 2 - (MINIMAP_PX / 2) * nextZoom,
        y: rect.height / 2 - (MINIMAP_PX / 2) * nextZoom,
      });
    };
    applyZoom();
    const observer = new ResizeObserver(applyZoom);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  function toggleMarkerKind(kind: MapMarkerKind) {
    setVisibleKinds((prev) => ({ ...prev, [kind]: !prev[kind] }));
    if (kind === 'transport' && visibleKinds.transport) setHoverRoutes([]);
  }

  if (!build) return null;

  return (
    <section className="world-map-page">
      <p className="breadcrumb muted">
        <Link to={`/${build}`}>{entry ? buildPageTitle(entry) : build}</Link>
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
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
          }}
          onPointerMove={(event) => {
            const active = drag.current;
            if (!active || active.pointerId !== event.pointerId) return;
            setOffset({ x: active.originX + event.clientX - active.startX, y: active.originY + event.clientY - active.startY });
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointerId === event.pointerId) drag.current = null;
          }}
          onPointerCancel={() => { drag.current = null; }}
        >
          <div
            className="world-map-canvas"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              '--world-map-route-width': `${WORLD_ROUTE_SCREEN_WIDTH / zoom}px`,
              '--world-map-route-active-width': `${WORLD_ROUTE_ACTIVE_SCREEN_WIDTH / zoom}px`,
            } as CSSProperties}
          >
            <img src="/minimap/all.png" alt="" className="world-map-image" draggable={false} />
            <svg className="world-map-routes" viewBox={`0 0 ${MINIMAP_PX} ${MINIMAP_PX}`} aria-hidden>
              {routes.map((route) => (
                <polyline
                  key={route.key}
                  className={`world-map-route world-map-route-${routeClass(route.moveType)} ${hoverRoutes.includes(route.key) ? 'is-active' : ''}`}
                  points={route.points.map((p) => {
                    const pos = worldToPx(p.x, p.y);
                    return `${pos.px},${pos.py}`;
                  }).join(' ')}
                />
              ))}
            </svg>
            {visibleMarkers.map((marker) => {
              return (
                <a
                  key={marker.id}
                  href={marker.to}
                  className={`world-map-marker world-map-marker-${marker.kind}`}
                  style={{ left: marker.px, top: marker.py, width: WORLD_MARKER_SCREEN_SIZE, height: WORLD_MARKER_SCREEN_SIZE, '--world-marker-scale': markerScale } as CSSProperties}
                  aria-label={marker.label}
                  onMouseEnter={() => setHoverRoutes(marker.routeKeys ?? (marker.routeKey ? [marker.routeKey] : []))}
                  onMouseLeave={() => setHoverRoutes([])}
                  onFocus={() => setHoverRoutes(marker.routeKeys ?? (marker.routeKey ? [marker.routeKey] : []))}
                  onBlur={() => setHoverRoutes([])}
                >
                  <img src={marker.icon} alt="" draggable={false} />
                  <span className="world-map-marker-tooltip">{marker.label}</span>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
