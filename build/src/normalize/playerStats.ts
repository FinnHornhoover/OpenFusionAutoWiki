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
  NanoMission?: RawMissionInfo | null;
  NanoMissionID?: number;
  NanoMissionTask?: RawTaskInfo | null;
  NanoMissionTaskID?: number;
  NextLevelFMCost?: number;
  NanoPowerChangeFMCost?: number;
  NextNano?: RawNanoInfo | null;
  NextNanoID?: number;
  PunchDamage?: number;
}

function missionIcon(raw: RawPlayerStats, iconMap: IconMap): string {
  const mission = raw.NanoMission;
  return iconFor(mission?.MissionJournalNPCIcon ?? mission?.MissionStartNPCIcon ?? mission?.MissionEndNPCIcon ?? '', iconMap);
}

function normalizeRow(raw: RawPlayerStats, iconMap: IconMap): PlayerStatsRow {
  const nextNanoId = raw.NextNanoID ?? raw.NextNano?.ID ?? 0;
  const nanoMissionId = raw.NanoMissionID ?? raw.NanoMission?.ID ?? 0;
  const nextNano: Ref | null = nextNanoId > 0 ? {
    type: 'nano',
    id: nextNanoId,
    name: raw.NextNano?.Name || 'Nano #' + nextNanoId,
    icon: iconFor(raw.NextNano?.NanoIcon ?? '', iconMap),
  } : null;
  const nanoMission: Ref | null = nanoMissionId > 0 ? {
    type: 'mission',
    id: nanoMissionId,
    name: raw.NanoMission?.Name || `Mission #${nanoMissionId}`,
    icon: missionIcon(raw, iconMap),
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
    nextNano,
    nanoMission,
    nanoMissionTaskId: raw.NanoMissionTaskID ?? raw.NanoMissionTask?.ID ?? 0,
    nanoMissionTask: raw.NanoMissionTask?.CurrentObjective ?? '',
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
