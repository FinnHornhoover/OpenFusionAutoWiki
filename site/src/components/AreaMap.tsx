import { gameToPxExtent, MINIMAP_PX, worldToPx } from '../data/minimapCoords';
import type { Area } from '../data/types';
import { buildAreaMapMarkers } from '../data/mapMarkers';

interface AreaMapProps {
  area: Area;
  build: string;
  size?: number;
}

export default function AreaMap({ area, build, size = 960 }: AreaMapProps) {
  const center = worldToPx(area.x + area.width / 2, area.y + area.height / 2);
  const extent = Math.max(area.width, area.height) / 2;
  const extentPx = gameToPxExtent(extent);
  if (extentPx <= 0) return null;

  const scale = size / (2 * extentPx);
  const imageSize = MINIMAP_PX * scale;
  const imageX = -(center.px * scale - size / 2);
  const imageY = -(center.py * scale - size / 2);
  const markers = buildAreaMapMarkers(area, build);

  const markerSize = 30;
  return (
    <svg
      className="area-map-overlay"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={area.fullName}
    >
      <image href="/minimap/all.png" x={imageX} y={imageY} width={imageSize} height={imageSize} className="map-base-image" />
      {markers.map((marker) => {
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
              y={top - markerSize / 2 - 8}
              textAnchor="middle"
            >
              {marker.label}
            </text>
          </a>
        );
      })}
    </svg>
  );
}
