import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gameToPxExtent, MINIMAP_PX, worldToPx } from '../data/minimapCoords';
import type { Area } from '../data/types';
import { buildAreaMapMarkers, MAP_MARKER_KIND_LABELS, MAP_MARKER_KINDS, type MapMarkerKind } from '../data/mapMarkers';

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

export default function AreaMap({ area, build, size = 960 }: AreaMapProps) {
  const center = worldToPx(area.x + area.width / 2, area.y + area.height / 2);
  const extent = Math.max(area.width, area.height) / 2;
  const extentPx = gameToPxExtent(extent);
  const [zoom, setZoom] = useState(MIN_AREA_MAP_ZOOM);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: size, height: size });
  const [visibleKinds, setVisibleKinds] = useState<VisibleMarkerKinds>(() => defaultVisibleMarkerKinds());
  const [renderedWidth, setRenderedWidth] = useState(size);
  const mapRef = useRef<SVGSVGElement | null>(null);
  const activePointers = useRef(new Map<number, PointerPoint>());
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; width: number; height: number } | null>(null);
  const pinch = useRef<{ startDistance: number; startZoom: number; startViewBox: typeof viewBox; anchorX: number; anchorY: number } | null>(null);

  useEffect(() => {
    setZoom(MIN_AREA_MAP_ZOOM);
    setViewBox({ x: 0, y: 0, width: size, height: size });
  }, [area.id, size]);

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

  function toggleMarkerKind(kind: MapMarkerKind) {
    setVisibleKinds((prev) => ({ ...prev, [kind]: !prev[kind] }));
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
      <svg
      ref={mapRef}
      className="area-map-overlay"
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      role="img"
      aria-label={area.fullName}
      onPointerDown={(event) => {
        if ((event.target as Element).closest('a')) return;
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
      onPointerUp={(event) => {
        activePointers.current.delete(event.pointerId);
        if (drag.current?.pointerId === event.pointerId) drag.current = null;
        pinch.current = null;
      }}
      onPointerCancel={(event) => {
        activePointers.current.delete(event.pointerId);
        if (drag.current?.pointerId === event.pointerId) drag.current = null;
        pinch.current = null;
      }}
    >
      <image href="/minimap/all.png" x={imageX} y={imageY} width={imageSize} height={imageSize} className="map-base-image" />
      {visibleMarkers.map((marker) => {
        const pos = worldToPx(marker.x, marker.y);
        const left = size / 2 + (pos.px - center.px) * scale;
        const top = size / 2 + (pos.py - center.py) * scale;
        return (
          <a key={marker.id} href={marker.to} className={`area-map-marker area-map-marker-${marker.kind}`} aria-label={marker.label}>
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
    </div>
  );
}
