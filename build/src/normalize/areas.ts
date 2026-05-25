import AdmZip from 'adm-zip';

import { writeChunks, writeIndex } from '../chunk.js';
import { iconFor, itemRef } from './refs.js';
import { slugify } from './slug.js';
import type {
  Area,
  AreaEggEntry,
  AreaIndexEntry,
  AreaInfectedZoneSummary,
  AreaInstanceWarp,
  AreaMobEntry,
  AreaNpcEntry,
  AreaTransport,
  Ref,
} from './types.js';
import type { IconMap } from '../icons.js';
import type { NpcGrouping } from './npcGrouping.js';
import type { NpcMissionsMap } from './missions.js';

interface RawAreaInfo {
  AreaName: string;
  ZoneName: string;
  X?: number;
  Y?: number;
  Width?: number;
  Height?: number;
  NPCs?: Record<string, RawAreaNpc>;
  NPCTypes?: Record<string, RawAreaNpcType>;
  Mobs?: Record<string, RawAreaMob>;
  MobTypes?: Record<string, RawAreaMobType>;
  Vendors?: Record<string, RawAreaNpc>;
  Eggs?: Record<string, RawAreaEgg>;
  EggTypes?: Record<string, RawAreaEggType>;
  Transportation?: Record<string, unknown>;
  InstanceWarps?: Record<string, RawAreaInstanceWarp>;
  InfectedZone?: RawAreaInfectedZone | null;
}

interface RawAreaNpc {
  TypeID: number;
  TypeName?: string;
  TypeIcon?: string;
}
interface RawAreaNpcType {
  ID: number;
  Name?: string;
  Icon?: string;
  Category?: string;
  VendorItems?: unknown[];
}
interface RawAreaMob {
  TypeID: number;
  TypeName?: string;
  TypeIcon?: string;
  HP?: number;
}
interface RawAreaMobType {
  ID: number;
  Name?: string;
  Icon?: string;
  Level?: number;
  StandardHP?: number;
}
interface RawAreaEgg {
  TypeID: number;
  TypeName?: string;
  TypeComment?: string;
  TypeExtraComment?: string;
  X?: number;
  Y?: number;
  Z?: number;
  InstanceID?: number;
}
interface RawAreaEggType {
  ID: number;
  Comment?: string;
  Crate?: {
    ItemID?: number;
    TypeID?: number;
    Name?: string;
    Icon?: string;
  };
  Effect?: string;
  EffectIcon?: string;
  EffectDuration?: number;
}
interface RawAreaInstanceWarp {
  EntryInstanceID?: number;
  EntryInstance?: string;
  NPCTypeID?: number;
  NPCName?: string;
  NPCIcon?: string;
  RequiredItemID?: number;
  RequiredItemType?: number;
  RequiredItem?: { Name?: string; Icon?: string } | null;
  RequiredMinLevel?: number;
}
interface RawAreaInfectedZone {
  ID?: number;
  EPID?: number;
  Description?: string;
  DifficultyLabel?: string;
  RecommendedLevel?: number;
  MaxScore?: number;
}

interface RawTransportRoute {
  InGame?: boolean;
  MoveType?: string;
  NPCID?: number;
  NPCType?: { Name?: string; Icon?: string } | null;
  StartLocation?: { Name?: string; AreaZone?: string };
  Transportations?: Record<string, {
    Name?: string;
    Icon?: string;
    Route?: Array<{ AreaZone?: string; X?: number; Y?: number; Z?: number; IsStopPoint?: boolean }>;
  }>;
}

interface RawInstance {
  ID?: number;
  Name?: string;
}

function canonNpcId(id: number, grouping: NpcGrouping): number {
  return grouping.memberToCanonical.get(id) ?? id;
}

