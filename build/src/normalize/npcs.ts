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

function normalizeNpc(
  raw: RawNpcType,
  instances: Record<string, RawNpcInstance> | undefined,
  iconMap: IconMap,
  npcMissions: NpcMissionsMap,
): Npc {
  const locations = Object.values(instances ?? {}).map(normalizeLocation);
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
 * Read npc_type_info.json + npc_info.json from a cached ZIP, normalize every
 * NPC type with its world instances, and emit chunked records + an index.
 */
export async function normalizeNpcs(
  zipPath: string,
  slug: string,
  iconMap: IconMap,
  npcMissions: NpcMissionsMap,
): Promise<{ count: number; chunks: number; vendors: number; linked: number }> {
  const zip = new AdmZip(zipPath);
  const typeEntry = zip.getEntry('info/npc_type_info.json');
  const instEntry = zip.getEntry('info/npc_info.json');
  if (!typeEntry) {
    return { count: 0, chunks: 0, vendors: 0, linked: 0 };
  }
  const rawTypes = JSON.parse(typeEntry.getData().toString('utf8')) as Record<string, RawNpcType>;
  const rawInsts = instEntry
    ? (JSON.parse(instEntry.getData().toString('utf8')) as Record<string, Record<string, RawNpcInstance>>)
    : {};

  const npcs: Npc[] = Object.values(rawTypes)
    .map((t) => normalizeNpc(t, rawInsts[String(t.ID)], iconMap, npcMissions))
    .sort((a, b) => a.id - b.id);

  const vendors = npcs.filter((n) => n.vendorItems.length > 0).length;
  const linked = npcs.filter(
    (n) => n.startedMissions.length || n.journaledMissions.length || n.endedMissions.length,
  ).length;

  const { chunks } = await writeChunks(slug, 'npcs', npcs);
  await writeIndex(slug, 'npcs', npcs.map(indexEntry));

  return { count: npcs.length, chunks, vendors, linked };
}
