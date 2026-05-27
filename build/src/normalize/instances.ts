import AdmZip from 'adm-zip';

import { writeChunks, writeIndex } from '../chunk.js';
import type { IconMap } from '../icons.js';
import { iconFor, itemRef } from './refs.js';
import { slugify } from './slug.js';
import type { Instance, InstanceIndexEntry, InstanceWarp, Ref } from './types.js';

interface RawInstanceInfo {
  ID?: number;
  Name?: string;
  AreaZone?: string;
  EPID?: number;
  EPMaxScore?: number;
  InGame?: boolean;
  EntryWarps?: Record<string, RawInstanceWarp>;
}

interface RawInfectedZoneInfo {
  ID?: number;
  Name?: string;
}

interface RawInstanceWarpNpc {
  AreaZone?: string;
  InstanceID?: number;
  TypeID?: number;
  TypeIcon?: string;
  TypeName?: string;
  X?: number;
  Y?: number;
  Z?: number;
}

interface RawInstanceWarp {
  ID?: number;
  EntryInstanceID?: number;
  EntryInstance?: string;
  NPCID?: number;
  NPCType?: { Name?: string; Icon?: string } | null;
  NPCs?: Record<string, RawInstanceWarpNpc>;
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

function normalizeLocation(
  raw: RawInstanceWarpNpc | null | undefined,
  instanceNames: Map<number, string>,
): InstanceWarp['entryLocation'] {
  if (!raw) return null;
  const areaZone = raw.AreaZone ?? '';
  const instanceID = raw.InstanceID ?? 0;
  return {
    areaZone,
    areaId: areaZone && areaZone !== 'Unknown - Unknown' ? slugify(areaZone) : '',
    x: raw.X ?? 0,
    y: raw.Y ?? 0,
    z: raw.Z ?? 0,
    instanceID,
    instanceName: instanceNames.get(instanceID) ?? (instanceID > 0 ? `Instance ${instanceID}` : ''),
  };
}

function normalizeExitLocation(raw: RawInstanceWarp): InstanceWarp['exitLocation'] {
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

function normalizeWarp(
  raw: RawInstanceWarp,
  iconMap: IconMap,
  instanceNames: Map<number, string>,
  missionLevels: Map<number, number>,
): InstanceWarp {
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
    entryLocation: normalizeLocation(entryNpc, instanceNames),
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

function normalizeInstance(
  raw: RawInstanceInfo,
  iconMap: IconMap,
  instanceNames: Map<number, string>,
  missionLevels: Map<number, number>,
  infectedZoneNames: Map<number, string>,
): Instance {
  const id = raw.ID ?? 0;
  const entryWarps = Object.values(raw.EntryWarps ?? {})
    .map((w) => normalizeWarp(w, iconMap, instanceNames, missionLevels))
    .sort((a, b) => a.id - b.id);
  const exitWarps = entryWarps.filter((w) => w.exitLocation);
  const epId = raw.EPID ?? 0;
  const infectedZoneName = epId > 0 ? infectedZoneNames.get(epId) ?? `Infected Zone #${epId}` : '';
  const infectedZone: Ref | null = epId > 0
    ? { type: 'infected-zone', id: epId, name: infectedZoneName, icon: `/ui/ep/ep_big_${String(epId).padStart(2, '0')}.png` }
    : null;
  return {
    id,
    name: raw.Name?.trim() || `Instance #${id}`,
    areaZone: raw.AreaZone ?? '',
    areaId: raw.AreaZone && raw.AreaZone !== 'Unknown - Unknown' ? slugify(raw.AreaZone) : '',
    inGame: raw.InGame ?? false,
    infectedZoneId: epId > 0 ? epId : 0,
    infectedZoneName,
    infectedZone,
    epMaxScore: raw.EPMaxScore ?? 0,
    entryWarps,
    exitWarps,
  };
}

function indexEntry(inst: Instance): InstanceIndexEntry {
  return {
    id: inst.id,
    name: inst.name,
    inGame: inst.inGame,
    infectedZoneId: inst.infectedZoneId,
    infectedZoneName: inst.infectedZoneName,
    infectedZone: inst.infectedZone,
    entryWarpCount: inst.entryWarps.length,
    exitWarpCount: inst.exitWarps.length,
  };
}

export async function normalizeInstances(
  zipPath: string,
  slug: string,
  iconMap: IconMap,
  missionLevels: Map<number, number>,
): Promise<{ count: number; chunks: number; infected: number }> {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry('info/instance_info.json');
  if (!entry) return { count: 0, chunks: 0, infected: 0 };

  const raw = JSON.parse(entry.getData().toString('utf8')) as Record<string, RawInstanceInfo> | RawInstanceInfo[];
  const rawRows = Array.isArray(raw) ? raw : Object.values(raw);
  const infectedZoneNames = new Map<number, string>();
  const infectedZoneEntry = zip.getEntry('info/infected_zone_info.json');
  if (infectedZoneEntry) {
    const rawInfectedZones = JSON.parse(infectedZoneEntry.getData().toString('utf8')) as Record<string, RawInfectedZoneInfo> | RawInfectedZoneInfo[];
    for (const row of Array.isArray(rawInfectedZones) ? rawInfectedZones : Object.values(rawInfectedZones)) {
      const id = row?.ID ?? 0;
      const name = row?.Name?.trim() ?? '';
      if (id > 0 && name) infectedZoneNames.set(id, name);
    }
  }
  const instanceNames = new Map<number, string>();
  for (const row of rawRows) {
    const id = row?.ID ?? 0;
    const name = row?.Name?.trim() ?? '';
    if (id > 0 && name) instanceNames.set(id, name);
  }
  const rows = rawRows
    .filter((r) => r && typeof r === 'object')
    .map((r) => normalizeInstance(r, iconMap, instanceNames, missionLevels, infectedZoneNames))
    .filter((r) => r.id > 0)
    .sort((a, b) => a.id - b.id);

  const { chunks } = await writeChunks(slug, 'instances', rows, (r) => ({
    url: r.id,
    chunk: 0,
  }));
  await writeIndex(slug, 'instances', rows.map(indexEntry));

  return { count: rows.length, chunks, infected: rows.filter((r) => r.infectedZoneId > 0).length };
}
