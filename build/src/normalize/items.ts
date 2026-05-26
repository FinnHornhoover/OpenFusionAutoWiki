import AdmZip from 'adm-zip';

import { chunkOf, writeChunks, writeIndex } from '../chunk.js';
import { iconFor, itemChunkKey, itemRef, missionRef, monsterRef, npcRef } from './refs.js';
import { slugify } from './slug.js';
import type {
  Item,
  ItemIndexEntry,
  CrateDrop,
  ItemSource,
  MobDrop,
  Ref,
} from './types.js';
import type { IconMap } from '../icons.js';
import type { InstanceNameIndex } from './instanceLookup.js';

/** Back-reference: items dropped by a specific mob type, with full drop context. */
export type MobItemsMap = Map<number, MobDrop[]>;

interface RawItem {
  ID: string;
  TypeID: number;
  ItemID: number;
  Type: string;
  Name: string;
  Icon?: string;
  Description?: string;
  DisplayType?: string;
  Rarity?: string;
  ContentLevel?: number;
  RequiredLevel?: number;
  Gender?: string;
  ItemPrice?: number;
  ItemSellPrice?: number;
  MaxStack?: number;
  Tradeable?: boolean;
  Sellable?: boolean;
  Obtainable?: boolean;
  SingleDamage?: number;
  MultiDamage?: number;
  NumberOfTargets?: number;
  Range?: string;
  RangeValue?: number;
  ConeAngle?: number;
  FireDelayTime?: number;
  FireDeliverTime?: number;
  FireDurationTime?: number;
  FireInitialTime?: number;
  RateOfFire?: number;
  Defense?: number;
  VehicleClass?: number;
  WeaponType?: string;
}

interface RawMobSource {
  AreaZone?: string;
  MobTypeID?: number;
  MobName?: string;
  MobIcon?: string;
  Icon?: string;
}
interface RawMissionSource {
  AreaZone?: string;
  MissionID?: number;
  MissionName?: string;
  MissionItemRewardSelectionNeeded?: boolean;
  NPCTypeID?: number;
  NPCName?: string;
  NPCIcon?: string;
}
interface RawVendorSource {
  AreaZone?: string;
  NPCTypeID?: number;
  NPCName?: string;
  NPCIcon?: string;
  Price?: number;
}
interface RawEggSource {
  AreaZone?: string;
  EggID?: string;
  EggName?: string;
  EggComment?: string;
  InstanceID?: number;
  X?: number;
  Y?: number;
  Z?: number;
}
interface RawRacingSource {
  AreaZone?: string;
  InstanceName?: string;
  NPCTypeID?: number;
  NPCName?: string;
  NPCIcon?: string;
  RequiredScore?: number;
  RequiredStars?: number;
}
interface RawEventSource {
  EventID?: number;
  EventName?: string;
}

interface RawSourceEntry {
  SourceType: string;
  Source?: RawMobSource | RawMissionSource | RawVendorSource | RawEggSource | RawRacingSource | RawEventSource | { Code?: string };
  /** Per-character full-chain probability (mob → crate → rarity → gender). 0 when N/A. */
  SourceBoyProbability?: number;
  SourceBoyOdds?: string;
  SourceGirlProbability?: number;
  SourceGirlOdds?: string;
}

function chance(entry: RawSourceEntry): {
  boyProbability: number;
  boyOdds: string;
  girlProbability: number;
  girlOdds: string;
} {
  return {
    boyProbability: entry.SourceBoyProbability ?? 0,
    boyOdds: entry.SourceBoyOdds ?? '',
    girlProbability: entry.SourceGirlProbability ?? 0,
    girlOdds: entry.SourceGirlOdds ?? '',
  };
}


interface RawCrateDrop {
  Item?: RawItem;
  ContainingCrate?: RawItem;
  BoyProbability?: number;
  BoyOdds?: string;
  GirlProbability?: number;
  GirlOdds?: string;
}

