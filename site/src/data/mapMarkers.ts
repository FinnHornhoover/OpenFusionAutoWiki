import type { Area, AreaTransport, AreaInstanceWarp, Ref } from './types';

export type MapMarkerKind = 'npc' | 'vendor' | 'monster' | 'world-boss' | 'egg' | 'transport' | 'instance-warp';

export const MAP_MARKER_KIND_LABELS: Record<MapMarkerKind, string> = {
  npc: 'NPCs',
  vendor: 'Vendors',
  monster: 'Monsters',
  'world-boss': 'Bosses',
  egg: 'Eggs',
  transport: 'Transport',
  'instance-warp': 'Warps',
};

export const MAP_MARKER_KINDS = Object.keys(MAP_MARKER_KIND_LABELS) as MapMarkerKind[];

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
  hoverIcon?: string;
  hoverItemIcon?: boolean;
}

export interface MapRouteLine {
  key: string;
  routeKeys: string[];
  label: string;
  moveType: string;
  points: Array<{ x: number; y: number }>;
  bidirectional?: boolean;
  markerLabels?: string[];
}

function bossPathKey(mobId: Ref['id'], points: Array<{ x: number; y: number }>): string {
  return `boss-${mobId}:${points.map((p) => `${p.x},${p.y}`).join(';')}`;
}

/** Authored patrols only: never connect independent spawn locations. */
export function buildWorldBossPaths(areas: Area[]): Array<{ id: string; label: string; points: Array<{ x: number; y: number }> }> {
  const paths = new Map<string, { id: string; label: string; points: Array<{ x: number; y: number }> }>();
  for (const area of areas) {
    for (const mob of area.mobs) {
      if (!mob.worldBoss) continue;
      const spawns = mob.points.length > 0 ? mob.points : [mob];
      if (!spawns.some((point) => (point.instanceID ?? mob.instanceID) === 0)) continue;
      for (const points of mob.paths ?? []) {
        if (points.length < 2) continue;
        const id = bossPathKey(mob.ref.id, points);
        paths.set(id, { id, label: mob.ref.name, points });
      }
    }
  }
  return [...paths.values()];
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
  'item-set': 'item-sets',
};

function refPath(build: string, ref: Ref): string {
  return `/${build}/${ROUTE_FOR[ref.type]}/${ref.id}`;
}

export function transportIcon(moveType: string, npcName = ''): string {
  const normalized = moveType.toLowerCase();
  if (normalized.includes('scamper')) return npcName.includes('Woosh') ? '/minimap/mapicons/woosh_npc.png' : '/minimap/mapicons/scamper_npc.png';
  if (normalized.includes('monkey')) return '/minimap/mapicons/monkey_skyway_npc.png';
  if (normalized.includes('slider')) return '/minimap/mapicons/world_icon.png';
  if (normalized.includes('woosh')) return '/minimap/mapicons/woosh_npc.png';
  return '/minimap/mapicons/location_npc.png';
}


export function warpIcon(npcName = ''): string {
  return npcName.includes('Bank') ? '/minimap/mapicons/bank_npc.png' : '/minimap/mapicons/warp_npc.png';
}

function warpLabel(npcName: string, instanceName: string): string {
  const npc = npcName.trim();
  const instance = instanceName.trim();
  if (!npc) return instance;
  const normalizedNpc = npc.toLowerCase();
  const normalizedInstance = instance.toLowerCase();
  if (!instance || normalizedInstance === normalizedNpc || normalizedInstance === 'unknown warp (please fill in)') return npc;
  return npc + ': ' + instance;
}

export function missionWaypointIcon(taskType: string, hasNpc: boolean): string {
  if (taskType === 'EscortDefense') return '/minimap/mapicons/defense_npc.png';
  if (taskType === 'GoToLocation' || taskType === 'Defeat') return '/minimap/mapicons/location_npc.png';
  return hasNpc ? '/minimap/mapicons/mission_step_npc.png' : '/minimap/mapicons/location_npc.png';
}

function routeKey(route: AreaTransport): string {
  return `${route.moveType}:${route.routeId}:${route.routeName}`;
}

export function warpDestinationPath(build: string, warp: AreaInstanceWarp): string {
  if (warp.instanceID !== 0) return refPath(build, warp.instance);
  return warp.exitLocation?.areaId
    ? `/${build}/areas/${warp.exitLocation.areaId}`
    : `/${build}/map`;
}

