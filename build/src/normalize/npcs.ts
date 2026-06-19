import AdmZip from 'adm-zip';

import { chunkOf, writeChunks, writeIndex } from '../chunk.js';
import { iconFor, itemRef, parseCompoundKey } from './refs.js';
import type {
  Npc,
  NpcAmbiguity,
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

const MAP_ICON_BASE = '/minimap/mapicons/';

function mapIcon(file: string): string {
  return `${MAP_ICON_BASE}${file}`;
}

function allVendorItemsAre(raw: RawNpcType, kinds: string[]): boolean {
  const items = (raw.VendorItems ?? []).map((v) => v.ItemInfo).filter(Boolean);
  return items.length > 0 && items.every((item) => kinds.includes(item?.Type ?? ''));
}

function npcMapIcon(raw: RawNpcType, canStartMission: boolean): string {
  const category = raw.Category ?? '';
  const name = raw.Name ?? '';
  const itemNames = new Set((raw.VendorItems ?? []).map((v) => v.ItemInfo?.Name ?? ''));
  if ((raw.VendorItems ?? []).length > 0 || category === 'Vendor') {
    if (itemNames.has('Weapon Boost') && itemNames.has('Nano Potion')) return mapIcon('boost_potion_vendor_npc.png');
    if (name.includes('E.G.G.E.R.')) return mapIcon('egger_npc.png');
    if (allVendorItemsAre(raw, ['Hat', 'Glasses', 'Backpack', 'Face', 'Back'])) return mapIcon('accessories_vendor_npc.png');
    if (allVendorItemsAre(raw, ['Body'])) return mapIcon('shirt_vendor_npc.png');
    if (allVendorItemsAre(raw, ['Legs'])) return mapIcon('pants_vendor_npc.png');
    if (allVendorItemsAre(raw, ['Shoes'])) return mapIcon('shoes_vendor_npc.png');
    if (allVendorItemsAre(raw, ['Weapon'])) return mapIcon('weapon_vendor_npc.png');
    if (allVendorItemsAre(raw, ['Vehicle'])) return mapIcon('vehicle_vendor_npc.png');
    return mapIcon('other_vendor_npc.png');
  }
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
  const mapIcon = npcMapIcon(raw, (missions?.starts.length ?? 0) > 0);
  return {
    id: raw.ID,
    name: raw.Name,
    icon: iconFor(raw.Icon ?? '', iconMap),
    mapIcon,
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

function trimmedNpcName(n: Npc): string {
  return n.name.trim() || `NPC #${n.id}`;
}

type NpcStatus = 'in-game' | 'out-of-game' | 'mixed';

function aggregateStatus(npcs: Npc[]): NpcStatus {
  const inGame = npcs.some((n) => n.inGame);
  const outOfGame = npcs.some((n) => !n.inGame);
  if (inGame && outOfGame) return 'mixed';
  return inGame ? 'in-game' : 'out-of-game';
}

function aggregateCategories(npcs: Npc[]): string[] {
  return Array.from(new Set(npcs.map((n) => n.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function aggregateCategory(npcs: Npc[]): string {
  const categories = aggregateCategories(npcs);
  if (categories.length === 0) return '';
  return categories.length === 1 ? categories[0] : 'Mixed';
}

function indexEntryForGroup(name: string, npcs: Npc[]): NpcIndexEntry {
  const first = npcs[0];
  const status = aggregateStatus(npcs);
  return {
    id: npcs.length === 1 ? first.id : slugify(name),
    name,
    icon: first.icon,
    category: aggregateCategory(npcs),
    categories: aggregateCategories(npcs),
    instanceCount: npcs.reduce((sum, n) => sum + n.locations.length, 0),
    inGame: status !== 'out-of-game',
    status,
    idCount: npcs.length,
    transportRouteCount: npcs.reduce((sum, n) => sum + n.transportRoutes.length, 0),
    startedMissionCount: npcs.reduce((sum, n) => sum + n.startedMissions.length, 0),
    members: npcs.map((n) => ({ id: n.id, category: n.category, inGame: n.inGame })),
  };
}

function groupedNpcsByName(npcs: Npc[]): Map<string, Npc[]> {
  const groups = new Map<string, Npc[]>();
  for (const npc of npcs) {
    const name = trimmedNpcName(npc);
    const group = groups.get(name) ?? [];
    group.push(npc);
    groups.set(name, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.id - b.id);
  }
  return groups;
}

function buildNpcAmbiguities(groups: Map<string, Npc[]>): NpcAmbiguity[] {
  const out: NpcAmbiguity[] = [];
  for (const [name, group] of groups) {
    if (group.length < 2) continue;
    const first = group[0];
    const status = aggregateStatus(group);
    out.push({
      kind: 'npc-ambiguity',
      id: slugify(name),
      name,
      icon: first.icon,
      category: aggregateCategory(group),
      inGame: status !== 'out-of-game',
      status,
      members: group.map((n) => ({
        id: n.id,
        name: trimmedNpcName(n),
        icon: n.icon,
        mapIcon: n.mapIcon,
        category: n.category,
        inGame: n.inGame,
        transportRouteCount: n.transportRoutes.length,
        startedMissionCount: n.startedMissions.length,
        spawnCount: n.locations.length,
        firstLocation: n.locations[0] ?? null,
      })),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function buildNpcIndex(npcs: Npc[]): NpcIndexEntry[] {
  return Array.from(groupedNpcsByName(npcs), ([name, group]) => indexEntryForGroup(name, group))
    .sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Read npc_type_info.json + npc_info.json, normalize every NPC type with its
 * world instances, and emit exact NPC pages plus duplicate-name ambiguity pages.
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

  const groups = groupedNpcsByName(npcs);
  const ambiguities = buildNpcAmbiguities(groups);
  const npcRecords: Array<Npc | NpcAmbiguity> = [...npcs, ...ambiguities];

  const { chunks } = await writeChunks(slug, 'npcs', npcRecords, (n) => ({
    url: n.id,
    chunk: typeof n.id === 'number' ? chunkOf(n.id) : 0,
  }));
  await writeIndex(slug, 'npcs', buildNpcIndex(npcs));

  return { count: npcs.length, chunks, vendors, linked };
}
