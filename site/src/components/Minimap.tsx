import { gameToPxExtent, MINIMAP_PX, worldToPx } from '../data/minimapCoords';

interface MinimapPoint {
  x: number;
  y: number;
  icon?: string;
}

interface MinimapProps {
  /** Center of the viewport (world coords). */
  x: number;
  y: number;
  /** Optional rectangle overlay (game-unit width/height); draws a box instead of a pin. */
  width?: number;
  height?: number;
  /** Viewport size in CSS pixels (square). */
  size?: number;
  /** Game-units half-extent to show around the center. Default ~half a game tile. */
  extent?: number;
  /** Secondary world-coordinate points to draw inside this viewport. */
  points?: MinimapPoint[];
  /** Optional marker icon. Falls back to the generic pin. */
  icon?: string;
  /** Optional tooltip. */
  title?: string;
}

/**
 * A CSS-cropped slice of the world minimap, centered on (x, y).
 *   - default: shows a pin at the center
 *   - when `width` + `height` are supplied: draws a rectangle outline instead
 *     (used on Area pages to frame the whole area)
 */
export default function Minimap({
  x,
  y,
  width,
  height,
  size = 96,
  extent = 25600,
  points = [],
  icon,
  title,
}: MinimapProps) {
  const center = worldToPx(x, y);
  const extentPx = gameToPxExtent(extent);
  if (extentPx <= 0) return null;

  const scale = size / (2 * extentPx);
  const bgSize = MINIMAP_PX * scale;
  const bgX = -(center.px * scale - size / 2);
  const bgY = -(center.py * scale - size / 2);

  const hasBox = width != null && height != null && width > 0 && height > 0;
  const boxW = hasBox ? width! * (MINIMAP_PX / (51200 * 16)) * scale : 0;
  const boxH = hasBox ? height! * (MINIMAP_PX / (51200 * 16)) * scale : 0;
  const overlayPoints = hasBox
    ? []
    : points.map((point) => {
        const px = worldToPx(point.x, point.y);
        return {
          left: size / 2 + (px.px - center.px) * scale,
          top: size / 2 + (px.py - center.py) * scale,
          icon: point.icon ?? icon,
        };
      });
  const showMainPin = !hasBox && overlayPoints.length === 0;

  return (
    <span
      className="minimap"
      style={{
        width: size,
        height: size,
        backgroundImage: 'url(/minimap/all.png)',
        backgroundSize: `${bgSize}px ${bgSize}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
      }}
      title={title ?? `${x.toLocaleString()}, ${y.toLocaleString()}`}
      role="img"
      aria-label={title ?? `Map at ${x}, ${y}`}
    >
      {hasBox ? (
        <span
          className="minimap-bbox"
          style={{ width: boxW, height: boxH, marginLeft: -boxW / 2, marginTop: -boxH / 2 }}
          aria-hidden
        />
      ) : (
        <>
          {overlayPoints.map((point, i) => point.icon ? (
            <img
              key={i}
              className="minimap-marker-icon"
              src={point.icon}
              alt=""
              style={{ left: point.left, top: point.top }}
              aria-hidden
            />
          ) : (
            <span
              key={i}
              className="minimap-dot"
              style={{ left: point.left, top: point.top }}
              aria-hidden
            />
          ))}
          {showMainPin && (icon ? <img className="minimap-marker-icon" src={icon} alt="" aria-hidden /> : <span className="minimap-pin" aria-hidden />)}
        </>
      )}
    </span>
  );
}