type RawCrateToItemInfo = Record<string, RawCrateDrop[]>;
type RawItemToCrateInfo = Record<string, RawCrateDrop[]>;

function rawInfoKey(key: string): string | null {
  const m = /^(\d+)::(\d+)/.exec(key);
  if (!m) return null;
  return `${parseInt(m[1], 10)}::${parseInt(m[2], 10)}`;
}

function buildCrateDrops(
  rawCrateItems: RawCrateToItemInfo,
  iconMap: IconMap,
): Map<string, CrateDrop[]> {
  const byCrate = new Map<string, CrateDrop[]>();

  for (const [crateId, entries] of Object.entries(rawCrateItems)) {
    const rawCrateKey = `9::${parseInt(crateId, 10)}`;
    let list = byCrate.get(rawCrateKey);
    if (!list) {
      list = [];
      byCrate.set(rawCrateKey, list);
    }

    for (const entry of entries) {
      const raw = entry.Item;
      if (!raw) continue;
      const ref = itemRef(raw.TypeID, raw.ItemID, raw.Name, raw.Icon ?? '', iconMap);
      if (!ref) continue;
      const drop: CrateDrop = {
        ref,
        boyProbability: entry.BoyProbability ?? 0,
        boyOdds: entry.BoyOdds ?? '',
        girlProbability: entry.GirlProbability ?? 0,
        girlOdds: entry.GirlOdds ?? '',
      };
      if (!list.some((d) => d.ref.id === drop.ref.id && d.boyOdds === drop.boyOdds && d.girlOdds === drop.girlOdds)) {
        list.push(drop);
      }
    }
  }

  for (const list of byCrate.values()) {
    list.sort((a, b) => {
      const pa = Math.max(a.boyProbability, a.girlProbability);
      const pb = Math.max(b.boyProbability, b.girlProbability);
      return (pb - pa) || a.ref.name.localeCompare(b.ref.name);
    });
  }

  return byCrate;
}

function buildContainingCrates(
  rawItemCrates: RawItemToCrateInfo,
  iconMap: IconMap,
): Map<string, CrateDrop[]> {
  const byItem = new Map<string, CrateDrop[]>();

  for (const [itemKey, entries] of Object.entries(rawItemCrates)) {
    const rawItemKey = rawInfoKey(itemKey);
    if (!rawItemKey) continue;

    let list = byItem.get(rawItemKey);
    if (!list) {
      list = [];
      byItem.set(rawItemKey, list);
    }

    for (const entry of entries) {
      const raw = entry.ContainingCrate;
      if (!raw) continue;
      const ref = itemRef(raw.TypeID, raw.ItemID, raw.Name, raw.Icon ?? '', iconMap);
      if (!ref) continue;
      const crate: CrateDrop = {
        ref,
        boyProbability: entry.BoyProbability ?? 0,
        boyOdds: entry.BoyOdds ?? '',
        girlProbability: entry.GirlProbability ?? 0,
        girlOdds: entry.GirlOdds ?? '',
      };
      if (!list.some((d) => d.ref.id === crate.ref.id && d.boyOdds === crate.boyOdds && d.girlOdds === crate.girlOdds)) {
        list.push(crate);
      }
    }
  }

  for (const list of byItem.values()) {
    list.sort((a, b) => {
      const pa = Math.max(a.boyProbability, a.girlProbability);
      const pb = Math.max(b.boyProbability, b.girlProbability);
      return (pb - pa) || a.ref.name.localeCompare(b.ref.name);
    });
  }

  return byItem;
}

