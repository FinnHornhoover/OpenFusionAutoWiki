import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gameToPxExtent, MINIMAP_PX, worldToPx } from '../data/minimapCoords';
import type { Area } from '../data/types';
import MapRouteTooltip from './MapRouteTooltip';
import { buildAreaMapMarkers, buildWorldBossPaths, buildAreaOutgoingRoutes, MAP_MARKER_KIND_LABELS, MAP_MARKER_KINDS, type MapMarkerKind } from '../data/mapMarkers';

interface AreaMapProps {
  area: Area;
  build: string;
  size?: number;
}

const MIN_AREA_MAP_ZOOM = 1;
const MAX_AREA_MAP_ZOOM = 12;

type VisibleMarkerKinds = Record<MapMarkerKind, boolean>;

function defaultVisibleMarkerKinds(): VisibleMarkerKinds {
  return Object.fromEntries(MAP_MARKER_KINDS.map((kind) => [kind, kind !== 'monster'])) as VisibleMarkerKinds;
}

function clampZoom(value: number): number {
  return Math.min(MAX_AREA_MAP_ZOOM, Math.max(MIN_AREA_MAP_ZOOM, value));
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

/** Last visible point along a route, including destinations outside the viewport. */
function routeLabelPoint(points: PointerPoint[], bounds: { x: number; y: number; width: number; height: number }): PointerPoint | null {
  let last: PointerPoint | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let enter = 0;
    let exit = 1;
    const edges = [[-dx, a.x - bounds.x], [dx, bounds.x + bounds.width - a.x], [-dy, a.y - bounds.y], [dy, bounds.y + bounds.height - a.y]];
    for (const [direction, offset] of edges) {
      if (direction === 0) {
        if (offset < 0) { exit = -1; break; }
      } else if (direction < 0) enter = Math.max(enter, offset / direction);
      else exit = Math.min(exit, offset / direction);
    }
    if (enter <= exit) last = { x: a.x + exit * dx, y: a.y + exit * dy };
  }
  return last;
}

