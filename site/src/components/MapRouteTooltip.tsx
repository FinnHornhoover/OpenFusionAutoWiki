import { useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icon';

interface MapRouteTooltipProps {
  id: string;
  labels: string[];
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  icon?: string;
  itemIcon?: boolean;
}

export default function MapRouteTooltip({ id, labels, x, y, viewportWidth, viewportHeight, icon, itemIcon }: MapRouteTooltipProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const labelKey = labels.join('\n');
  useLayoutEffect(() => {
    const tooltip = ref.current;
    if (!tooltip) return;
    const measure = () => setSize({ width: tooltip.offsetWidth, height: tooltip.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tooltip);
    return () => observer.disconnect();
  }, [labelKey, icon, itemIcon]);

  if (!labels.length) return null;
  const left = Math.max(12, Math.min(viewportWidth - size.width - 12,
    x + 28 + size.width <= viewportWidth - 12 ? x + 28 : x - size.width - 28));
  const top = Math.max(12, Math.min(viewportHeight - size.height - 12, y + 24));
  return (
    <div ref={ref} id={id} className="map-route-tooltip" role="tooltip"
      style={{ left, top, maxHeight: Math.max(1, viewportHeight - 24) }}>
      <div className="map-tooltip-content">
        {icon && <Icon src={icon} alt="" size={itemIcon ? 64 : 32} className={itemIcon ? 'icon-item' : undefined} />}
        <div>{labels.map((label) => <div key={label}>{label}</div>)}</div>
      </div>
    </div>
  );
}