function normalizeSource(
  entry: RawSourceEntry,
  iconMap: IconMap,
  instanceNames: InstanceNameIndex,
): ItemSource | null {
  const s = entry.Source ?? {};
  switch (entry.SourceType) {
    case 'Mob': {
      const m = s as RawMobSource;
      const ref = monsterRef(m.MobTypeID ?? 0, m.MobName ?? '');
      if (!ref) return null;
      ref.icon = iconFor(m.MobIcon ?? m.Icon ?? '', iconMap);
      return {
        kind: 'mob',
        mob: ref,
        areaZone: m.AreaZone ?? '',
        ...chance(entry),
      };
    }
    case 'MissionReward': {
      const m = s as RawMissionSource;
      const mission = missionRef(m.MissionID ?? 0, m.MissionName ?? '');
      if (!mission) return null;
      const npc = npcRef(m.NPCTypeID ?? 0, m.NPCName ?? '', m.NPCIcon ?? '', iconMap);
      mission.icon = npc?.icon ?? '';
      return {
        kind: 'mission',
        mission,
        npc,
        areaZone: m.AreaZone ?? '',
        selectionNeeded: m.MissionItemRewardSelectionNeeded ?? false,
      };
    }
    case 'MissionRewardCrate': {
      const m = s as RawMissionSource;
      const mission = missionRef(m.MissionID ?? 0, m.MissionName ?? '');
      if (!mission) return null;
      const npc = npcRef(m.NPCTypeID ?? 0, m.NPCName ?? '', m.NPCIcon ?? '', iconMap);
      mission.icon = npc?.icon ?? '';
      return {
        kind: 'mission-crate',
        mission,
        npc,
        areaZone: m.AreaZone ?? '',
        selectionNeeded: m.MissionItemRewardSelectionNeeded ?? false,
        ...chance(entry),
      };
    }
    case 'Vendor': {
      const v = s as RawVendorSource;
      const npc = npcRef(v.NPCTypeID ?? 0, v.NPCName ?? '', v.NPCIcon ?? '', iconMap);
      if (!npc) return null;
      return {
        kind: 'vendor',
        npc,
        price: v.Price ?? 0,
        areaZone: v.AreaZone ?? '',
      };
    }
    case 'Egg': {
      const e = s as RawEggSource;
      return {
        kind: 'egg',
        eggId: e.EggID ?? '',
        eggName: e.EggName ?? '',
        eggComment: e.EggComment ?? '',
        areaZone: e.AreaZone ?? '',
        areaId: e.AreaZone ? slugify(e.AreaZone) : '',
        instanceID: e.InstanceID ?? 0,
        instanceName: instanceNames.get(e.InstanceID ?? 0) ?? '',
        x: e.X ?? 0,
        y: e.Y ?? 0,
        z: e.Z ?? 0,
        ...chance(entry),
      };
    }
    case 'Racing': {
      const r = s as RawRacingSource;
      return {
        kind: 'racing',
        npc: npcRef(r.NPCTypeID ?? 0, r.NPCName ?? '', r.NPCIcon ?? '', iconMap),
        instanceName: r.InstanceName ?? '',
        areaZone: r.AreaZone ?? '',
        requiredScore: r.RequiredScore ?? 0,
        requiredStars: r.RequiredStars ?? 0,
        ...chance(entry),
      };
    }
    case 'CodeItem': {
      const c = s as { Code?: string };
      return { kind: 'code', code: c.Code ?? '' };
    }
    case 'Event': {
      const e = s as RawEventSource;
      return {
        kind: 'event',
        eventId: e.EventID ?? 0,
        eventName: e.EventName ?? '',
        ...chance(entry),
      };
    }
    default:
      return null;
  }
}

/** Dedup near-identical sources (same kind + same key fields). */
function sourceDedupKey(s: ItemSource): string {
  switch (s.kind) {
    case 'mob': return `mob:${(s.mob.id)}:${s.areaZone}:${s.boyOdds}:${s.girlOdds}`;
    case 'mission': return `mission:${s.mission.id}:${s.npc?.id ?? 0}`;
    case 'mission-crate': return `mission-crate:${s.mission.id}:${s.npc?.id ?? 0}:${s.boyOdds}:${s.girlOdds}`;
    case 'vendor': return `vendor:${s.npc.id}:${s.areaZone}`;
    case 'egg': return `egg:${s.eggId}:${s.eggName}:${s.areaZone}:${s.boyOdds}:${s.girlOdds}`;
    case 'racing': return `racing:${s.npc?.id ?? 0}:${s.areaZone}:${s.requiredScore}`;
    case 'code': return `code:${s.code}`;
    case 'event': return `event:${s.eventId}:${s.boyOdds}:${s.girlOdds}`;
  }
}

