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
  AreaVendorEntry,
  Ref,
} from './types.js';
import type { IconMap } from '../icons.js';
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
  Vendors?: Record<string, RawAreaVendor>;
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
  X?: number;
  Y?: number;
  Z?: number;
  AreaZone?: string;
  InstanceID?: number;
}
interface RawVendorItem {
  ItemID?: number;
  ItemType?: string;
  ItemTypeID?: number;
  Item?: {
    Name?: string;
    Type?: string;
    TypeID?: number;
  };
  ItemInfo?: {
    Name?: string;
    Type?: string;
    TypeID?: number;
  };
}
interface RawAreaNpcType {
  ID: number;
  Name?: string;
  Icon?: string;
  Category?: string;
  VendorItems?: RawVendorItem[];
}
interface RawAreaVendor {
  NPCID?: number;
  Items?: Record<string, RawVendorItem>;
  NPCs?: Record<string, RawAreaNpc>;
}
interface RawAreaMob {
  TypeID: number;
  TypeName?: string;
  TypeIcon?: string;
  HP?: number;
  X?: number;
  Y?: number;
  Z?: number;
  AreaZone?: string;
  InstanceID?: number;
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
  AreaZone?: string;
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
  ID?: number;
  EntryInstanceID?: number;
  EntryInstance?: string;
  NPCID?: number;
  NPCTypeID?: number;
  NPCName?: string;
  NPCIcon?: string;
  NPCType?: { Name?: string; Icon?: string; Category?: string } | null;
  NPCs?: Record<string, { AreaZone?: string; InstanceID?: number; X?: number; Y?: number; Z?: number; TypeID?: number; TypeName?: string; TypeIcon?: string }>;
  RequiredItemID?: number;
  RequiredItemType?: number;
  RequiredItem?: { Name?: string; Icon?: string } | null;
  RequiredMinLevel?: number;
  RequiredMission?: string;
  RequiredMissionID?: number;
  RequiredTaskID?: number;
  RequiredTaskObjective?: string;
}

interface RawAreaInfectedZone {
  ID?: number;
  EPID?: number;
  Description?: string;
  DifficultyLabel?: string;
  RecommendedLevel?: number;
  MaxScore?: number;
}
interface RawInfectedZoneInfo {
  ID?: number;
  Name?: string;
}

interface RawTransportRoute {
  InGame?: boolean;
  MoveType?: string;
  NPCID?: number;
  NPCType?: { Name?: string; Icon?: string; Category?: string } | null;
  StartLocation?: { Name?: string; AreaZone?: string; X?: number; Y?: number; Z?: number };
  Transportations?: Record<string, {
    AreaZone?: string;
    Name?: string;
    Icon?: string;
    X?: number;
    Y?: number;
    Z?: number;
    Route?: Array<{ AreaZone?: string; X?: number; Y?: number; Z?: number; IsStopPoint?: boolean }>;
  }>;
}