/** True when a region has at least one piece of in-area content. */
function isPopulated(r: RawAreaInfo): boolean {
  return (
    Object.keys(r.NPCs ?? {}).length > 0 ||
    Object.keys(r.Mobs ?? {}).length > 0 ||
    Object.keys(r.Vendors ?? {}).length > 0 ||
    Object.keys(r.Eggs ?? {}).length > 0 ||
    Object.keys(r.Transportation ?? {}).length > 0 ||
    Object.keys(r.InstanceWarps ?? {}).length > 0
  );
}

/**
 * area_info.json keys a list of regions per name — some areas are described
 * as multiple disjoint rectangles where only some of them carry content
 * (e.g. "Bravo Beach - Downtown" ships an empty region 0 plus a populated
 * region 1 in a different tile). Merge content from all regions, but take
 * the geometry from the union of POPULATED regions so the area's minimap
 * frames the part that actually has stuff in it. Falls back to the union
 * of all regions when none are populated.
 */
function mergeRegions(regions: RawAreaInfo[]): RawAreaInfo {
  const merged: RawAreaInfo = {
    AreaName: regions[0]?.AreaName ?? '',
    ZoneName: regions[0]?.ZoneName ?? '',
    NPCs: {},
    NPCTypes: {},
    Mobs: {},
    MobTypes: {},
    Vendors: {},
    Eggs: {},
    EggTypes: {},
    Transportation: {},
    InstanceWarps: {},
    InfectedZone: null,
  };

  // Geometry: union of the bbox of every region that carries content.
  const populated = regions.filter(isPopulated);
  const geomSource = populated.length > 0 ? populated : regions;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of geomSource) {
    if (r.X === undefined || r.Y === undefined || r.Width === undefined || r.Height === undefined) continue;
    if (r.X < minX) minX = r.X;
    if (r.Y < minY) minY = r.Y;
    if (r.X + r.Width > maxX) maxX = r.X + r.Width;
    if (r.Y + r.Height > maxY) maxY = r.Y + r.Height;
  }
  if (Number.isFinite(minX)) {
    merged.X = minX;
    merged.Y = minY;
    merged.Width = maxX - minX;
    merged.Height = maxY - minY;
  }

  // Content: union across every region regardless of population.
  for (const r of regions) {
    Object.assign(merged.NPCs!, r.NPCs ?? {});
    Object.assign(merged.NPCTypes!, r.NPCTypes ?? {});
    Object.assign(merged.Mobs!, r.Mobs ?? {});
    Object.assign(merged.MobTypes!, r.MobTypes ?? {});
    Object.assign(merged.Vendors!, r.Vendors ?? {});
    Object.assign(merged.Eggs!, r.Eggs ?? {});
    Object.assign(merged.EggTypes!, r.EggTypes ?? {});
    Object.assign(merged.Transportation!, r.Transportation ?? {});
    Object.assign(merged.InstanceWarps!, r.InstanceWarps ?? {});
    if (!merged.InfectedZone && r.InfectedZone) merged.InfectedZone = r.InfectedZone;
  }
  return merged;
}

/** Aggregate NPC instances by canonical type ID. */
function buildAreaNpcs(
  npcs: Record<string, RawAreaNpc> | undefined,
  npcTypes: Record<string, RawAreaNpcType> | undefined,
  iconMap: IconMap,
  grouping: NpcGrouping,
): AreaNpcEntry[] {
  const counts = new Map<number, { count: number; name: string; icon: string }>();
  for (const inst of Object.values(npcs ?? {})) {
    if (!inst || typeof inst !== 'object') continue;
    const canon = canonNpcId(inst.TypeID, grouping);
    const meta = npcTypes?.[String(inst.TypeID)] ?? npcTypes?.[String(canon)];
    const name = meta?.Name ?? inst.TypeName ?? `NPC #${canon}`;
    const icon = iconFor(meta?.Icon ?? inst.TypeIcon ?? '', iconMap);
    const cur = counts.get(canon);
    if (cur) cur.count++;
    else counts.set(canon, { count: 1, name, icon });
  }
  return [...counts.entries()]
    .map(([id, { count, name, icon }]) => ({
      ref: { type: 'npc' as const, id, name, icon },
      instanceCount: count,
    }))
    .sort((a, b) => b.instanceCount - a.instanceCount || a.ref.name.localeCompare(b.ref.name));
}

