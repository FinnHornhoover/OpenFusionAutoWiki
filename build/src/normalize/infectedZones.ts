import AdmZip from 'adm-zip';

import { writeChunks, writeIndex } from '../chunk.js';
import type { IconMap } from '../icons.js';
import { iconFor, itemRef } from './refs.js';
import { slugify } from './slug.js';
import type { CrateDrop, InfectedZone, InfectedZoneIndexEntry, InfectedZoneRankReward, InstanceWarp, Ref } from './types.js';

interface RawWarpNpc {
  AreaZone?: string;
  InstanceID?: number;
  TypeID?: number;
  TypeIcon?: string;
  TypeName?: string;
  X?: number;
  Y?: number;
  Z?: number;
}

interface RawWarp {
  ID?: number;
  EntryInstanceID?: number;
  EntryInstance?: string;
  NPCID?: number;
  NPCType?: { Name?: string; Icon?: string } | null;
  NPCs?: Record<string, RawWarpNpc>;
  RequiredItemID?: number;
  RequiredItemType?: number;
  RequiredItem?: { Name?: string; Icon?: string } | null;
  RequiredMinLevel?: number;
  RequiredMission?: string;
  RequiredMissionID?: number;
  RequiredTaskID?: number;
  RequiredTaskObjective?: string;
  ToAreaZone?: string;
  ToX?: number;
  ToY?: number;
  ToZ?: number;
  WarpPrice?: number;
}

interface RawRewardItem {
  ItemID?: number;
  TypeID?: number;
  Name?: string;
  Icon?: string;
  Rarity?: string;
  RequiredLevel?: number;
  Type?: string;
}

interface RawRankReward {
  Item?: RawRewardItem;
  ItemID?: number;
  ItemTypeID?: number;
  RankScore?: number;
}

interface RawCrateDrop {
  Item?: RawRewardItem;
  BoyProbability?: number;
  BoyOdds?: string;
  GirlProbability?: number;
  GirlOdds?: string;
}

type RawCrateToItemInfo = Record<string, RawCrateDrop[]>;

interface RawInfectedZone {
  ID?: number;
  Name?: string;
  AreaZone?: string;
  InGame?: boolean;
  EntryWarps?: Record<string, RawWarp>;
  TotalPods?: number;
  TimeLimit?: string;
  TimeLimitSeconds?: number;
  ScoreCap?: number;
  OriginalScoreCap?: number;
  PodFactor?: number;
  TimeFactor?: number;
  ScaleFactor?: number;
  ScoreFunction?: string;
  FMRewardFunction?: string;
  StarsToItemRewards?: Record<string, RawRankReward>;
  RankScores?: number[] | Record<string, number>;
}


function normalizeLocation(raw: RawWarpNpc | null | undefined): InstanceWarp['entryLocation'] {
  if (!raw) return null;
  const areaZone = raw.AreaZone ?? '';
  return {
    areaZone,
    areaId: areaZone && areaZone !== 'Unknown - Unknown' ? slugify(areaZone) : '',
    x: raw.X ?? 0,
    y: raw.Y ?? 0,
    z: raw.Z ?? 0,
    instanceID: raw.InstanceID ?? 0,
    instanceName: '',
  };
}

function normalizeExitLocation(raw: RawWarp): InstanceWarp['exitLocation'] {
  const areaZone = raw.ToAreaZone ?? '';
  if (!areaZone && raw.ToX === undefined && raw.ToY === undefined && raw.ToZ === undefined) return null;
  return {
    areaZone,
    areaId: areaZone && areaZone !== 'Unknown - Unknown' ? slugify(areaZone) : '',
    x: raw.ToX ?? 0,
    y: raw.ToY ?? 0,
    z: raw.ToZ ?? 0,
  };
}

