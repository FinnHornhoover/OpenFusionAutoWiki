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
  paths?: MinimapPoint[][];
  fitContent?: boolean;
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
  paths = [],
  fitContent = false,
  icon,
  title,
}: MinimapProps) {
  let centerX = x;
  let centerY = y;
  let fittedExtent = extent;
  if (fitContent) {
    const content = [...(points.length ? points : [{ x, y }]), ...paths.flat()];
    const minX = Math.min(...content.map((point) => point.x));
    const maxX = Math.max(...content.map((point) => point.x));
    const minY = Math.min(...content.map((point) => point.y));
    const maxY = Math.max(...content.map((point) => point.y));
    centerX = (minX + maxX) / 2;
    centerY = (minY + maxY) / 2;
    fittedExtent = Math.max(extent, Math.max((maxX - minX) / 2, (maxY - minY) / 2) * 1.2);
  }
  const center = worldToPx(centerX, centerY);
  const extentPx = gameToPxExtent(fittedExtent);
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
          {paths.length > 0 && (
            <svg width={size} height={size} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden>
              {paths.map((path, index) => (
                <polyline
                  key={index}
                  className="world-boss-path is-active"
                  points={path.map((point) => {
                    const pos = worldToPx(point.x, point.y);
                    return `${size / 2 + (pos.px - center.px) * scale},${size / 2 + (pos.py - center.py) * scale}`;
                  }).join(' ')}
                />
              ))}
            </svg>
          )}
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