function buildAreaMobs(
  mobs: Record<string, RawAreaMob> | undefined,
  mobTypes: Record<string, RawAreaMobType> | undefined,
  iconMap: IconMap,
): AreaMobEntry[] {
  const counts = new Map<number, { count: number; name: string; icon: string; level: number; hp: number }>();
  for (const inst of Object.values(mobs ?? {})) {
    if (!inst || typeof inst !== 'object') continue;
    const tid = inst.TypeID;
    const meta = mobTypes?.[String(tid)];
    const name = meta?.Name ?? inst.TypeName ?? `Mob #${tid}`;
    const icon = iconFor(meta?.Icon ?? inst.TypeIcon ?? '', iconMap);
    const cur = counts.get(tid);
    if (cur) cur.count++;
    else counts.set(tid, {
      count: 1,
      name,
      icon,
      level: meta?.Level ?? 0,
      hp: meta?.StandardHP ?? inst.HP ?? 0,
    });
  }
  return [...counts.entries()]
    .map(([id, { count, name, icon, level, hp }]) => ({
      ref: { type: 'monster' as const, id, name, icon },
      instanceCount: count,
      level,
      hp,
    }))
    .sort((a, b) => a.level - b.level || a.ref.name.localeCompare(b.ref.name));
}

function buildAreaEggs(
  eggs: Record<string, RawAreaEgg> | undefined,
  eggTypes: Record<string, RawAreaEggType> | undefined,
  iconMap: IconMap,
): AreaEggEntry[] {
  const out: AreaEggEntry[] = [];
  for (const inst of Object.values(eggs ?? {})) {
    if (!inst || typeof inst !== 'object') continue;
    const meta = eggTypes?.[String(inst.TypeID)];
    const crate = meta?.Crate;
    let crateItem: Ref | null = null;
    if (crate && crate.ItemID) {
      crateItem = itemRef(crate.TypeID ?? 9, crate.ItemID, crate.Name ?? '', crate.Icon ?? '', iconMap);
    }
    out.push({
      typeName: inst.TypeName ?? meta?.Comment ?? `Egg #${inst.TypeID}`,
      typeComment: meta?.Comment ?? '',
      crateItem,
      effectName: meta?.Effect ?? '',
      effectIcon: iconFor(meta?.EffectIcon ?? '', iconMap),
      effectDuration: meta?.EffectDuration ?? 0,
      x: inst.X ?? 0,
      y: inst.Y ?? 0,
      z: inst.Z ?? 0,
      instanceID: inst.InstanceID ?? 0,
    });
  }
  return out;
}

/** Build a lookup: areaZone → list of routes that pass through it. */
function buildTransportIndex(
  rawTransport: Record<string, RawTransportRoute>,
  iconMap: IconMap,
): Map<string, AreaTransport[]> {
  const out = new Map<string, AreaTransport[]>();
  for (const [rid, route] of Object.entries(rawTransport)) {
    if (!route || !route.InGame) continue;
    const routeId = parseInt(rid, 10);
    const startNpc: Ref | null = route.NPCID && route.NPCID > 0 && route.NPCType
      ? { type: 'npc', id: route.NPCID, name: route.NPCType.Name ?? `NPC #${route.NPCID}`, icon: iconFor(route.NPCType.Icon ?? '', iconMap) }
      : null;

    for (const sub of Object.values(route.Transportations ?? {})) {
      const stopsRaw = sub.Route ?? [];
      const stops = stopsRaw.map((s) => ({
        areaZone: s.AreaZone ?? '',
        x: s.X ?? 0,
        y: s.Y ?? 0,
        z: s.Z ?? 0,
        isHere: false,
      }));
      const zones = new Set(stops.map((s) => s.areaZone).filter(Boolean));
      for (const z of zones) {
        let list = out.get(z);
        if (!list) {
          list = [];
          out.set(z, list);
        }
        list.push({
          routeId,
          routeName: sub.Name ?? route.MoveType ?? `Route ${routeId}`,
          moveType: route.MoveType ?? '',
          startNpc,
          stops: stops.map((s) => ({ ...s, isHere: s.areaZone === z })),
        });
      }
    }
  }
  return out;
}

