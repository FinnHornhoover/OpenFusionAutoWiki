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
  NanoMission?: RawMissionInfo;
  NanoMissionID?: number;
  NanoMissionTask?: string | RawTaskInfo;
  NanoMissionTaskID?: number;
  NextLevelFMCost?: number;
  NextNano?: string | RawNanoInfo;
  NextNanoID?: number;
  PunchDamage?: number;
}

function missionIcon(raw: RawPlayerStats, iconMap: IconMap): string {
  const mission = raw.NanoMission;
  return iconFor(mission?.MissionJournalNPCIcon ?? mission?.MissionStartNPCIcon ?? mission?.MissionEndNPCIcon ?? '', iconMap);
}

function nextNanoName(raw: RawPlayerStats, id: number): string {
  if (typeof raw.NextNano === 'string' && raw.NextNano) return raw.NextNano;
  if (raw.NextNano && typeof raw.NextNano === 'object' && raw.NextNano.Name) return raw.NextNano.Name;
  return `Nano #${id}`;
}

function nextNanoIcon(raw: RawPlayerStats, iconMap: IconMap): string {
  if (!raw.NextNano || typeof raw.NextNano !== 'object') return '';
  return iconFor(raw.NextNano.NanoIcon ?? '', iconMap);
}

function nanoMissionTaskText(raw: RawPlayerStats): string {
  if (typeof raw.NanoMissionTask === 'string') return raw.NanoMissionTask;
  if (raw.NanoMissionTask && typeof raw.NanoMissionTask === 'object') return raw.NanoMissionTask.CurrentObjective ?? '';
  return '';
}

function normalizeRow(raw: RawPlayerStats, iconMap: IconMap): PlayerStatsRow {
  const nextNanoId = raw.NextNanoID ?? (typeof raw.NextNano === 'object' ? raw.NextNano?.ID ?? 0 : 0);
  const nanoMissionId = raw.NanoMissionID ?? raw.NanoMission?.ID ?? 0;
  const nextNano: Ref | null = nextNanoId > 0 ? {
    type: 'nano',
    id: nextNanoId,
    name: nextNanoName(raw, nextNanoId),
    icon: nextNanoIcon(raw, iconMap),
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
    nextNano,
    nanoMission,
    nanoMissionTaskId: raw.NanoMissionTaskID ?? (typeof raw.NanoMissionTask === 'object' ? raw.NanoMissionTask?.ID ?? 0 : 0),
    nanoMissionTask: nanoMissionTaskText(raw),
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
