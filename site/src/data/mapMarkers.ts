import type { Area, AreaTransport, Ref } from './types';

export type MapMarkerKind = 'mission' | 'npc' | 'vendor' | 'egg' | 'transport' | 'instance-warp';

export interface MapMarker {
  id: string;
  kind: MapMarkerKind;
  label: string;
  x: number;
  y: number;
  icon: string;
  to: string;
  routeKey?: string;
}

export interface MapRouteLine {
  key: string;
  label: string;
  moveType: string;
  points: Array<{ x: number; y: number }>;
}

const ROUTE_FOR: Record<Ref['type'], string> = {
  mission: 'missions',
  npc: 'npcs',
  item: 'items',
  monster: 'monsters',
  nano: 'nanos',
  instance: 'instances',
  'infected-zone': 'infected-zones',
  code: 'codes',
};

function refPath(build: string, ref: Ref): string {
  return `/${build}/${ROUTE_FOR[ref.type]}/${ref.id}`;
}

function transportIcon(moveType: string): string {
  const normalized = moveType.toLowerCase();
  if (normalized.includes('scamper')) return '/minimap/mapicons/scamper_npc.png';
  if (normalized.includes('monkey')) return '/minimap/mapicons/monkey_skyway_npc.png';
  if (normalized.includes('slider')) return '/minimap/mapicons/location_npc.png';
  if (normalized.includes('woosh')) return '/minimap/mapicons/warp_npc.png';
  return '/minimap/mapicons/location_npc.png';
}

function routeKey(route: AreaTransport): string {
  return `${route.moveType}:${route.routeId}:${route.routeName}`;
}

export function buildAreaMapMarkers(area: Area, build: string): MapMarker[] {
  const markers: MapMarker[] = [];
  const vendorIds = new Set(area.vendors.map((v) => String(v.ref.id)));

  for (const m of area.missionStarts ?? []) {
    markers.push({
      id: `mission-${m.mission.id}-${m.npc.id}`,
      kind: 'mission',
      label: `${m.mission.name} from ${m.npc.name}`,
      x: m.x,
      y: m.y,
      icon: '/minimap/mapicons/mission_start_npc.png',
      to: refPath(build, m.mission),
    });
  }

  for (const n of area.npcs) {
    if (vendorIds.has(String(n.ref.id))) continue;
    markers.push({
      id: `npc-${n.ref.id}`,
      kind: 'npc',
      label: n.ref.name,
      x: n.x,
      y: n.y,
      icon: '/minimap/mapicons/generic_npc.png',
      to: refPath(build, n.ref),
    });
  }

  for (const v of area.vendors) {
    markers.push({
      id: `vendor-${v.ref.id}`,
      kind: 'vendor',
      label: v.ref.name,
      x: v.x,
      y: v.y,
      icon: '/minimap/mapicons/other_vendor_npc.png',
      to: refPath(build, v.ref),
    });
  }

  area.eggs.forEach((e, i) => {
    markers.push({
      id: `egg-${i}`,
      kind: 'egg',
      label: e.crateItem ? `${e.typeName}: ${e.crateItem.name}` : e.typeName || 'Egg',
      x: e.x,
      y: e.y,
      icon: '/minimap/mapicons/world_egg_shiny_npc.png',
      to: e.crateItem ? refPath(build, e.crateItem) : `/${build}/areas/${area.id}`,
    });
  });

  area.transportation.forEach((t, routeIndex) => {
    const key = routeKey(t);
    t.stops.filter((s) => s.isHere).forEach((s, stopIndex) => {
      markers.push({
        id: `transport-${routeIndex}-${stopIndex}`,
        kind: 'transport',
        label: t.routeName,
        x: s.x,
        y: s.y,
        icon: transportIcon(t.moveType),
        to: t.startNpc ? refPath(build, t.startNpc) : `/${build}/areas/${area.id}`,
        routeKey: key,
      });
    });
  });

  area.instanceWarps.forEach((w, i) => {
    if (!w.entryLocation) return;
    markers.push({
      id: `instance-warp-${w.id}-${i}`,
      kind: 'instance-warp',
      label: w.instance.name,
      x: w.entryLocation.x,
      y: w.entryLocation.y,
      icon: '/minimap/mapicons/warp_npc.png',
      to: refPath(build, w.instance),
    });
  });

  return markers;
}

export function buildWorldMapMarkers(areas: Area[], build: string): MapMarker[] {
  return areas.flatMap((area) => buildAreaMapMarkers(area, build).map((m) => ({ ...m, id: `${area.id}-${m.id}` })));
}

export function buildWorldTransportRoutes(areas: Area[]): MapRouteLine[] {
  const routes = new Map<string, MapRouteLine>();
  for (const area of areas) {
    for (const route of area.transportation) {
      const key = routeKey(route);
      if (routes.has(key)) continue;
      const points = (route.routePoints && route.routePoints.length > 0 ? route.routePoints : route.stops)
        .map((p) => ({ x: p.x, y: p.y }))
        .filter((p) => p.x !== 0 || p.y !== 0);
      if (points.length < 2) continue;
      routes.set(key, { key, label: route.routeName, moveType: route.moveType, points });
    }
  }
  return [...routes.values()];
}
