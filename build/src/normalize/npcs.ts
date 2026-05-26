import AdmZip from 'adm-zip';

import { chunkOf, writeChunks, writeIndex } from '../chunk.js';
import { iconFor, itemRef, parseCompoundKey } from './refs.js';
import type {
  Npc,
  NpcIndexEntry,
  NpcLocation,
  NpcTransportRoute,
  NpcTransportSpot,
  NpcVendorItem,
  Ref,
} from './types.js';
import type { IconMap } from '../icons.js';
import type { NpcMissionsMap } from './missions.js';
import type { InstanceNameIndex } from './instanceLookup.js';
import { slugify } from './slug.js';

interface RawNpcType {
  ID: number;
  Name: string;
  Icon?: string;
  Category?: string;
  Comment?: string;
  InGame?: boolean;
  Height?: number;
  Scale?: number;
  Barkers?: string[];
  MissionBarkers?: Record<string, string>;
  VendorItems?: Array<{
    BuyPrice?: number;
    ItemInfo?: {
      ItemID: number;
      TypeID?: number;
      Name: string;
      Icon?: string;
      Rarity?: string;
      RequiredLevel?: number;
      Type?: string;
      ItemSellPrice?: number;
    };
  }>;
}

interface RawNpcInstance {
  ID?: string | number;
  AreaZone?: string;
  X?: number;
  Y?: number;
  Z?: number;
  InstanceID?: number;
  TypeID?: number;
}

interface RawTransportPoint {
  AreaZone?: string;
  Name?: string;
  X?: number;
  Y?: number;
  Z?: number;
  IsStopPoint?: boolean;
}

interface RawTransportRoute {
  InGame?: boolean;
  MoveType?: string;
  NPCID?: number;
  NPCType?: { Category?: string } | null;
  StartLocation?: RawTransportPoint;
  Transportations?: Record<string, RawTransportPoint & {
    Route?: RawTransportPoint[];
  }>;
}

function hasConsistentTransportOperator(route: RawTransportRoute): boolean {
  const category = route.NPCType?.Category ?? '';
  const moveType = route.MoveType ?? '';
  return !category || !moveType || category === moveType;
}

function normalizeLocation(raw: RawNpcInstance, instanceNames: InstanceNameIndex): NpcLocation {
  const areaZone = raw.AreaZone ?? '';
  const instanceID = raw.InstanceID ?? 0;
  return {
    areaZone,
    areaId: areaZone && areaZone !== 'Unknown - Unknown' ? slugify(areaZone) : '',
    x: raw.X ?? 0,
    y: raw.Y ?? 0,
    z: raw.Z ?? 0,
    instanceID,
    instanceName: instanceNames.get(instanceID) ?? '',
  };
}


function normalizeTransportSpot(raw: RawTransportPoint | null | undefined): NpcTransportSpot | null {
  if (!raw?.AreaZone) return null;
  return {
    areaZone: raw.AreaZone,
    areaId: raw.AreaZone !== 'Unknown - Unknown' ? slugify(raw.AreaZone) : '',
    x: raw.X ?? 0,
    y: raw.Y ?? 0,
    z: raw.Z ?? 0,
  };
}

function buildNpcTransportRoutes(rawTransport: Record<string, RawTransportRoute>): Map<number, NpcTransportRoute[]> {
  const out = new Map<number, NpcTransportRoute[]>();

  for (const [rid, route] of Object.entries(rawTransport)) {
    if (!route?.InGame || !hasConsistentTransportOperator(route) || !route.NPCID || route.NPCID <= 0) continue;
    const routeId = parseInt(rid, 10);
    const moveType = route.MoveType ?? '';

    for (const sub of Object.values(route.Transportations ?? {})) {
      const rawPoints = sub.Route ?? [];
      let start: NpcTransportSpot | null = null;
      let landing: NpcTransportSpot | null = null;

      if (moveType === 'SCAMPER') {
        start = normalizeTransportSpot(route.StartLocation);
        landing = normalizeTransportSpot(sub);
      } else {
        const visiblePoints = moveType === 'Slider'
          ? rawPoints.filter((point) => point.IsStopPoint)
          : rawPoints.length > 1 ? [rawPoints[0], rawPoints[rawPoints.length - 1]] : rawPoints;
        start = normalizeTransportSpot(visiblePoints[0]);
        landing = normalizeTransportSpot(visiblePoints[visiblePoints.length - 1]);
      }

      const list = out.get(route.NPCID) ?? [];
      list.push({
        routeId,
        routeName: sub.Name || moveType || `Route ${routeId}`,
        moveType,
        start,
        landing,
      });
      out.set(route.NPCID, list);
    }
  }

  for (const list of out.values()) {
    list.sort((a, b) =>
      a.moveType.localeCompare(b.moveType) ||
      a.routeName.localeCompare(b.routeName) ||
      a.routeId - b.routeId
    );
  }

  return out;
}

