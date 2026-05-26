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
import type { NpcGrouping } from './npcGrouping.js';
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
  StartLocation?: RawTransportPoint;
  Transportations?: Record<string, RawTransportPoint & {
    Route?: RawTransportPoint[];
  }>;
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
    if (!route?.InGame || !route.NPCID || route.NPCID <= 0) continue;
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

/**
 * Merge raw members of a group into the canonical record. Unioned: idle barkers,
 * mission barkers (dedup by mission id), vendor items (dedup by item id), locations.
 * The canonical's icon/comment/category/name are retained.
 */
function buildMergedNpc(
  canonical: RawNpcType,
  aliases: RawNpcType[],
  rawInsts: Record<string, Record<string, RawNpcInstance>>,
  iconMap: IconMap,
  npcMissions: NpcMissionsMap,
  instanceNames: InstanceNameIndex,
  transportRoutesByNpc: Map<number, NpcTransportRoute[]>,
): Npc {
  const allMembers = [canonical, ...aliases];

  const idleBarkers = new Set<string>();
  const missionBarkersBy = new Map<number, { mission: Ref; text: string }>();
  // Item refs use compound string IDs (typeId-itemId).
  const vendorBy = new Map<string, NpcVendorItem>();
  const locations: NpcLocation[] = [];
  const transportRoutes: NpcTransportRoute[] = [];

  for (const member of allMembers) {
    for (const s of member.Barkers ?? []) {
      const t = s.trim();
      if (t) idleBarkers.add(t);
    }
    for (const mb of normalizeMissionBarkers(member)) {
      const key = mb.mission.id as number;
      if (!missionBarkersBy.has(key)) missionBarkersBy.set(key, mb);
    }
    for (const v of normalizeVendorItems(member, iconMap)) {
      const key = String(v.ref.id);
      if (!vendorBy.has(key)) vendorBy.set(key, v);
    }
    const insts = rawInsts[String(member.ID)] ?? {};
    for (const inst of Object.values(insts)) locations.push(normalizeLocation(inst, instanceNames));
    transportRoutes.push(...(transportRoutesByNpc.get(member.ID) ?? []));
  }

  const aliasIds = aliases.map((a) => a.ID).sort((a, b) => a - b);
  const missions = npcMissions.get(canonical.ID);

  return {
    id: canonical.ID,
    name: canonical.Name,
    icon: iconFor(canonical.Icon ?? '', iconMap),
    category: canonical.Category ?? '',
    comment: normalizeComment(canonical),
    inGame: canonical.InGame ?? false,
    height: canonical.Height ?? 0,
    scale: canonical.Scale ?? 1,

    idleBarkers: [...idleBarkers],
    missionBarkers: [...missionBarkersBy.values()],

    vendorItems: [...vendorBy.values()],
    transportRoutes,

    startedMissions: missions?.starts ?? [],
    journaledMissions: missions?.journals ?? [],
    endedMissions: missions?.ends ?? [],

    locations,
    aliasIds,
  };
}

/** Out-of-game NPCs are kept as-is (no merging). */
function buildSoloNpc(
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
    idleBarkers: (raw.Barkers ?? []).map((s) => s.trim()).filter(Boolean),
    missionBarkers: normalizeMissionBarkers(raw),
    vendorItems: normalizeVendorItems(raw, iconMap),
    transportRoutes: transportRoutesByNpc.get(raw.ID) ?? [],
    startedMissions: missions?.starts ?? [],
    journaledMissions: missions?.journals ?? [],
    endedMissions: missions?.ends ?? [],
    locations,
    aliasIds: [],
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
 * Read npc_type_info.json + npc_info.json, group in-game NPCs by
 * (category, name) via the supplied grouping, and emit one merged
 * record per canonical ID. Out-of-game NPCs are passed through unchanged.
 */
export async function normalizeNpcs(
  zipPath: string,
  slug: string,
  iconMap: IconMap,
  grouping: NpcGrouping,
  npcMissions: NpcMissionsMap,
  instanceNames: InstanceNameIndex,
): Promise<{ count: number; chunks: number; vendors: number; linked: number; merged: number }> {
  const zip = new AdmZip(zipPath);
  const typeEntry = zip.getEntry('info/npc_type_info.json');
  const instEntry = zip.getEntry('info/npc_info.json');
  const transportEntry = zip.getEntry('info/transportation_info.json');
  if (!typeEntry) {
    return { count: 0, chunks: 0, vendors: 0, linked: 0, merged: 0 };
  }
  const rawTypes = JSON.parse(typeEntry.getData().toString('utf8')) as Record<string, RawNpcType>;
  const rawInsts = instEntry
    ? (JSON.parse(instEntry.getData().toString('utf8')) as Record<string, Record<string, RawNpcInstance>>)
    : {};
  const rawTransport = transportEntry
    ? (JSON.parse(transportEntry.getData().toString('utf8')) as Record<string, RawTransportRoute>)
    : {};
  const transportRoutesByNpc = buildNpcTransportRoutes(rawTransport);

  // Bucket aliases (non-canonical in-game members) under their canonical ID.
  const aliasesByCanonical = new Map<number, RawNpcType[]>();
  for (const t of Object.values(rawTypes)) {
    if (!t.InGame) continue;
    const canon = grouping.memberToCanonical.get(t.ID);
    if (canon === undefined || canon === t.ID) continue;
    let list = aliasesByCanonical.get(canon);
    if (!list) {
      list = [];
      aliasesByCanonical.set(canon, list);
    }
    list.push(t);
  }

  let mergedCount = 0;
  const npcs: Npc[] = [];
  for (const t of Object.values(rawTypes)) {
    if (t.InGame) {
      const canon = grouping.memberToCanonical.get(t.ID) ?? t.ID;
      if (canon !== t.ID) continue; // alias, will be folded into canonical
      const aliases = aliasesByCanonical.get(t.ID) ?? [];
      if (aliases.length > 0) mergedCount++;
      npcs.push(buildMergedNpc(t, aliases, rawInsts, iconMap, npcMissions, instanceNames, transportRoutesByNpc));
    } else {
      // Out-of-game: kept as solo, no grouping applied.
      npcs.push(buildSoloNpc(t, rawInsts, iconMap, npcMissions, instanceNames, transportRoutesByNpc));
    }
  }
  npcs.sort((a, b) => a.id - b.id);

  const vendors = npcs.filter((n) => n.vendorItems.length > 0).length;
  const linked = npcs.filter(
    (n) => n.startedMissions.length || n.journaledMissions.length || n.endedMissions.length,
  ).length;

  const { chunks } = await writeChunks(slug, 'npcs', npcs, (n) => ({
    url: n.id,
    chunk: chunkOf(n.id),
  }));
  await writeIndex(slug, 'npcs', npcs.map(indexEntry));

  return { count: npcs.length, chunks, vendors, linked, merged: mergedCount };
}