function normalizeWarp(raw: RawWarp, iconMap: IconMap, missionLevels: Map<number, number>): InstanceWarp {
  const entryNpc = Object.values(raw.NPCs ?? {})[0] ?? null;
  const npcId = raw.NPCID && raw.NPCID > 0 ? raw.NPCID : entryNpc?.TypeID ?? 0;
  const npc: Ref | null = npcId > 0
    ? {
      type: 'npc',
      id: npcId,
      name: raw.NPCType?.Name ?? entryNpc?.TypeName ?? `NPC #${npcId}`,
      icon: iconFor(raw.NPCType?.Icon ?? entryNpc?.TypeIcon ?? '', iconMap),
    }
    : null;
  const requiredItem = raw.RequiredItemID && raw.RequiredItemID > 0
    ? itemRef(raw.RequiredItemType ?? 0, raw.RequiredItemID, raw.RequiredItem?.Name ?? '', raw.RequiredItem?.Icon ?? '', iconMap)
    : null;
  const requiredMission: Ref | null = raw.RequiredMissionID && raw.RequiredMissionID > 0
    ? { type: 'mission', id: raw.RequiredMissionID, name: raw.RequiredMission || `Mission #${raw.RequiredMissionID}` }
    : null;

  return {
    id: raw.ID ?? 0,
    npc,
    entryLocation: normalizeLocation(entryNpc),
    exitLocation: normalizeExitLocation(raw),
    requiredItem,
    requiredMission,
    requiredTaskId: raw.RequiredTaskID ?? 0,
    requiredTaskObjective: raw.RequiredTaskObjective ?? '',
    requiredMinLevel: raw.RequiredMinLevel && raw.RequiredMinLevel > 0
      ? raw.RequiredMinLevel
      : missionLevels.get(raw.RequiredMissionID ?? 0) ?? 0,
    warpPrice: raw.WarpPrice ?? 0,
  };
}

function rankLabel(stars: number): string {
  const rank = 6 - stars;
  return `RANK ${rank} (${stars} star${stars === 1 ? '' : 's'})`;
}