function mapWarpKey(warp: AreaInstanceWarp): string | null {
  if (warp.npcCategory !== 'Warp') return null;
  const from = warp.entryLocation;
  const to = warp.exitLocation;
  if (!from || !to) return null;
  if (from.instanceID !== 0 && !from.infectedZone) return null;
  if (to.instanceID !== 0 && !to.infectedZone) return null;
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return null;
  if (from.x === to.x && from.y === to.y) return null;
  return `warp:${warp.id}:${from.instanceID}:${from.x},${from.y}:${to.instanceID}:${to.x},${to.y}`;
}

function areaLabel(name: string): string {
  return name.split(' - ')[0];
}

const SLIDER_ROUTE_LABEL = 'Marquee Row ↔ Peach Creek Estates';

function sliderStopLabels(route: AreaTransport): string[] {
  return [...new Set(route.stops
    .map((stop) => stop.areaZone)
    .filter((name) => name && name !== 'Unknown - Unknown')
    .map(areaLabel))];
}

function warpRouteLabel(warp: AreaInstanceWarp, bidirectional = false): string {
  const source = warp.entryLocation && warp.entryLocation.instanceID !== 0
    ? warp.entryLocation.instanceName || `Instance ${warp.entryLocation.instanceID}`
    : areaLabel(warp.entryLocation?.areaZone || 'World');
  const destination = warp.instanceID !== 0
    ? warp.instanceName || warp.instance.name || `Instance ${warp.instanceID}`
    : areaLabel(warp.exitLocation?.areaZone || 'World');
  return `${source} ${bidirectional ? '↔' : '→'} ${destination}`;
}

function hasReturnTransport(route: AreaTransport, start: { x: number; y: number }, end: { x: number; y: number }, areas: Area[]): boolean {
  const slider = route.moveType.toLowerCase().includes('slider');
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) <= 2500;
  return areas.some((area) => area.transportation.some((other) => {
    if (other.moveType !== route.moveType) return false;
    return other.stops.some((stop, index) => {
      if (!slider && index !== 0) return false;
      const destination = slider ? other.stops[index + 1] : other.stops.at(-1);
      if (!destination) return false;
      const opposite = (end.x - start.x) * (destination.x - stop.x) + (end.y - start.y) * (destination.y - stop.y) < 0;
      return opposite && near(stop, end) && near(destination, start);
    });
  }));
}