function normalizeItem(
  raw: RawItem,
  rawSources: RawSourceEntry[],
  crateDrops: CrateDrop[],
  containingCrates: CrateDrop[],
  iconMap: IconMap,
  instanceNames: InstanceNameIndex,
): Item {
  const seen = new Set<string>();
  const sources: ItemSource[] = [];
  for (const entry of rawSources) {
    const s = normalizeSource(entry, iconMap, instanceNames);
    if (!s) continue;
    const key = sourceDedupKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(s);
  }

  return {
    id: `${raw.TypeID}-${raw.ItemID}`,
    typeId: raw.TypeID,
    itemId: raw.ItemID,
    name: raw.Name,
    icon: iconMap[(raw.Icon ?? '').replace(/\\/g, '/')] ?? '',

    type: raw.Type,
    displayType: raw.DisplayType ?? '',
    description: (raw.Description ?? '').trim(),
    rarity: raw.Rarity ?? '',
    contentLevel: raw.ContentLevel ?? 0,
    requiredLevel: raw.RequiredLevel ?? 0,
    gender: raw.Gender ?? 'Any',

    buyPrice: raw.ItemPrice ?? 0,
    sellPrice: raw.ItemSellPrice ?? 0,
    maxStack: raw.MaxStack ?? 0,

    tradeable: raw.Tradeable ?? false,
    sellable: raw.Sellable ?? false,
    obtainable: raw.Obtainable ?? false,

    singleDamage: raw.SingleDamage ?? 0,
    multiDamage: raw.MultiDamage ?? 0,
    numberOfTargets: raw.NumberOfTargets ?? 0,
    range: raw.Range ?? '',
    rangeValue: raw.RangeValue ?? 0,
    coneAngle: raw.ConeAngle ?? 0,
    fireDelayTime: raw.FireDelayTime ?? 0,
    fireDeliverTime: raw.FireDeliverTime ?? 0,
    fireDurationTime: raw.FireDurationTime ?? 0,
    fireInitialTime: raw.FireInitialTime ?? 0,
    rateOfFire: raw.RateOfFire ?? 0,
    defense: raw.Defense ?? 0,
    vehicleClass: raw.VehicleClass ?? 0,
    weaponType: raw.WeaponType ?? '',

    sources,
    crateDrops,
    containingCrates,
  };
}

function indexEntry(item: Item): ItemIndexEntry {
  return {
    id: item.id,
    typeId: item.typeId,
    itemId: item.itemId,
    name: item.name,
    icon: item.icon,
    type: item.type,
    rarity: item.rarity,
    gender: item.gender,
    contentLevel: item.contentLevel,
    requiredLevel: item.requiredLevel,
    obtainable: item.obtainable,
  };
}

/**
 * Read info/item_info.json + info/item_source_info.json and emit normalized
 * items with sources unioned and deduped. Item URLs are compound
 * "typeId-itemId"; chunking uses typeId * 10000 + itemId.
 */