export default function AreaMap({ area, build, size = 960 }: AreaMapProps) {
  const center = worldToPx(area.x + area.width / 2, area.y + area.height / 2);
  const extent = Math.max(area.width, area.height) / 2;
  const extentPx = gameToPxExtent(extent);
  const [zoom, setZoom] = useState(MIN_AREA_MAP_ZOOM);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: size, height: size });
  const [visibleKinds, setVisibleKinds] = useState<VisibleMarkerKinds>(() => defaultVisibleMarkerKinds());
  const [hoverPaths, setHoverPaths] = useState<string[]>([]);
  const [hoverMarkerId, setHoverMarkerId] = useState<string | null>(null);
  const [hoverRoutePoint, setHoverRoutePoint] = useState<PointerPoint | null>(null);
  const [hoverBossPathId, setHoverBossPathId] = useState<string | null>(null);
  const [allAreas, setAllAreas] = useState<Area[]>([]);
  const [renderedWidth, setRenderedWidth] = useState(size);
  const mapRef = useRef<SVGSVGElement | null>(null);
  const activePointers = useRef(new Map<number, PointerPoint>());
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; width: number; height: number } | null>(null);
  const pinch = useRef<{ startDistance: number; startZoom: number; startViewBox: typeof viewBox; anchorX: number; anchorY: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setAllAreas([]);
    fetch(`/data/${build}/areas/0.json`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((bucket: Record<string, Area>) => setAllAreas(Object.values(bucket)))
      .catch(() => {});
    return () => controller.abort();
  }, [build]);

  useEffect(() => {
    setZoom(MIN_AREA_MAP_ZOOM);
    setViewBox({ x: 0, y: 0, width: size, height: size });
    setHoverPaths([]);
    setHoverMarkerId(null);
    setHoverBossPathId(null);
    setHoverRoutePoint(null);
  }, [area.id, size]);

  useEffect(() => () => {
    activePointers.current.clear();
    drag.current = null;
    pinch.current = null;
  }, []);

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const map = mapRef.current;
    if (!map) return;
    const rect = map.getBoundingClientRect();
    const nextZoom = clampZoom(zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2));
    const nextWidth = size / nextZoom;
    const nextHeight = size / nextZoom;
    const relativeX = (event.clientX - rect.left) / rect.width;
    const relativeY = (event.clientY - rect.top) / rect.height;
    const pointerX = viewBox.x + relativeX * viewBox.width;
    const pointerY = viewBox.y + relativeY * viewBox.height;
    setZoom(nextZoom);
    setViewBox({
      x: pointerX - relativeX * nextWidth,
      y: pointerY - relativeY * nextHeight,
      width: nextWidth,
      height: nextHeight,
    });
  }, [size, viewBox, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.addEventListener('wheel', handleWheel, { passive: false });
    return () => map.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateSize = () => {
      const width = map.getBoundingClientRect().width;
      setRenderedWidth(width > 0 ? width : size);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(map);
    return () => observer.disconnect();
  }, [size]);

  const markers = useMemo(() => buildAreaMapMarkers(area, build), [area, build]);
  const visibleMarkers = useMemo(() => markers.filter((marker) => visibleKinds[marker.kind]), [markers, visibleKinds]);
  const bossPaths = useMemo(() => visibleKinds['world-boss'] ? buildWorldBossPaths([area]) : [], [area, visibleKinds]);
  const outgoingRoutes = useMemo(() => buildAreaOutgoingRoutes(area, allAreas.length ? allAreas : [area]), [area, allAreas]);
  const visibleRoutes = outgoingRoutes.filter((route) => visibleKinds[route.kind]);
  const hoveredMarker = visibleMarkers.find((marker) => marker.id === hoverMarkerId);
  const markerRouteLabels = hoveredMarker
    ? [...new Set(visibleRoutes.filter((route) => route.routeKeys.some((key) => hoverPaths.includes(key))).flatMap((route) => route.markerLabels ?? [route.label]))]
    : [];

  if (extentPx <= 0) return null;

  const scale = size / (2 * extentPx);
  const imageSize = MINIMAP_PX * scale;
  const imageX = -(center.px * scale - size / 2);
  const imageY = -(center.py * scale - size / 2);
  const screenUnit = viewBox.width / Math.max(1, renderedWidth);
  const markerSize = 30 * screenUnit;
  const tooltipOffset = 8 * screenUnit;
  const tooltipFontSize = 15 * screenUnit;
  const tooltipStrokeWidth = 5 * screenUnit;
  const hoveredMarkerPosition = hoveredMarker ? worldToPx(hoveredMarker.x, hoveredMarker.y) : null;
  const markerScreenX = hoveredMarkerPosition ? (size / 2 + (hoveredMarkerPosition.px - center.px) * scale - viewBox.x) / screenUnit : 0;
  const markerScreenY = hoveredMarkerPosition ? (size / 2 + (hoveredMarkerPosition.py - center.py) * scale - viewBox.y) / screenUnit : 0;
  const routeTooltipId = `area-map-hover-routes-${area.id}`;
  const hoveredBossPath = bossPaths.find((path) => path.id === hoverBossPathId);

  function clearPointer(pointerId: number) {
    activePointers.current.delete(pointerId);
    if (drag.current?.pointerId === pointerId) drag.current = null;
    pinch.current = null;
  }


  function toggleMarkerKind(kind: MapMarkerKind) {
    setVisibleKinds((prev) => ({ ...prev, [kind]: !prev[kind] }));
    setHoverPaths([]);
    setHoverMarkerId(null);
    setHoverBossPathId(null);
  }

  function hoverBossPath(pathId: string) {
    const boss = markers.find((marker) => marker.kind === 'world-boss' && marker.routeKeys?.includes(pathId));
    setHoverMarkerId(null);
    setHoverBossPathId(pathId);
    setHoverPaths(boss?.routeKeys ?? [pathId]);
    setHoverRoutePoint({ x: viewBox.x + viewBox.width / 2, y: viewBox.y + 35 * screenUnit });
  }

  return (
    <div className="map-panel">
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
      <div className="area-map-viewport">
      <svg
      ref={mapRef}
      className="area-map-overlay"
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      role="img"
      aria-label={area.fullName}
      onPointerDown={(event) => {
        if ((event.target as Element).closest('a')) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (activePointers.current.size >= 2) {
          const rect = event.currentTarget.getBoundingClientRect();
          const [first, second] = [...activePointers.current.values()];
          const mid = midpoint(first, second);
          const relativeX = (mid.x - rect.left) / rect.width;
          const relativeY = (mid.y - rect.top) / rect.height;
          pinch.current = {
            startDistance: distance(first, second),
            startZoom: zoom,
            startViewBox: viewBox,
            anchorX: viewBox.x + relativeX * viewBox.width,
            anchorY: viewBox.y + relativeY * viewBox.height,
          };
          drag.current = null;
          return;
        }

        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: viewBox.x,
          originY: viewBox.y,
          width: viewBox.width,
          height: viewBox.height,
        };
      }}
      onPointerMove={(event) => {
        if (!activePointers.current.has(event.pointerId)) return;
        event.preventDefault();
        activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (pinch.current && activePointers.current.size >= 2) {
          const rect = event.currentTarget.getBoundingClientRect();
          const [first, second] = [...activePointers.current.values()];
          const mid = midpoint(first, second);
          const ratio = distance(first, second) / Math.max(1, pinch.current.startDistance);
          const nextZoom = clampZoom(pinch.current.startZoom * ratio);
          const nextWidth = size / nextZoom;
          const nextHeight = size / nextZoom;
          const relativeX = (mid.x - rect.left) / rect.width;
          const relativeY = (mid.y - rect.top) / rect.height;
          setZoom(nextZoom);
          setViewBox({
            x: pinch.current.anchorX - relativeX * nextWidth,
            y: pinch.current.anchorY - relativeY * nextHeight,
            width: nextWidth,
            height: nextHeight,
          });
          return;
        }

        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setViewBox({
          x: active.originX - (event.clientX - active.startX) * active.width / rect.width,
          y: active.originY - (event.clientY - active.startY) * active.height / rect.height,
          width: active.width,
          height: active.height,
        });
      }}
      onPointerUp={(event) => { clearPointer(event.pointerId); }}
      onPointerCancel={(event) => { clearPointer(event.pointerId); }}
      onLostPointerCapture={(event) => { clearPointer(event.pointerId); }}
      onPointerLeave={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) clearPointer(event.pointerId); }}
    >
      <image href="/minimap/all.png" x={imageX} y={imageY} width={imageSize} height={imageSize} className="map-base-image" />
      {bossPaths.map((path) => {
        const points = path.points.map((point) => {
            const pos = worldToPx(point.x, point.y);
            return `${size / 2 + (pos.px - center.px) * scale},${size / 2 + (pos.py - center.py) * scale}`;
        }).join(' ');
        return <g key={path.id}>
          <polyline className={`world-boss-path${hoverPaths.includes(path.id) ? ' is-active' : ''}`}
            vectorEffect="non-scaling-stroke" points={points} />
          <polyline className="map-route-hitbox" vectorEffect="non-scaling-stroke" points={points}
            tabIndex={0} role="img" aria-label={path.label}
            onMouseEnter={() => hoverBossPath(path.id)}
            onMouseMove={(event) => {
              if (activePointers.current.size) return;
              const rect = mapRef.current?.getBoundingClientRect();
              if (rect) setHoverRoutePoint({ x: viewBox.x + (event.clientX - rect.left) / rect.width * viewBox.width, y: viewBox.y + (event.clientY - rect.top) / rect.height * viewBox.height });
            }}
            onMouseLeave={() => { setHoverBossPathId(null); setHoverRoutePoint(null); setHoverPaths([]); }}
            onFocus={() => hoverBossPath(path.id)}
            onBlur={() => { setHoverBossPathId(null); setHoverRoutePoint(null); setHoverPaths([]); }}
          />
        </g>;
      })}
      {visibleRoutes.map((path) => {
        const points = path.points.map((point) => {
          const pos = worldToPx(point.x, point.y);
          return { x: size / 2 + (pos.px - center.px) * scale, y: size / 2 + (pos.py - center.py) * scale };
        });
        const active = path.routeKeys.some((key) => hoverPaths.includes(key));
        const tip = active && hoverRoutePoint ? hoverRoutePoint : routeLabelPoint(points, viewBox);
        const inset = 12 * screenUnit;
        const labelX = tip ? Math.max(viewBox.x + inset, Math.min(viewBox.x + viewBox.width - inset, tip.x)) : 0;
        const labelY = tip ? Math.max(viewBox.y + 20 * screenUnit, Math.min(viewBox.y + viewBox.height - inset, tip.y - inset)) : 0;
        const color = path.moveType.toLowerCase().includes('monkey') ? 'monkey-skyway' : path.moveType.toLowerCase();
        return (
          <g key={path.key} className={`area-map-outgoing-route${active ? ' is-active' : ''}`}>
            <polyline
              className={`world-map-route world-map-route-${color}${active ? ' is-active' : ''}`}
              vectorEffect="non-scaling-stroke"
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
              style={{ pointerEvents: 'none' }}
            />
            <polyline
              className="map-route-hitbox"
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
              vectorEffect="non-scaling-stroke"
              tabIndex={0}
              role="img"
              aria-label={path.label}
              onMouseEnter={() => { setHoverBossPathId(null); setHoverMarkerId(null); setHoverPaths(path.routeKeys); }}
              onMouseMove={(event) => {
                if (activePointers.current.size) return;
                const rect = mapRef.current?.getBoundingClientRect();
                if (rect) setHoverRoutePoint({ x: viewBox.x + (event.clientX - rect.left) / rect.width * viewBox.width, y: viewBox.y + (event.clientY - rect.top) / rect.height * viewBox.height });
              }}
              onMouseLeave={() => { setHoverPaths([]); setHoverRoutePoint(null); }}
              onFocus={() => { setHoverBossPathId(null); setHoverMarkerId(null); setHoverPaths(path.routeKeys); setHoverRoutePoint(null); }}
              onBlur={() => { setHoverPaths([]); setHoverRoutePoint(null); }}
            />
            {active && !hoveredMarker && tip && <text
              className="map-route-label"
              x={labelX}
              y={labelY}
              textAnchor={labelX > viewBox.x + viewBox.width / 2 ? 'end' : 'start'}
              style={{ fontSize: 13 * screenUnit, strokeWidth: 4 * screenUnit }}
            >{path.label}</text>}
          </g>
        );
      })}
      {hoveredBossPath && hoverRoutePoint && <text
        className="map-route-label"
        x={Math.max(viewBox.x + 12 * screenUnit, Math.min(viewBox.x + viewBox.width - 12 * screenUnit, hoverRoutePoint.x))}
        y={Math.max(viewBox.y + 22 * screenUnit, Math.min(viewBox.y + viewBox.height - 12 * screenUnit, hoverRoutePoint.y - 12 * screenUnit))}
        textAnchor={hoverRoutePoint.x > viewBox.x + viewBox.width / 2 ? 'end' : 'start'}
        style={{ fontSize: 13 * screenUnit, strokeWidth: 4 * screenUnit, opacity: 1 }}
      >{hoveredBossPath.label}</text>}
      {visibleMarkers.map((marker) => {
        const pos = worldToPx(marker.x, marker.y);
        const left = size / 2 + (pos.px - center.px) * scale;
        const top = size / 2 + (pos.py - center.py) * scale;
        return (
          <a
            key={marker.id}
            href={marker.to}
            className={`area-map-marker area-map-marker-${marker.kind}${marker.id === hoverMarkerId ? ' is-active' : ''}`}
            aria-label={marker.label}
            aria-describedby={marker.id === hoverMarkerId && markerRouteLabels.length > 0 ? routeTooltipId : undefined}
            onMouseEnter={() => { setHoverBossPathId(null); setHoverMarkerId(marker.id); setHoverRoutePoint(null); setHoverPaths(marker.routeKeys ?? (marker.routeKey ? [marker.routeKey] : [])); }}
            onMouseLeave={() => { setHoverMarkerId(null); setHoverPaths([]); }}
            onFocus={() => { setHoverBossPathId(null); setHoverMarkerId(marker.id); setHoverRoutePoint(null); setHoverPaths(marker.routeKeys ?? (marker.routeKey ? [marker.routeKey] : [])); }}
            onBlur={() => { setHoverMarkerId(null); setHoverPaths([]); }}
          >
            <image
              href={marker.icon}
              x={left - markerSize / 2}
              y={top - markerSize / 2}
              width={markerSize}
              height={markerSize}
              className="area-map-marker-image"
            />
            <text
              className="area-map-marker-tooltip"
              x={left}
              y={top - markerSize / 2 - tooltipOffset}
              textAnchor="middle"
              style={{ fontSize: tooltipFontSize, strokeWidth: tooltipStrokeWidth }}
            >
              {marker.label}
            </text>
          </a>
        );
      })}
      </svg>
      {hoveredMarker && markerRouteLabels.length > 0 && <MapRouteTooltip
        id={routeTooltipId}
        labels={markerRouteLabels}
        x={markerScreenX}
        y={markerScreenY}
        viewportWidth={renderedWidth}
        viewportHeight={renderedWidth}
      />}
      </div>
    </div>
  );
}
