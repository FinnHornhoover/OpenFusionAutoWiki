import type { Area, AreaTransport, Ref } from './types';

export type MapMarkerKind = 'npc' | 'vendor' | 'egg' | 'transport' | 'instance-warp';

export interface MapMarker {
  id: string;
  kind: MapMarkerKind;
  label: string;
  x: number;
  y: number;
  icon: string;
  to: string;
  routeKey?: string;
  routeKeys?: string[];
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

export function transportIcon(moveType: string): string {
  const normalized = moveType.toLowerCase();
  if (normalized.includes('scamper')) return '/minimap/mapicons/scamper_npc.png';
  if (normalized.includes('monkey')) return '/minimap/mapicons/monkey_skyway_npc.png';
  if (normalized.includes('slider')) return '/minimap/mapicons/world_icon.png';
  if (normalized.includes('woosh')) return '/minimap/mapicons/warp_npc.png';
  return '/minimap/mapicons/location_npc.png';
}


export function warpIcon(npcName = ''): string {
  return npcName.includes('Bank') ? '/minimap/mapicons/bank_npc.png' : '/minimap/mapicons/warp_npc.png';
}

export function missionWaypointIcon(taskType: string, hasNpc: boolean): string {
  if (taskType === 'EscortDefense') return '/minimap/mapicons/defense_npc.png';
  if (taskType === 'GoToLocation') return '/minimap/mapicons/location_npc.png';
  return hasNpc ? '/minimap/mapicons/mission_step_npc.png' : '/minimap/mapicons/location_npc.png';
}

function routeKey(route: AreaTransport): string {
  return `${route.moveType}:${route.routeId}:${route.routeName}`;
}

export function buildAreaMapMarkers(area: Area, build: string): MapMarker[] {
  const markers: MapMarker[] = [];
  const vendorIds = new Set(area.vendors.map((v) => String(v.ref.id)));

  for (const n of area.npcs) {
    if (vendorIds.has(String(n.ref.id)) || !n.showOnMap) continue;
    const points = n.points.length > 0 ? n.points : [{ x: n.x, y: n.y }];
    points.forEach((point, pointIndex) => {
      markers.push({
        id: `npc-${n.ref.id}-${pointIndex}`,
        kind: 'npc',
        label: n.ref.name,
        x: point.x,
        y: point.y,
        icon: n.mapIcon,
        to: refPath(build, n.ref),
      });
    });
  }

  for (const v of area.vendors) {
    if (!v.showOnMap) continue;
    const points = v.points.length > 0 ? v.points : [{ x: v.x, y: v.y }];
    points.forEach((point, pointIndex) => {
      markers.push({
        id: `vendor-${v.ref.id}-${pointIndex}`,
        kind: 'vendor',
        label: v.ref.name,
        x: point.x,
        y: point.y,
        icon: v.mapIcon,
        to: refPath(build, v.ref),
      });
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
    const npcName = w.npc?.name ?? '';
    markers.push({
      id: `instance-warp-${w.id}-${i}`,
      kind: 'instance-warp',
      label: npcName ? `${npcName}: ${w.instance.name}` : w.instance.name,
      x: w.entryLocation.x,
      y: w.entryLocation.y,
      icon: warpIcon(npcName),
      to: refPath(build, w.instance),
    });
  });

  return markers;
}

export function buildWorldMapMarkers(areas: Area[], build: string): MapMarker[] {
  const markers = areas.flatMap((area) => buildAreaMapMarkers(area, build).map((m) => ({ ...m, id: `${area.id}-${m.id}` })));
  const grouped = new Map<string, MapMarker>();
  const out: MapMarker[] = [];

  for (const marker of markers) {
    if (marker.kind !== 'transport' || !marker.routeKey) {
      out.push(marker);
      continue;
    }
    const groupKey = [marker.kind, marker.icon, marker.to, marker.x, marker.y].join(':');
    const existing = grouped.get(groupKey);
    if (existing) {
      existing.routeKeys = [...new Set([...(existing.routeKeys ?? []), marker.routeKey])];
      const routeCount = existing.routeKeys.length;
      const baseLabel = existing.label.replace(/ \([0-9]+ routes\)$/, '');
      existing.label = routeCount > 1 ? `${baseLabel} (${routeCount} routes)` : baseLabel;
    } else {
      const groupedMarker = { ...marker, routeKeys: [marker.routeKey] };
      grouped.set(groupKey, groupedMarker);
      out.push(groupedMarker);
    }
  }

  return out;
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
