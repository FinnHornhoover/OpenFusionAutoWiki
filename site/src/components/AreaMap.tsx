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

export default function AreaMap({ area, build, size = 960 }: AreaMapProps) {
  const center = worldToPx(area.x + area.width / 2, area.y + area.height / 2);
  const extent = Math.max(area.width, area.height) / 2;
  const extentPx = gameToPxExtent(extent);
  const [zoom, setZoom] = useState(MIN_AREA_MAP_ZOOM);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: size, height: size });
  const [visibleKinds, setVisibleKinds] = useState<VisibleMarkerKinds>(() => defaultVisibleMarkerKinds());
  const [renderedWidth, setRenderedWidth] = useState(size);
  const mapRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; width: number; height: number } | null>(null);

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
        if (drag.current?.pointerId === event.pointerId) drag.current = null;
      }}
      onPointerCancel={() => { drag.current = null; }}
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
