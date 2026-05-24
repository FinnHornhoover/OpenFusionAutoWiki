import AdmZip from 'adm-zip';

import { writeChunks, writeIndex } from '../chunk.js';
import { iconFor, itemRef, parseCompoundKey } from './refs.js';
import type {
  Npc,
  NpcIndexEntry,
  NpcLocation,
  NpcVendorItem,
  Ref,
} from './types.js';
import type { IconMap } from '../icons.js';
import type { NpcMissionsMap } from './missions.js';
import type { NpcGrouping } from './npcGrouping.js';

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

function normalizeLocation(raw: RawNpcInstance): NpcLocation {
  return {
    areaZone: raw.AreaZone ?? '',
    x: raw.X ?? 0,
    y: raw.Y ?? 0,
    z: raw.Z ?? 0,
    instanceID: raw.InstanceID ?? 0,
  };
}

function normalizeVendorItems(raw: RawNpcType, iconMap: IconMap): NpcVendorItem[] {
  const out: NpcVendorItem[] = [];
  for (const v of raw.VendorItems ?? []) {
    const info = v.ItemInfo;
    if (!info) continue;
    const ref = itemRef(info.ItemID, info.Name ?? '', info.Icon ?? '', iconMap);
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
): Npc {
  const allMembers = [canonical, ...aliases];

  const idleBarkers = new Set<string>();
  const missionBarkersBy = new Map<number, { mission: Ref; text: string }>();
  const vendorBy = new Map<number, NpcVendorItem>();
  const locations: NpcLocation[] = [];

  for (const member of allMembers) {
    for (const s of member.Barkers ?? []) {
      const t = s.trim();
      if (t) idleBarkers.add(t);
    }
    for (const mb of normalizeMissionBarkers(member)) {
      if (!missionBarkersBy.has(mb.mission.id)) missionBarkersBy.set(mb.mission.id, mb);
    }
    for (const v of normalizeVendorItems(member, iconMap)) {
      if (!vendorBy.has(v.ref.id)) vendorBy.set(v.ref.id, v);
    }
    const insts = rawInsts[String(member.ID)] ?? {};
    for (const inst of Object.values(insts)) locations.push(normalizeLocation(inst));
  }

  const aliasIds = aliases.map((a) => a.ID).sort((a, b) => a - b);
  const missions = npcMissions.get(canonical.ID);

  return {
    id: canonical.ID,
    name: canonical.Name,
    icon: iconFor(canonical.Icon ?? '', iconMap),
    category: canonical.Category ?? '',
    comment: canonical.Comment ?? '',
    inGame: canonical.InGame ?? false,
    height: canonical.Height ?? 0,
    scale: canonical.Scale ?? 1,

    idleBarkers: [...idleBarkers],
    missionBarkers: [...missionBarkersBy.values()],

    vendorItems: [...vendorBy.values()],

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
): Npc {
  const locations = Object.values(rawInsts[String(raw.ID)] ?? {}).map(normalizeLocation);
  const missions = npcMissions.get(raw.ID);
  return {
    id: raw.ID,
    name: raw.Name,
    icon: iconFor(raw.Icon ?? '', iconMap),
    category: raw.Category ?? '',
    comment: raw.Comment ?? '',
    inGame: raw.InGame ?? false,
    height: raw.Height ?? 0,
    scale: raw.Scale ?? 1,
    idleBarkers: (raw.Barkers ?? []).map((s) => s.trim()).filter(Boolean),
    missionBarkers: normalizeMissionBarkers(raw),
    vendorItems: normalizeVendorItems(raw, iconMap),
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
): Promise<{ count: number; chunks: number; vendors: number; linked: number; merged: number }> {
  const zip = new AdmZip(zipPath);
  const typeEntry = zip.getEntry('info/npc_type_info.json');
  const instEntry = zip.getEntry('info/npc_info.json');
  if (!typeEntry) {
    return { count: 0, chunks: 0, vendors: 0, linked: 0, merged: 0 };
  }
  const rawTypes = JSON.parse(typeEntry.getData().toString('utf8')) as Record<string, RawNpcType>;
  const rawInsts = instEntry
    ? (JSON.parse(instEntry.getData().toString('utf8')) as Record<string, Record<string, RawNpcInstance>>)
    : {};

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
      npcs.push(buildMergedNpc(t, aliases, rawInsts, iconMap, npcMissions));
    } else {
      // Out-of-game: kept as solo, no grouping applied.
      npcs.push(buildSoloNpc(t, rawInsts, iconMap, npcMissions));
    }
  }
  npcs.sort((a, b) => a.id - b.id);

  const vendors = npcs.filter((n) => n.vendorItems.length > 0).length;
  const linked = npcs.filter(
    (n) => n.startedMissions.length || n.journaledMissions.length || n.endedMissions.length,
  ).length;

  const { chunks } = await writeChunks(slug, 'npcs', npcs);
  await writeIndex(slug, 'npcs', npcs.map(indexEntry));

  return { count: npcs.length, chunks, vendors, linked, merged: mergedCount };
}