function normalizeVendorItems(raw: RawNpcType, iconMap: IconMap): NpcVendorItem[] {
  const out: NpcVendorItem[] = [];
  for (const v of raw.VendorItems ?? []) {
    const info = v.ItemInfo;
    if (!info) continue;
    const ref = itemRef(info.TypeID ?? 0, info.ItemID, info.Name ?? '', info.Icon ?? '', iconMap);
    if (!ref) continue;
    out.push({
      ref,
      buyPrice: v.BuyPrice ?? 0,
      sellPrice: info.ItemSellPrice ?? 0,
      rarity: info.Rarity ?? '',
      requiredLevel: info.RequiredLevel ?? 0,
      itemKind: info.Type ?? '',
    });
  }
  return out;
}

function normalizeMissionBarkers(raw: RawNpcType): Array<{ mission: Ref; text: string }> {
  const out: Array<{ mission: Ref; text: string }> = [];
  for (const [key, text] of Object.entries(raw.MissionBarkers ?? {})) {
    const { id, name } = parseCompoundKey(key);
    if (id <= 0) continue;
    out.push({ mission: { type: 'mission', id, name: name || `Mission #${id}` }, text });
  }
  return out;
}

function normalizeComment(raw: RawNpcType): string {
  return (raw.Comment ?? '').trim();
}

function buildNpc(
  raw: RawNpcType,
  rawInsts: Record<string, Record<string, RawNpcInstance>>,
  iconMap: IconMap,
  npcMissions: NpcMissionsMap,
  instanceNames: InstanceNameIndex,
  transportRoutesByNpc: Map<number, NpcTransportRoute[]>,
): Npc {
  const locations = Object.values(rawInsts[String(raw.ID)] ?? {}).map((inst) => normalizeLocation(inst, instanceNames));
  const missions = npcMissions.get(raw.ID);
  return {
    id: raw.ID,
    name: raw.Name,
    icon: iconFor(raw.Icon ?? '', iconMap),
    category: raw.Category ?? '',
    comment: normalizeComment(raw),
    inGame: raw.InGame ?? false,
    height: raw.Height ?? 0,
    scale: raw.Scale ?? 1,
    idleBarkers: (raw.Barkers ?? []).map((text) => text.trim()).filter(Boolean),
    missionBarkers: normalizeMissionBarkers(raw),
    vendorItems: normalizeVendorItems(raw, iconMap),
    transportRoutes: transportRoutesByNpc.get(raw.ID) ?? [],
    startedMissions: missions?.starts ?? [],
    journaledMissions: missions?.journals ?? [],
    endedMissions: missions?.ends ?? [],
    locations,
  };
}

function indexEntry(n: Npc): NpcIndexEntry {
  return {
    id: n.id,
    name: n.name,
    icon: n.icon,
    category: n.category,
    instanceCount: n.locations.length,
    inGame: n.inGame,
  };
}

/**
 * Read npc_type_info.json + npc_info.json, normalize every NPC type with its
 * world instances, and emit one page/index row per raw NPC type ID.
 */
export async function normalizeNpcs(
  zipPath: string,
  slug: string,
  iconMap: IconMap,
  npcMissions: NpcMissionsMap,
  instanceNames: InstanceNameIndex,
): Promise<{ count: number; chunks: number; vendors: number; linked: number }> {
  const zip = new AdmZip(zipPath);
  const typeEntry = zip.getEntry('info/npc_type_info.json');
  const instEntry = zip.getEntry('info/npc_info.json');
  const transportEntry = zip.getEntry('info/transportation_info.json');
  if (!typeEntry) {
    return { count: 0, chunks: 0, vendors: 0, linked: 0 };
  }
  const rawTypes = JSON.parse(typeEntry.getData().toString('utf8')) as Record<string, RawNpcType>;
  const rawInsts = instEntry
    ? (JSON.parse(instEntry.getData().toString('utf8')) as Record<string, Record<string, RawNpcInstance>>)
    : {};
  const rawTransport = transportEntry
    ? (JSON.parse(transportEntry.getData().toString('utf8')) as Record<string, RawTransportRoute>)
    : {};
  const transportRoutesByNpc = buildNpcTransportRoutes(rawTransport);

  const npcs: Npc[] = Object.values(rawTypes)
    .map((t) => buildNpc(t, rawInsts, iconMap, npcMissions, instanceNames, transportRoutesByNpc))
    .sort((a, b) => a.id - b.id);

  const vendors = npcs.filter((n) => n.vendorItems.length > 0).length;
  const linked = npcs.filter(
    (n) => n.startedMissions.length || n.journaledMissions.length || n.endedMissions.length,
  ).length;

  const { chunks } = await writeChunks(slug, 'npcs', npcs, (n) => ({
    url: n.id,
    chunk: chunkOf(n.id),
  }));
  await writeIndex(slug, 'npcs', npcs.map(indexEntry));

  return { count: npcs.length, chunks, vendors, linked };
}