function buildCrateDrops(rawCrateItems: RawCrateToItemInfo, iconMap: IconMap): Map<number, CrateDrop[]> {
  const byCrate = new Map<number, CrateDrop[]>();
  for (const [crateId, entries] of Object.entries(rawCrateItems)) {
    const id = parseInt(crateId, 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    const list: CrateDrop[] = [];
    for (const entry of entries) {
      const raw = entry.Item;
      if (!raw) continue;
      const ref = itemRef(raw.TypeID ?? 0, raw.ItemID ?? 0, raw.Name ?? '', raw.Icon ?? '', iconMap);
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
    list.sort((a, b) => {
      const pa = Math.max(a.boyProbability, a.girlProbability);
      const pb = Math.max(b.boyProbability, b.girlProbability);
      return (pb - pa) || a.ref.name.localeCompare(b.ref.name);
    });
    byCrate.set(id, list);
  }
  return byCrate;
}

function normalizeRankRewards(
  raw: Record<string, RawRankReward> | undefined,
  iconMap: IconMap,
  crateDropsByItemId: Map<number, CrateDrop[]>,
): InfectedZoneRankReward[] {
  return Object.entries(raw ?? {})
    .map(([starsKey, reward]) => {
      const stars = parseInt(starsKey, 10);
      const itemInfo = reward.Item;
      const itemId = itemInfo?.ItemID ?? reward.ItemID ?? 0;
      const itemTypeId = itemInfo?.TypeID ?? reward.ItemTypeID ?? 0;
      const item = itemInfo
        ? itemRef(itemTypeId, itemId, itemInfo.Name ?? '', itemInfo.Icon ?? '', iconMap)
        : itemRef(itemTypeId, itemId, '', '', iconMap);
      return {
        stars,
        rank: 6 - stars,
        label: rankLabel(stars),
        requiredScore: reward.RankScore ?? 0,
        item,
        crateDrops: itemTypeId === 9 ? crateDropsByItemId.get(itemId) ?? [] : [],
      };
    })
    .filter((r) => r.stars > 0 && r.item)
    .sort((a, b) => b.stars - a.stars);
}

function normalizeRankScores(
  raw: number[] | Record<string, number> | undefined,
  maxScore: number,
  rewards: Record<string, RawRankReward> | undefined,
): number[] {
  const advertised = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  const ratios = [0.8, 0.7, 0.5, 0.3, 0.29];
  return [5, 4, 3, 2, 1].map((stars, index) => {
    const score = Number(advertised[index] ?? rewards?.[String(stars)]?.RankScore);
    return Number.isFinite(score) && score > 0 ? score : Math.floor(maxScore * ratios[index]);
  });
}

function normalizeInfectedZone(raw: RawInfectedZone, iconMap: IconMap, missionLevels: Map<number, number>, crateDropsByItemId: Map<number, CrateDrop[]>): InfectedZone {
  const id = raw.ID ?? 0;
  const entryWarps = Object.values(raw.EntryWarps ?? {})
    .map((w) => normalizeWarp(w, iconMap, missionLevels))
    .sort((a, b) => a.id - b.id);
  const firstEntry = entryWarps.find((w) => w.entryLocation?.instanceID === 0) ?? entryWarps.find((w) => w.entryLocation) ?? null;
  const podCount = raw.TotalPods ?? 0;
  const maxScore = raw.ScoreCap ?? 0;
  return {
    id,
    name: raw.Name?.trim() || `Infected Zone #${id}`,
    icon: `/ui/ep/ep_big_${String(id).padStart(2, '0')}.png`,
    areaZone: raw.AreaZone ?? firstEntry?.entryLocation?.areaZone ?? '',
    areaId: raw.AreaZone && raw.AreaZone !== 'Unknown - Unknown' ? slugify(raw.AreaZone) : firstEntry?.entryLocation?.areaId ?? '',
    inGame: raw.InGame ?? false,
    podCount,
    timeLimit: raw.TimeLimit ?? '',
    timeLimitSeconds: raw.TimeLimitSeconds ?? 0,
    maxScore,
    originalMaxScore: raw.OriginalScoreCap ?? 0,
    podFactor: raw.PodFactor ?? 0,
    timeFactor: raw.TimeFactor ?? 0,
    scaleFactor: raw.ScaleFactor ?? 0,
    scoreFunction: raw.ScoreFunction ?? '',
    fmRewardFunction: raw.FMRewardFunction ?? '',
    firstEntryLocation: firstEntry?.entryLocation ?? null,
    entryWarps,
    exitWarps: entryWarps.filter((w) => w.exitLocation),
    rankRewards: normalizeRankRewards(raw.StarsToItemRewards, iconMap, crateDropsByItemId),
    rankScores: normalizeRankScores(raw.RankScores, maxScore, raw.StarsToItemRewards),
  };
}

function indexEntry(zone: InfectedZone): InfectedZoneIndexEntry {
  return {
    id: zone.id,
    name: zone.name,
    icon: zone.icon,
    areaZone: zone.areaZone,
    areaId: zone.areaId,
    firstEntryX: zone.firstEntryLocation?.x ?? 0,
    firstEntryY: zone.firstEntryLocation?.y ?? 0,
    firstEntryZ: zone.firstEntryLocation?.z ?? 0,
    inGame: zone.inGame,
    podCount: zone.podCount,
    timeLimit: zone.timeLimit,
    timeLimitSeconds: zone.timeLimitSeconds,
    maxScore: zone.maxScore,
    entryWarpCount: zone.entryWarps.length,
    exitWarpCount: zone.exitWarps.length,
  };
}

export async function normalizeInfectedZones(
  zipPath: string,
  slug: string,
  iconMap: IconMap,
  missionLevels: Map<number, number>,
): Promise<{ count: number; chunks: number }> {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry('info/infected_zone_info.json');
  if (!entry) return { count: 0, chunks: 0 };
  const raw = JSON.parse(entry.getData().toString('utf8')) as Record<string, RawInfectedZone> | RawInfectedZone[];
  let crateDropsByItemId = new Map<number, CrateDrop[]>();
  const crateItemsEntry = zip.getEntry('info/crate_to_item_info.json');
  if (crateItemsEntry) {
    const rawCrateItems = JSON.parse(crateItemsEntry.getData().toString('utf8')) as RawCrateToItemInfo;
    crateDropsByItemId = buildCrateDrops(rawCrateItems, iconMap);
  }

  const rows = (Array.isArray(raw) ? raw : Object.values(raw))
    .filter((r) => r && typeof r === 'object')
    .map((r) => normalizeInfectedZone(r, iconMap, missionLevels, crateDropsByItemId))
    .filter((r) => r.id > 0)
    .sort((a, b) => a.id - b.id);

  const { chunks } = await writeChunks(slug, 'infected-zones', rows, (r) => ({
    url: r.id,
    chunk: 0,
  }));
  await writeIndex(slug, 'infected-zones', rows.map(indexEntry));

  return { count: rows.length, chunks };
}
