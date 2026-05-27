import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ErrorState from '../components/ErrorState';
import { MINIMAP_PX, worldToPx } from '../data/minimapCoords';
import { buildWorldMapMarkers, buildWorldTransportRoutes } from '../data/mapMarkers';
import type { Area } from '../data/types';
import { buildPageTitle, useBuildEntry } from '../data/useBuildEntry';
import { useDocumentTitle } from '../data/useDocumentTitle';

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
  const [hoverRoute, setHoverRoute] = useState<string | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  useDocumentTitle(entry ? `World Map · ${buildPageTitle(entry)}` : build ? `World Map · ${build}` : null);

  const markers = useMemo(() => build && areas.length > 0 ? buildWorldMapMarkers(areas, build) : [], [areas, build]);
  const routes = useMemo(() => buildWorldTransportRoutes(areas), [areas]);

  if (!build) return null;

  return (
    <section className="world-map-page">
      <p className="breadcrumb muted">
        <Link to={`/${build}`}>{entry ? buildPageTitle(entry) : build}</Link>
      </p>
      <h1>World Map</h1>
      {error && <ErrorState title="Couldn't load the map" message="Area data failed to load." detail={error} />}
      {loading && <p className="muted">Loading map...</p>}
      {!error && (
        <div
          className="world-map-viewport"
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
          <div className="world-map-canvas" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
            <img src="/minimap/all.png" alt="" className="world-map-image" draggable={false} />
            <svg className="world-map-routes" viewBox={`0 0 ${MINIMAP_PX} ${MINIMAP_PX}`} aria-hidden>
              {routes.map((route) => (
                <polyline
                  key={route.key}
                  className={`world-map-route world-map-route-${routeClass(route.moveType)} ${hoverRoute === route.key ? 'is-active' : ''}`}
                  points={route.points.map((p) => {
                    const pos = worldToPx(p.x, p.y);
                    return `${pos.px},${pos.py}`;
                  }).join(' ')}
                />
              ))}
            </svg>
            {markers.map((marker) => {
              const pos = worldToPx(marker.x, marker.y);
              return (
                <a
                  key={marker.id}
                  href={marker.to}
                  className={`world-map-marker world-map-marker-${marker.kind}`}
                  style={{ left: pos.px, top: pos.py }}
                  title={marker.label}
                  onMouseEnter={() => setHoverRoute(marker.routeKey ?? null)}
                  onMouseLeave={() => setHoverRoute(null)}
                >
                  <img src={marker.icon} alt="" draggable={false} />
                </a>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