export function buildWorldWarpRoutes(areas: Area[]): MapRouteLine[] {
  const routes = new Map<string, MapRouteLine>();
  const instances = new Map<string, [number, number]>();
  const warps = new Map<string, AreaInstanceWarp>();
  for (const area of areas) {
    for (const warp of area.instanceWarps) {
      const key = mapWarpKey(warp);
      if (!key) continue;
      warps.set(key, warp);
      const points = [warp.entryLocation!, warp.exitLocation!].map(({ x, y }) => ({ x, y }));
      const endpoints = [warp.entryLocation!, warp.exitLocation!];
      instances.set(key, [endpoints[0].instanceID, endpoints[1].instanceID]);
      const geometryKey = endpoints.map((p) => `${p.instanceID}:${p.x},${p.y}`).sort().join(';');
      const existing = routes.get(geometryKey);
      if (existing) {
        if (existing.points[0].x === points[1].x && existing.points[0].y === points[1].y) existing.bidirectional = true;
        if (!existing.routeKeys.includes(key)) existing.routeKeys.push(key);
      } else {
        routes.set(geometryKey, { key, routeKeys: [key], label: warpLabel(warp.npc?.name ?? '', warp.instance.name), moveType: 'Warp', points });
      }
    }
  }
  // Landing positions can be slightly offset from the operator for the return trip.
  // Match both ends, closest pairs first, and never merge chains of nearby warps.
  // Academy's Orchid Bay / Sector V landing is ~2,148 units from its return operator.
  const returnWarpDistance = 2500;
  const lines = [...routes.values()].sort((a, b) => a.key.localeCompare(b.key));
  const pairs: Array<{ a: number; b: number; distance: number }> = [];
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      const [aFrom, aTo] = instances.get(lines[a].key)!;
      const [bFrom, bTo] = instances.get(lines[b].key)!;
      if (aFrom !== bTo || aTo !== bFrom) continue;
      const [aStart, aEnd] = lines[a].points;
      const [bStart, bEnd] = lines[b].points;
      const directionDot = (aEnd.x - aStart.x) * (bEnd.x - bStart.x)
        + (aEnd.y - aStart.y) * (bEnd.y - bStart.y);
      if (directionDot >= 0) continue;
      const outbound = distance(lines[a].points[1], lines[b].points[0]);
      const inbound = distance(lines[b].points[1], lines[a].points[0]);
      if (outbound <= returnWarpDistance && inbound <= returnWarpDistance) {
        pairs.push({ a, b, distance: outbound + inbound });
      }
    }
  }
  pairs.sort((a, b) => a.distance - b.distance || a.a - b.a || a.b - b.b);
  const paired = new Set<number>();
  const merged: MapRouteLine[] = [];
  for (const { a, b } of pairs) {
    if (paired.has(a) || paired.has(b)) continue;
    paired.add(a);
    paired.add(b);
    merged.push({
      ...lines[a],
      bidirectional: true,
      routeKeys: [...new Set([...lines[a].routeKeys, ...lines[b].routeKeys])],
      points: [lines[a].points[0], lines[b].points[0]],
    });
  }
  return [...merged, ...lines.filter((_, index) => !paired.has(index))]
    .map((line) => ({ ...line, label: warpRouteLabel(warps.get(line.key)!, line.bidirectional) }));
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

  for (const mob of area.mobs) {
    const points = mob.points.length > 0 ? mob.points : [{ x: mob.x, y: mob.y, instanceID: mob.instanceID }];
    points.forEach((point, pointIndex) => {
      if (mob.worldBoss && (point.instanceID ?? mob.instanceID) !== 0) return;
      const path = point.pathIndex == null ? undefined : mob.paths?.[point.pathIndex];
      markers.push({
        id: `monster-${mob.ref.id}-${pointIndex}`,
        kind: mob.worldBoss ? 'world-boss' : 'monster',
        routeKeys: mob.worldBoss && path && path.length > 1 ? [bossPathKey(mob.ref.id, path)] : undefined,
        label: mob.ref.name,
        x: point.x,
        y: point.y,
        icon: mob.mapIcon,
        to: refPath(build, mob.ref),
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
      label: e.crateItem ? e.crateItem.name || 'Crate' : e.effectName || 'Power',
      x: e.x,
      y: e.y,
      icon: '/minimap/mapicons/world_egg_shiny_npc.png',
      hoverIcon: e.crateItem ? e.crateItem.icon : e.effectIcon,
      hoverItemIcon: Boolean(e.crateItem),
      to: e.crateItem ? refPath(build, e.crateItem) : `/${build}/areas/${area.id}`,
    });
  });

  // Keep NPC markers available as operators gain transport routes.
  const operators = new Map<string, MapMarker[]>();
  for (const marker of markers) {
    if (marker.kind !== 'npc' && marker.kind !== 'vendor') continue;
    const points = operators.get(marker.to) ?? [];
    points.push(marker);
    operators.set(marker.to, points);
  }

  area.transportation.forEach((t, routeIndex) => {
    const key = routeKey(t);
    t.stops.filter((s) => s.isHere).forEach((s, stopIndex) => {
      const to = t.startNpc ? refPath(build, t.startNpc) : '/' + build + '/areas/' + area.id;
      // Only the departure belongs to startNpc; arrivals can share its area.
      const candidates = s === t.stops[0] ? operators.get(to) ?? [] : [];
      const operator = candidates.reduce<MapMarker | undefined>((closest, marker) =>
        !closest || Math.hypot(marker.x - s.x, marker.y - s.y) < Math.hypot(closest.x - s.x, closest.y - s.y)
          ? marker : closest, undefined);
      if (operator) {
        operator.kind = 'transport';
        operator.routeKey ??= key;
        operator.routeKeys = [...new Set([...(operator.routeKeys ?? []), key])];
        return;
      }
      markers.push({
        id: `transport-${routeIndex}-${stopIndex}`,
        kind: 'transport',
        label: t.routeName,
        x: s.x,
        y: s.y,
        icon: transportIcon(t.moveType, t.startNpc?.name),
        to,
        routeKey: key,
      });
    });
  });

  area.instanceWarps.forEach((w, i) => {
    if (!w.entryLocation || w.npcCategory !== 'Warp') return;
    const npcName = w.npc?.name ?? '';
    const key = mapWarpKey(w);
    markers.push({
      id: `instance-warp-${w.id}-${i}`,
      kind: 'instance-warp',
      routeKeys: key ? [key] : undefined,
      label: warpLabel(npcName, w.instance.name),
      x: w.entryLocation.x,
      y: w.entryLocation.y,
      icon: warpIcon(npcName),
      to: warpDestinationPath(build, w),
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
      existing.routeKeys = [...new Set([...(existing.routeKeys ?? []), ...(marker.routeKeys ?? [marker.routeKey])])];
      const routeCount = existing.routeKeys.length;
      const baseLabel = existing.label.replace(/ \([0-9]+ routes\)$/, '');
      existing.label = routeCount > 1 ? `${baseLabel} (${routeCount} routes)` : baseLabel;
    } else {
      const groupedMarker = { ...marker, routeKeys: marker.routeKeys ?? [marker.routeKey] };
      grouped.set(groupKey, groupedMarker);
      out.push(groupedMarker);
    }
  }

  return out;
}

export function buildWorldTransportRoutes(areas: Area[]): MapRouteLine[] {
  const routes = new Map<string, MapRouteLine>();
  const seenRoutes = new Set<string>();
  for (const area of areas) {
    for (const route of area.transportation) {
      const key = routeKey(route);
      if (seenRoutes.has(key)) continue;
      seenRoutes.add(key);
      const points = (route.routePoints && route.routePoints.length > 0 ? route.routePoints : route.stops)
        .map((p) => ({ x: p.x, y: p.y }))
        .filter((p) => p.x !== 0 || p.y !== 0);
      if (points.length < 2) continue;
      // Opposite-direction routes share one stroke so their dashes cannot fill each other's gaps.
      const moveType = route.moveType === 'SCAMPER' && route.startNpc?.name.includes('Woosh')
        ? 'Woosh' : route.moveType;
      const forward = points.map((p) => `${p.x},${p.y}`).join(';');
      const reverse = [...points].reverse().map((p) => `${p.x},${p.y}`).join(';');
      const geometryKey = `${moveType}:${forward < reverse ? forward : reverse}`;
      const existing = routes.get(geometryKey);
      if (existing) {
        existing.routeKeys.push(key);
      } else {
        const start = route.stops[0];
        const end = route.stops.at(-1);
        const slider = route.moveType.toLowerCase().includes('slider');
        const bidirectional = slider || Boolean(start && end && hasReturnTransport(route, start, end, areas));
        const label = slider ? SLIDER_ROUTE_LABEL : start && end
          ? `${areaLabel(start.areaZone || route.routeName)} ${bidirectional ? '↔' : '→'} ${areaLabel(end.areaZone || route.routeName)}`
          : route.routeName;
        routes.set(geometryKey, { key, routeKeys: [key], label, bidirectional, moveType, points,
          markerLabels: slider ? sliderStopLabels(route) : undefined });
      }
    }
  }
  return [...routes.values()];
}

export function buildAreaOutgoingRoutes(area: Area, allAreas: Area[] = [area]): Array<MapRouteLine & { kind: 'transport' | 'instance-warp'; destination: string }> {
  const routes: Array<MapRouteLine & { kind: 'transport' | 'instance-warp'; destination: string }> = [];
  for (const route of area.transportation) {
    const slider = route.moveType.toLowerCase().includes('slider');
    route.stops.forEach((stop, index) => {
      const destination = slider ? route.stops[index + 1] : route.stops.at(-1);
      if (!destination || destination === stop) return;
      // The Slider's return track reaches a local stop from outside the area.
      // Include both adjoining legs so its loop stays connected at each station.
      if (slider ? !stop.isHere && !destination.isHere : !stop.isHere || index !== 0) return;
      const authored = route.routePoints ?? [];
      const start = authored.findIndex((p) => p.x === stop.x && p.y === stop.y);
      const end = authored.findIndex((p, i) => i > start && p.x === destination.x && p.y === destination.y);
      const points = slider
        ? start >= 0 && end > start ? authored.slice(start, end + 1) : [stop, destination]
        : authored.length > 1 ? authored : route.stops;
      const bidirectional = slider || hasReturnTransport(route, stop, destination, allAreas);
      const destinationName = destination.areaZone || route.routeName;
      routes.push({
        key: `${routeKey(route)}:outgoing:${index}`,
        routeKeys: [routeKey(route)],
        label: slider ? SLIDER_ROUTE_LABEL : `${areaLabel(stop.areaZone || area.fullName)} ${bidirectional ? '↔' : '→'} ${areaLabel(destinationName)}`,
        markerLabels: slider ? sliderStopLabels(route) : undefined,
        bidirectional,
        moveType: route.moveType === 'SCAMPER' && route.startNpc?.name.includes('Woosh') ? 'Woosh' : route.moveType,
        points,
        kind: 'transport',
        destination: destinationName,
      });
    });
  }
  const localKeys = new Set(area.instanceWarps.map(mapWarpKey).filter(Boolean));
  for (const path of buildWorldWarpRoutes(allAreas)) {
    if (!path.routeKeys.some((key) => localKeys.has(key))) continue;
    const warp = area.instanceWarps.find((w) => path.routeKeys.includes(mapWarpKey(w) ?? ''));
    const destination = warp && warp.instanceID !== 0
      ? warp.instanceName || warp.instance.name || `Instance ${warp.instanceID}`
      : areaLabel(warp?.exitLocation?.areaZone || warp?.instance.name || path.label);
    routes.push({ ...path, label: warp ? warpRouteLabel(warp, path.bidirectional) : path.label, kind: 'instance-warp', destination });
  }
  return routes;
}