interface RawInstance {
  ID?: number;
  Name?: string;
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

function hasConsistentTransportOperator(route: RawTransportRoute): boolean {
  const category = route.NPCType?.Category ?? '';
  const moveType = route.MoveType ?? '';
  return !category || !moveType || category === moveType;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function sharedInstanceLabel(instanceIds: number[], instanceIndex: Map<number, RawInstance>): { instanceID: number; instanceName: string } {
  const unique = [...new Set(instanceIds)];
  if (unique.length === 1) {
    const id = unique[0] ?? 0;
    return { instanceID: id, instanceName: instanceIndex.get(id)?.Name ?? '' };
  }
  return { instanceID: 0, instanceName: unique.length > 1 ? 'Multiple instances' : '' };
}

const OMITTED_NPC_CATEGORIES = new Set(['Location', 'NoReaction', 'Invisible', 'InvisibleWarp', 'InvisibleNoClick', 'NonCheck']);
const MAP_ICON_BASE = '/minimap/mapicons/';

function mapIcon(file: string): string {
  return `${MAP_ICON_BASE}${file}`;
}

function vendorItems(raw: RawVendorItem[] | Record<string, RawVendorItem> | undefined): RawVendorItem[] {
  return Array.isArray(raw) ? raw : Object.values(raw ?? {});
}

function itemTypeId(item: RawVendorItem): number {
  return item.ItemTypeID ?? item.Item?.TypeID ?? item.ItemInfo?.TypeID ?? -1;
}

function itemTypeName(item: RawVendorItem): string {
  return item.ItemType ?? item.Item?.Type ?? item.ItemInfo?.Type ?? '';
}

function itemName(item: RawVendorItem): string {
  return item.Item?.Name ?? item.ItemInfo?.Name ?? '';
}

function allVendorItemsAre(items: RawVendorItem[], ids: number[], names: string[] = []): boolean {
  if (items.length === 0) return false;
  const nameSet = new Set(names);
  return items.every((item) => ids.includes(itemTypeId(item)) || nameSet.has(itemTypeName(item)));
}

function vendorMapIcon(name: string, items: RawVendorItem[]): string {
  const itemNames = new Set(items.map(itemName));
  if (itemNames.has('Weapon Boost') && itemNames.has('Nano Potion')) return mapIcon('boost_potion_vendor_npc.png');
  if (name.includes('E.G.G.E.R.')) return mapIcon('egger_npc.png');
  if (allVendorItemsAre(items, [4, 5, 6], ['Hat', 'Glasses', 'Backpack', 'Face', 'Back'])) return mapIcon('accessories_vendor_npc.png');
  if (allVendorItemsAre(items, [1], ['Body'])) return mapIcon('shirt_vendor_npc.png');
  if (allVendorItemsAre(items, [2], ['Legs'])) return mapIcon('pants_vendor_npc.png');
  if (allVendorItemsAre(items, [3], ['Shoes'])) return mapIcon('shoes_vendor_npc.png');
  if (allVendorItemsAre(items, [0], ['Weapon'])) return mapIcon('weapon_vendor_npc.png');
  if (allVendorItemsAre(items, [10], ['Vehicle'])) return mapIcon('vehicle_vendor_npc.png');
  return mapIcon('other_vendor_npc.png');
}

function npcMapIcon(category: string, name: string, items: RawVendorItem[], canStartMission: boolean): string {
  if (items.length > 0 || category === 'Vendor') return vendorMapIcon(name, items);
  if (name === "Resurrect 'Em") return mapIcon('resurrect_em_npc.png');
  if (category === 'Location') return mapIcon('location_npc.png');
  if (category === 'Bank' || name.includes('Bank')) return mapIcon('bank_npc.png');
  if (category === 'Combi') return mapIcon('combination_npc.png');
  if (category === 'Defense') return mapIcon('defense_npc.png');
  if (name === 'Guide Changer') return mapIcon('guide_changer_npc.png');
  if (canStartMission) return mapIcon('mission_start_npc.png');
  if (category === 'StartEcom') return mapIcon('race_start_sact_npc.png');
  if (category === 'EndEcom') return mapIcon('race_end_sact_npc.png');
  if (category === 'SCAMPER') return mapIcon('scamper_npc.png');
  if (category === 'MonkeySkyway') return mapIcon('monkey_skyway_npc.png');
  if (category === 'RXcom') return mapIcon('recall_point_npc.png');
  if (category === 'Warp') return mapIcon('warp_npc.png');
  if (category === 'NanoTuneMachine') return mapIcon('nano_station_npc.png');
  return mapIcon('generic_npc.png');
}
/** Aggregate NPC instances by type ID. */
function buildAreaNpcs(
  npcs: Record<string, RawAreaNpc> | undefined,
  npcTypes: Record<string, RawAreaNpcType> | undefined,
  iconMap: IconMap,
  areaId: string,
  fullName: string,
  instanceIndex: Map<number, RawInstance>,
  npcMissions: NpcMissionsMap,
  vendorIndex: Map<number, { items: RawVendorItem[] }>,
): AreaNpcEntry[] {
  const counts = new Map<number, { name: string; icon: string; category: string; vendorItems: RawVendorItem[]; points: RawAreaNpc[] }>();
  for (const inst of Object.values(npcs ?? {})) {
    if (!inst || typeof inst !== 'object') continue;
    const tid = inst.TypeID;
    const meta = npcTypes?.[String(tid)];
    const name = meta?.Name ?? inst.TypeName ?? `NPC #${tid}`;
    const icon = iconFor(meta?.Icon ?? inst.TypeIcon ?? '', iconMap);
    const category = meta?.Category ?? '';
    const items = vendorIndex.get(tid)?.items ?? vendorItems(meta?.VendorItems);
    const cur = counts.get(tid);
    if (cur) cur.points.push(inst);
    else counts.set(tid, { name, icon, category, vendorItems: items, points: [inst] });
  }
  return [...counts.entries()]
    .map(([id, { name, icon, category, vendorItems: items, points }]) => {
      const instance = sharedInstanceLabel(points.map((p) => p.InstanceID ?? 0), instanceIndex);
      const canStartMission = (npcMissions.get(id)?.starts.length ?? 0) > 0;
      return {
        ref: { type: 'npc' as const, id, name, icon },
        category,
        mapIcon: npcMapIcon(category, name, items, canStartMission),
        showOnMap: !OMITTED_NPC_CATEGORIES.has(category),
        instanceCount: points.length,
        x: median(points.map((p) => p.X ?? 0)),
        y: median(points.map((p) => p.Y ?? 0)),
        z: median(points.map((p) => p.Z ?? 0)),
        areaId,
        areaZone: points[0]?.AreaZone ?? fullName,
        ...instance,
        points: points.map((p) => ({ x: p.X ?? 0, y: p.Y ?? 0 })),
      };
    })
    .sort((a, b) => b.instanceCount - a.instanceCount || a.ref.name.localeCompare(b.ref.name));
}

function buildVendorIndex(vendors: Record<string, RawAreaVendor> | undefined, fullName = ''): Map<number, { items: RawVendorItem[]; points: RawAreaNpc[] }> {
  const out = new Map<number, { items: RawVendorItem[]; points: RawAreaNpc[] }>();
  for (const raw of Object.values(vendors ?? {})) {
    if (!raw || typeof raw !== 'object') continue;
    const npcId = raw.NPCID ?? Object.values(raw.NPCs ?? {})[0]?.TypeID ?? 0;
    if (npcId <= 0) continue;
    const cur = out.get(npcId);
    const allPoints = Object.values(raw.NPCs ?? {}).filter((npc): npc is RawAreaNpc => Boolean(npc));
    const points = fullName ? allPoints.filter((npc) => npc.AreaZone === fullName) : allPoints;
    if (points.length === 0) continue;
    if (cur) cur.points.push(...points);
    else out.set(npcId, { items: vendorItems(raw.Items), points });
  }
  return out;
}

function buildAreaVendors(
  vendors: Record<string, RawAreaVendor> | undefined,
  npcTypes: Record<string, RawAreaNpcType> | undefined,
  iconMap: IconMap,
  areaId: string,
  fullName: string,
  instanceIndex: Map<number, RawInstance>,
  npcMissions: NpcMissionsMap,
): AreaVendorEntry[] {
  const vendorIndex = buildVendorIndex(vendors, fullName);
  return [...vendorIndex.entries()]
    .map(([id, { items, points }]) => {
      const meta = npcTypes?.[String(id)];
      const first = points[0];
      const name = meta?.Name ?? first?.TypeName ?? `NPC #${id}`;
      const category = meta?.Category ?? 'Vendor';
      const icon = iconFor(meta?.Icon ?? first?.TypeIcon ?? '', iconMap);
      const instance = sharedInstanceLabel(points.map((p) => p.InstanceID ?? 0), instanceIndex);
      const canStartMission = (npcMissions.get(id)?.starts.length ?? 0) > 0;
      return {
        ref: { type: 'npc' as const, id, name, icon },
        category,
        mapIcon: npcMapIcon(category, name, items, canStartMission),
        showOnMap: !OMITTED_NPC_CATEGORIES.has(category),
        instanceCount: points.length,
        x: median(points.map((p) => p.X ?? 0)),
        y: median(points.map((p) => p.Y ?? 0)),
        z: median(points.map((p) => p.Z ?? 0)),
        areaId,
        areaZone: first?.AreaZone ?? fullName,
        ...instance,
        points: points.map((p) => ({ x: p.X ?? 0, y: p.Y ?? 0 })),
      };
    })
    .sort((a, b) => a.ref.name.localeCompare(b.ref.name));
}

function monsterMapIcon(name: string): string {
  return name.includes('Fusion') && !name.includes('Fusion Spawn')
    ? mapIcon('lair_fusion_boss_monster.png')
    : mapIcon('other_monster.png');
}

function buildAreaMobs(
  mobs: Record<string, RawAreaMob> | undefined,
  mobTypes: Record<string, RawAreaMobType> | undefined,
  iconMap: IconMap,
  areaId: string,
  fullName: string,
  instanceIndex: Map<number, RawInstance>,
): AreaMobEntry[] {
  const counts = new Map<number, { name: string; icon: string; level: number; hp: number; points: RawAreaMob[] }>();
  for (const inst of Object.values(mobs ?? {})) {
    if (!inst || typeof inst !== 'object') continue;
    const tid = inst.TypeID;
    const meta = mobTypes?.[String(tid)];
    const name = meta?.Name ?? inst.TypeName ?? `Mob #${tid}`;
    const icon = iconFor(meta?.Icon ?? inst.TypeIcon ?? '', iconMap);
    const cur = counts.get(tid);
    if (cur) cur.points.push(inst);
    else counts.set(tid, {
      name,
      icon,
      level: meta?.Level ?? 0,
      hp: meta?.StandardHP ?? inst.HP ?? 0,
      points: [inst],
    });
  }
  return [...counts.entries()]
    .map(([id, { name, icon, level, hp, points }]) => {
      const instance = sharedInstanceLabel(points.map((p) => p.InstanceID ?? 0), instanceIndex);
      return {
        ref: { type: 'monster' as const, id, name, icon },
        mapIcon: monsterMapIcon(name),
        instanceCount: points.length,
        level,
        hp,
        x: median(points.map((p) => p.X ?? 0)),
        y: median(points.map((p) => p.Y ?? 0)),
        z: median(points.map((p) => p.Z ?? 0)),
        areaId,
        areaZone: points[0]?.AreaZone ?? fullName,
        ...instance,
        points: points.map((p) => ({ x: p.X ?? 0, y: p.Y ?? 0 })),
      };
    })
    .sort((a, b) => a.level - b.level || a.ref.name.localeCompare(b.ref.name));
}

function buildAreaEggs(
  eggs: Record<string, RawAreaEgg> | undefined,
  eggTypes: Record<string, RawAreaEggType> | undefined,
  iconMap: IconMap,
  areaId: string,
  fullName: string,
  instanceIndex: Map<number, RawInstance>,
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
      areaId,
      areaZone: inst.AreaZone ?? fullName,
      instanceID: inst.InstanceID ?? 0,
      instanceName: instanceIndex.get(inst.InstanceID ?? 0)?.Name ?? '',
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
    if (!route || !route.InGame || !hasConsistentTransportOperator(route)) continue;
    const routeId = parseInt(rid, 10);
    const startNpc: Ref | null = route.NPCID && route.NPCID > 0 && route.NPCType
      ? { type: 'npc', id: route.NPCID, name: route.NPCType.Name ?? `NPC #${route.NPCID}`, icon: iconFor(route.NPCType.Icon ?? '', iconMap) }
      : null;

    for (const sub of Object.values(route.Transportations ?? {})) {
      const stopsRaw = sub.Route ?? [];
      const visibleStopsRaw = route.MoveType === 'SCAMPER'
        ? [
            route.StartLocation ? { ...route.StartLocation, IsStopPoint: true } : null,
            { AreaZone: sub.AreaZone, X: sub.X, Y: sub.Y, Z: sub.Z, IsStopPoint: true },
          ]
        : route.MoveType === 'Slider'
          ? stopsRaw.filter((s) => s.IsStopPoint)
          : stopsRaw.length > 1 ? [stopsRaw[0], stopsRaw[stopsRaw.length - 1]] : stopsRaw;
      const stops = visibleStopsRaw
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => ({
          areaZone: s.AreaZone ?? '',
          areaId: s.AreaZone ? slugify(s.AreaZone) : '',
          x: s.X ?? 0,
          y: s.Y ?? 0,
          z: s.Z ?? 0,
          isHere: false,
          isStopPoint: s.IsStopPoint ?? false,
        }));
      const routePointsRaw = route.MoveType === 'Slider' && stopsRaw.length > 0 ? stopsRaw : visibleStopsRaw;
      const routePoints = routePointsRaw
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((s) => ({
          areaZone: s.AreaZone ?? '',
          areaId: s.AreaZone ? slugify(s.AreaZone) : '',
          x: s.X ?? 0,
          y: s.Y ?? 0,
          z: s.Z ?? 0,
          isStopPoint: s.IsStopPoint ?? false,
        }));
      const zones = route.MoveType === 'Slider'
        ? new Set(stops.map((s) => s.areaZone).filter(Boolean))
        : new Set(stops[0]?.areaZone ? [stops[0].areaZone] : []);
      for (const z of zones) {
        let list = out.get(z);
        if (!list) {
          list = [];
          out.set(z, list);
        }
        list.push({
          routeId,
          routeName: sub.Name || route.MoveType || `Route ${routeId}`,
          moveType: route.MoveType ?? '',
          startNpc,
          stops: stops.map((s) => ({ ...s, isHere: s.areaZone === z })),
          routePoints,
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
  missionLevels: Map<number, number>,
): AreaInstanceWarp[] {
  const out: AreaInstanceWarp[] = [];
  for (const w of Object.values(warps ?? {})) {
    if (!w || typeof w !== 'object') continue;
    const instId = w.EntryInstanceID ?? 0;
    const entryNpcs = Object.values(w.NPCs ?? {});
    const inst = instanceIndex.get(instId);
    const entryNpc = entryNpcs[0];
    const npcId = w.NPCID && w.NPCID > 0 ? w.NPCID : w.NPCTypeID && w.NPCTypeID > 0 ? w.NPCTypeID : entryNpc?.TypeID ?? 0;
    const npc: Ref | null = npcId > 0
      ? {
        type: 'npc',
        id: npcId,
        name: w.NPCType?.Name ?? w.NPCName ?? entryNpc?.TypeName ?? `NPC #${npcId}`,
        icon: iconFor(w.NPCType?.Icon ?? w.NPCIcon ?? entryNpc?.TypeIcon ?? '', iconMap),
      }
      : null;
    const requiredItem: Ref | null = w.RequiredItemID && w.RequiredItemID > 0
      ? itemRef(w.RequiredItemType ?? 0, w.RequiredItemID, w.RequiredItem?.Name ?? '', w.RequiredItem?.Icon ?? '', iconMap)
      : null;
    const requiredMission: Ref | null = w.RequiredMissionID && w.RequiredMissionID > 0
      ? { type: 'mission', id: w.RequiredMissionID, name: w.RequiredMission || `Mission #${w.RequiredMissionID}` }
      : null;
    const entryAreaZone = entryNpc?.AreaZone ?? '';
    const entryInstanceID = entryNpc?.InstanceID ?? 0;
    out.push({
      id: w.ID ?? 0,
      instance: { type: 'instance', id: instId, name: inst?.Name ?? w.EntryInstance ?? `Instance ${instId}` },
      instanceID: instId,
      instanceName: inst?.Name ?? w.EntryInstance ?? `Instance ${instId}`,
      npc,
      entryLocation: entryNpc ? {
        areaZone: entryAreaZone,
        areaId: entryAreaZone && entryAreaZone !== 'Unknown - Unknown' ? slugify(entryAreaZone) : '',
        x: entryNpc.X ?? 0,
        y: entryNpc.Y ?? 0,
        z: entryNpc.Z ?? 0,
        instanceID: entryInstanceID,
        instanceName: instanceIndex.get(entryInstanceID)?.Name ?? '',
      } : null,
      requiredItem,
      requiredMission,
      requiredTaskId: w.RequiredTaskID ?? 0,
      requiredTaskObjective: w.RequiredTaskObjective ?? '',
      requiredMinLevel: w.RequiredMinLevel && w.RequiredMinLevel > 0
        ? w.RequiredMinLevel
        : missionLevels.get(w.RequiredMissionID ?? 0) ?? 0,
    });
  }
  return out;
}

function buildInfectedZoneIndex(zip: AdmZip): Map<number, { name: string; icon: string }> {
  const out = new Map<number, { name: string; icon: string }>();
  const entry = zip.getEntry('info/infected_zone_info.json');
  if (!entry) return out;
  const raw = JSON.parse(entry.getData().toString('utf8')) as Record<string, RawInfectedZoneInfo>;
  for (const row of Object.values(raw)) {
    const id = row.ID ?? 0;
    if (id <= 0) continue;
    out.set(id, {
      name: row.Name ?? `Infected Zone #${id}`,
      icon: `/ui/ep/ep_big_${String(id).padStart(2, '0')}.png`,
    });
  }
  return out;
}

function summarizeInfectedZone(
  iz: RawAreaInfectedZone | null | undefined,
  infectedZones: Map<number, { name: string; icon: string }>,
): AreaInfectedZoneSummary | null {
  if (!iz || typeof iz !== 'object') return null;
  const id = iz.ID ?? iz.EPID ?? 0;
  if (!id) return null;
  const info = infectedZones.get(id);
  const name = info?.name ?? `Infected Zone #${id}`;
  const icon = info?.icon ?? '';
  return {
    iznId: id,
    name,
    icon,
    ref: { type: 'infected-zone', id, name, icon },
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
  npcMissions: NpcMissionsMap,
  missionLevels: Map<number, number>,
): Promise<{ count: number; chunks: number; withMissions: number; withTransport: number }> {
  const zip = new AdmZip(zipPath);
  const areaEntry = zip.getEntry('info/area_info.json');
  if (!areaEntry) return { count: 0, chunks: 0, withMissions: 0, withTransport: 0 };

  const rawAreas = JSON.parse(areaEntry.getData().toString('utf8')) as Record<string, RawAreaInfo[]>;
  const infectedZones = buildInfectedZoneIndex(zip);

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
    const vendorIndex = buildVendorIndex(raw.Vendors, fullName);
    const npcs = buildAreaNpcs(raw.NPCs, raw.NPCTypes, iconMap, id, fullName, instanceIndex, npcMissions, vendorIndex);
    const mobs = buildAreaMobs(raw.Mobs, raw.MobTypes, iconMap, id, fullName, instanceIndex);
    const vendors = buildAreaVendors(raw.Vendors, raw.NPCTypes, iconMap, id, fullName, instanceIndex, npcMissions);
    const eggs = buildAreaEggs(raw.Eggs, raw.EggTypes, iconMap, id, fullName, instanceIndex);
    const transportation = transportIndex.get(fullName) ?? [];
    const instanceWarps = buildAreaInstanceWarps(raw.InstanceWarps, instanceIndex, iconMap, missionLevels);
    const infectedZone = summarizeInfectedZone(raw.InfectedZone, infectedZones);

    // Missions starting in this area: any mission whose startNPC.id is one of our NPC type IDs.
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
    const missionStarts = npcs.flatMap((n) => {
      const entry = npcMissions.get(n.ref.id as number);
      if (!entry) return [];
      return entry.starts.map((mission) => ({
        mission,
        npc: n.ref,
        x: n.x,
        y: n.y,
        z: n.z,
        areaId: n.areaId,
        areaZone: n.areaZone,
        instanceID: n.instanceID,
        instanceName: n.instanceName,
      }));
    }).sort((a, b) => (a.mission.id as number) - (b.mission.id as number));

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
      missionStarts,
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