function buildAreaInstanceWarps(
  warps: Record<string, RawAreaInstanceWarp> | undefined,
  instanceIndex: Map<number, RawInstance>,
  iconMap: IconMap,
  grouping: NpcGrouping,
): AreaInstanceWarp[] {
  const out: AreaInstanceWarp[] = [];
  for (const w of Object.values(warps ?? {})) {
    if (!w || typeof w !== 'object') continue;
    const instId = w.EntryInstanceID ?? 0;
    const inst = instanceIndex.get(instId);
    const npc: Ref | null = w.NPCTypeID && w.NPCTypeID > 0
      ? {
        type: 'npc',
        id: canonNpcId(w.NPCTypeID, grouping),
        name: w.NPCName ?? `NPC #${w.NPCTypeID}`,
        icon: iconFor(w.NPCIcon ?? '', iconMap),
      }
      : null;
    const requiredItem: Ref | null = w.RequiredItemID && w.RequiredItemID > 0
      ? itemRef(w.RequiredItemType ?? 0, w.RequiredItemID, w.RequiredItem?.Name ?? '', w.RequiredItem?.Icon ?? '', iconMap)
      : null;
    out.push({
      instanceID: instId,
      instanceName: inst?.Name ?? w.EntryInstance ?? `Instance ${instId}`,
      npc,
      requiredItem,
      requiredMinLevel: w.RequiredMinLevel ?? 0,
    });
  }
  return out;
}

function summarizeInfectedZone(iz: RawAreaInfectedZone | null | undefined): AreaInfectedZoneSummary | null {
  if (!iz || typeof iz !== 'object') return null;
  const id = iz.ID ?? iz.EPID ?? 0;
  if (!id) return null;
  return {
    iznId: id,
    description: (iz.Description ?? '').trim(),
    difficultyLabel: iz.DifficultyLabel ?? '',
    recommendedLevel: iz.RecommendedLevel ?? 0,
    maxScore: iz.MaxScore ?? 0,
  };
}

function indexEntry(a: Area): AreaIndexEntry {
  return {
    id: a.id,
    name: a.name,
    zoneName: a.zoneName,
    x: a.x,
    y: a.y,
    width: a.width,
    height: a.height,
    npcCount: a.npcs.length,
    mobCount: a.mobs.length,
    missionCount: a.missionsStarting.length,
  };
}

/**
 * Combine area_info.json with the three supporting files and emit one record
 * per area. Each entry summarizes who/what is in the area plus transportation
 * routes touching it; missions are linked through start-NPC residency.
 */