export async function normalizeItems(
  zipPath: string,
  slug: string,
  iconMap: IconMap,
  instanceNames: InstanceNameIndex,
): Promise<{ count: number; chunks: number; sourceCount: number; mobItems: MobItemsMap }> {
  const zip = new AdmZip(zipPath);
  const itemEntry = zip.getEntry('info/item_info.json');
  const mobItems: MobItemsMap = new Map();
  if (!itemEntry) return { count: 0, chunks: 0, sourceCount: 0, mobItems };

  const rawItems = JSON.parse(itemEntry.getData().toString('utf8')) as Record<string, RawItem>;

  // Source info: keys are "TypeID::ItemID::Name". Build a lookup by "TypeID::ItemID".
  const sourceEntry = zip.getEntry('info/item_source_info.json');
  const sourcesByKey = new Map<string, RawSourceEntry[]>();
  let crateDropsByKey = new Map<string, CrateDrop[]>();
  const crateItemsEntry = zip.getEntry('info/crate_to_item_info.json');
  if (crateItemsEntry) {
    const rawCrateItems = JSON.parse(crateItemsEntry.getData().toString('utf8')) as RawCrateToItemInfo;
    crateDropsByKey = buildCrateDrops(rawCrateItems, iconMap);
  }

  let containingCratesByKey = new Map<string, CrateDrop[]>();
  const itemCratesEntry = zip.getEntry('info/item_to_crate_info.json');
  if (itemCratesEntry) {
    const rawItemCrates = JSON.parse(itemCratesEntry.getData().toString('utf8')) as RawItemToCrateInfo;
    containingCratesByKey = buildContainingCrates(rawItemCrates, iconMap);
  }
  if (sourceEntry) {
    const rawSources = JSON.parse(sourceEntry.getData().toString('utf8')) as Record<string, RawSourceEntry[]>;
    for (const [key, list] of Object.entries(rawSources)) {
      const m = /^(\d+)::(\d+)/.exec(key);
      if (!m) continue;
      sourcesByKey.set(`${parseInt(m[1], 10)}::${parseInt(m[2], 10)}`, list);
    }
  }

  const items: Item[] = Object.values(rawItems).map((raw) => {
    const key = `${raw.TypeID}::${raw.ItemID}`;
    const sources = sourcesByKey.get(key) ?? [];
    const crateDrops = crateDropsByKey.get(key) ?? [];
    const containingCrates = containingCratesByKey.get(key) ?? [];
    return normalizeItem(raw, sources, crateDrops, containingCrates, iconMap, instanceNames);
  });

  // Sort: by typeId then itemId for deterministic output.
  items.sort((a, b) => a.typeId - b.typeId || a.itemId - b.itemId);

  const sourceCount = items.reduce((s, i) => s + i.sources.length, 0);

  // Inverted index: mob → drops, built from each item's mob-kind sources.
  // Dedup by (item, areaZone, boyOdds, girlOdds) so identical entries across
  // spawn instances collapse, but different zones / odds remain distinct rows.
  for (const item of items) {
    const itemAsRef: Ref = { type: 'item', id: item.id, name: item.name, icon: item.icon };
    for (const src of item.sources) {
      if (src.kind !== 'mob') continue;
      const mobId = src.mob.id as number;
      let list = mobItems.get(mobId);
      if (!list) {
        list = [];
        mobItems.set(mobId, list);
      }
      const dupe = list.some(
        (d) => d.item.id === item.id
          && d.areaZone === src.areaZone
          && d.boyOdds === src.boyOdds
          && d.girlOdds === src.girlOdds,
      );
      if (!dupe) {
        list.push({
          item: itemAsRef,
          areaZone: src.areaZone,
          boyProbability: src.boyProbability,
          boyOdds: src.boyOdds,
          girlProbability: src.girlProbability,
          girlOdds: src.girlOdds,
        });
      }
    }
  }

  const { chunks } = await writeChunks(slug, 'items', items, (i) => ({
    url: i.id,
    chunk: chunkOf(itemChunkKey(i.typeId, i.itemId)),
  }));
  await writeIndex(slug, 'items', items.map(indexEntry));

  // Suppress unused-helper warning when missionRef gets imported but unused; keep for forward-compat.
  void (null as unknown as Ref);

  return { count: items.length, chunks, sourceCount, mobItems };
}
