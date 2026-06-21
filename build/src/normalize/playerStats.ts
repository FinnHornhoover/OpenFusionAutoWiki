import AdmZip from 'adm-zip';

import { writeIndex } from '../chunk.js';
import type { IconMap } from '../icons.js';
import { iconFor } from './refs.js';
import type { PlayerStatsRow, Ref } from './types.js';

interface RawNanoInfo {
  ID?: number;
  Name?: string;
  NanoIcon?: string;
}

interface RawMissionInfo {
  ID?: number;
  Name?: string;
  MissionJournalNPCIcon?: string;
  MissionStartNPCIcon?: string;
  MissionEndNPCIcon?: string;
}

interface RawTaskInfo {
  CurrentObjective?: string;
  ID?: number;
}

interface RawPlayerStats {
  Defense?: number;
  Dodge?: number;
  FMLimit?: number;
  HP?: number;
  Level?: number;
  MissionAssignedAtFMFill?: RawMissionInfo | null;
  MissionAssignedAtFMFillID?: number;
  NanosUnlocked?: Record<string, RawNanoInfo>;
  TaskAssignedAtFMFill?: RawTaskInfo | null;
  TaskAssignedAtFMFillID?: number;
  NextLevelFMCost?: number;
  NanoPowerChangeFMCost?: number;
  PunchDamage?: number;
}

function missionIcon(mission: RawMissionInfo | null | undefined, iconMap: IconMap): string {
  return iconFor(mission?.MissionJournalNPCIcon ?? mission?.MissionStartNPCIcon ?? mission?.MissionEndNPCIcon ?? '', iconMap);
}

function nanoRef(raw: RawNanoInfo, iconMap: IconMap): Ref | null {
  const id = raw.ID ?? 0;
  if (id <= 0) return null;
  return {
    type: 'nano',
    id,
    name: raw.Name || 'Nano #' + id,
    icon: iconFor(raw.NanoIcon ?? '', iconMap),
  };
}

function normalizeRow(raw: RawPlayerStats, iconMap: IconMap): PlayerStatsRow {
  const nanosUnlocked = Object.values(raw.NanosUnlocked ?? {})
    .map((nano) => nanoRef(nano, iconMap))
    .filter((nano): nano is Ref => Boolean(nano))
    .sort((a, b) => (a.id as number) - (b.id as number));
  const nanoMissionId = raw.MissionAssignedAtFMFillID ?? raw.MissionAssignedAtFMFill?.ID ?? 0;
  const nanoMission: Ref | null = nanoMissionId > 0 ? {
    type: 'mission',
    id: nanoMissionId,
    name: raw.MissionAssignedAtFMFill?.Name || "Mission #" + nanoMissionId,
    icon: missionIcon(raw.MissionAssignedAtFMFill, iconMap),
  } : null;
  return {
    level: raw.Level ?? 0,
    hp: raw.HP ?? 0,
    defense: raw.Defense ?? 0,
    dodge: raw.Dodge ?? 0,
    punchDamage: raw.PunchDamage ?? 0,
    fmLimit: raw.FMLimit ?? 0,
    nextLevelFMCost: raw.NextLevelFMCost ?? 0,
    nanoPowerChangeFMCost: raw.NanoPowerChangeFMCost ?? 0,
    nanosUnlocked,
    nanoMission,
    nanoMissionTaskId: raw.TaskAssignedAtFMFillID ?? raw.TaskAssignedAtFMFill?.ID ?? 0,
    nanoMissionTask: raw.TaskAssignedAtFMFill?.CurrentObjective ?? '',
  };
}

export async function normalizePlayerStats(
  zipPath: string,
  slug: string,
  iconMap: IconMap,
): Promise<{ count: number }> {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry('info/player_info.json');
  if (!entry) return { count: 0 };
  const raw = JSON.parse(entry.getData().toString('utf8')) as Record<string, RawPlayerStats>;
  const rows = Object.values(raw)
    .map((row) => normalizeRow(row, iconMap))
    .sort((a, b) => a.level - b.level);
  await writeIndex(slug, 'player-stats', rows);
  return { count: rows.length };
}