export async function normalizeAreas(
  zipPath: string,
  slug: string,
  iconMap: IconMap,
  grouping: NpcGrouping,
  npcMissions: NpcMissionsMap,
): Promise<{ count: number; chunks: number; withMissions: number; withTransport: number }> {
  const zip = new AdmZip(zipPath);
  const areaEntry = zip.getEntry('info/area_info.json');
  if (!areaEntry) return { count: 0, chunks: 0, withMissions: 0, withTransport: 0 };

  const rawAreas = JSON.parse(areaEntry.getData().toString('utf8')) as Record<string, RawAreaInfo[]>;

  const transportEntry = zip.getEntry('info/transportation_info.json');
  const rawTransport = transportEntry
    ? (JSON.parse(transportEntry.getData().toString('utf8')) as Record<string, RawTransportRoute>)
    : {};
  const transportIndex = buildTransportIndex(rawTransport, iconMap);

  const instanceEntry = zip.getEntry('info/instance_info.json');
  const instanceIndex = new Map<number, RawInstance>();
  if (instanceEntry) {
    const rawInst = JSON.parse(instanceEntry.getData().toString('utf8')) as Record<string, RawInstance>;
    for (const [id, v] of Object.entries(rawInst)) {
      instanceIndex.set(parseInt(id, 10), v);
    }
  }

  const areas: Area[] = [];
  for (const [fullName, list] of Object.entries(rawAreas)) {
    if (!Array.isArray(list) || list.length === 0) continue;
    // Some areas (e.g. Marquee Row - Downtown) ship as multiple disjoint
    // regions in area_info; merge them into a single logical area.
    const raw = list.length === 1 ? list[0] : mergeRegions(list);
    if (!raw) continue;

    const id = slugify(fullName);
    const npcs = buildAreaNpcs(raw.NPCs, raw.NPCTypes, iconMap, grouping);
    const mobs = buildAreaMobs(raw.Mobs, raw.MobTypes, iconMap);
    const eggs = buildAreaEggs(raw.Eggs, raw.EggTypes, iconMap);
    const transportation = transportIndex.get(fullName) ?? [];
    const instanceWarps = buildAreaInstanceWarps(raw.InstanceWarps, instanceIndex, iconMap, grouping);
    const infectedZone = summarizeInfectedZone(raw.InfectedZone);

    // Vendors with items for sale in this area.
    const vendors: Ref[] = [];
    const vendorTypeIds = new Set<number>();
    for (const t of Object.values(raw.NPCTypes ?? {})) {
      if (!t || !Array.isArray(t.VendorItems) || t.VendorItems.length === 0) continue;
      const canon = canonNpcId(t.ID, grouping);
      if (vendorTypeIds.has(canon)) continue;
      vendorTypeIds.add(canon);
      vendors.push({ type: 'npc', id: canon, name: t.Name ?? `NPC #${canon}`, icon: iconFor(t.Icon ?? '', iconMap) });
    }
    vendors.sort((a, b) => a.name.localeCompare(b.name));

    // Missions starting in this area: any mission whose startNPC.id is one of our canonical NPC type IDs.
    const npcIdSet = new Set(npcs.map((n) => n.ref.id as number));
    const missionsStartingMap = new Map<number, Ref>();
    for (const npcId of npcIdSet) {
      const entry = npcMissions.get(npcId);
      if (!entry) continue;
      for (const ref of entry.starts) {
        if (!missionsStartingMap.has(ref.id as number)) missionsStartingMap.set(ref.id as number, ref);
      }
    }
    const missionsStarting = [...missionsStartingMap.values()].sort(
      (a, b) => (a.id as number) - (b.id as number),
    );

    areas.push({
      id,
      name: raw.AreaName ?? fullName,
      zoneName: raw.ZoneName ?? '',
      fullName,
      x: raw.X ?? 0,
      y: raw.Y ?? 0,
      width: raw.Width ?? 0,
      height: raw.Height ?? 0,
      npcs,
      mobs,
      vendors,
      eggs,
      transportation,
      instanceWarps,
      infectedZone,
      missionsStarting,
    });
  }
  areas.sort((a, b) => a.zoneName.localeCompare(b.zoneName) || a.name.localeCompare(b.name));

  const withMissions = areas.filter((a) => a.missionsStarting.length > 0).length;
  const withTransport = areas.filter((a) => a.transportation.length > 0).length;

  // Areas are few (~70 per build) and small — single chunk per build is fine.
  const { chunks } = await writeChunks(slug, 'areas', areas, (a) => ({
    url: a.id,
    chunk: 0,
  }));
  await writeIndex(slug, 'areas', areas.map(indexEntry));

  return { count: areas.length, chunks, withMissions, withTransport };
}
