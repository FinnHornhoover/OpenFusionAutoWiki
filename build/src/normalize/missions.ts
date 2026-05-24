import AdmZip from 'adm-zip';

import { writeChunks, writeIndex } from '../chunk.js';
import type { IconMap } from '../icons.js';
import {
  instanceRef,
  itemRef,
  missionRef,
  monsterRef,
  nanoRef,
  npcRef,
  parseCompoundKey,
} from './refs.js';
import type {
  Mission,
  MissionIndexEntry,
  MissionTask,
  Ref,
  TaskMessage,
} from './types.js';

interface RawTaskMessage {
  DialogBubble?: string;
  DialogBubbleNPCID?: number;
  DialogBubbleNPCIcon?: string;
  DialogBubbleNPCName?: string;
  JournalDetailedMissionCompleteDescription?: string;
  JournalDetailedMissionDescription?: string;
  JournalDetailedTaskDescription?: string;
  JournalMissionCompleteSummary?: string;
  JournalMissionSummary?: string;
  SendNPCID?: number;
  SendNPCIcon?: string;
  SendNPCName?: string;
  Text?: string;
  Type?: string;
  TypeID?: number;
}

interface RawTask {
  ID: number;
  Type: string;
  CurrentObjective?: string;
  EscortNPCID?: number;
  EscortNPCIcon?: string;
  EscortNPCName?: string;
  MessageOnEnd?: RawTaskMessage;
  MessageOnFail?: RawTaskMessage;
  MessageOnStart?: RawTaskMessage;
  OnEndNextTaskID?: number;
  OnEndTaskObjective?: string;
  QuestItemMonsterRequirements?: Record<string, { KillCount?: number }>;
  RequiredInstance?: string;
  RequiredInstanceID?: number;
  TimeLimitSeconds?: number;
  WaypointNPCID?: number;
  WaypointNPCIcon?: string;
  WaypointNPCName?: string;
}

interface RawRewardItem {
  ItemID: number;
  Name: string;
  Icon?: string;
  Rarity?: string;
  RequiredLevel?: number;
  Type?: string;
}

interface RawMission {
  ID: number;
  Name: string;
  Level: number;
  Difficulty: string;
  Type: string;
  InGame: boolean;
  Barkers?: Record<string, string>;
  MissionStartNPCID?: number;
  MissionStartNPCIcon?: string;
  MissionStartNPCName?: string;
  MissionJournalNPCID?: number;
  MissionJournalNPCIcon?: string;
  MissionJournalNPCName?: string;
  MissionEndNPCID?: number;
  MissionEndNPCIcon?: string;
  MissionEndNPCName?: string;
  RequiredGuide?: string;
  RequiredNano?: string;
  RequiredNanoID?: number;
  RequiredMissionIDs?: number[];
  RequiredMissions?: Record<string, { Name?: string }>;
  Rewards?: {
    FM?: number;
    Taros?: number;
    ItemSelectionNeeded?: boolean;
    Items?: RawRewardItem[];
    NanoReward?: string;
    NanoRewardID?: number;
  };
  Tasks?: Record<string, RawTask>;
}

function normalizeMessage(raw: RawTaskMessage | undefined, iconMap: IconMap): TaskMessage | null {
  if (!raw) return null;
  const type = (raw.Type ?? 'None').trim();
  const sender = npcRef(raw.SendNPCID ?? 0, raw.SendNPCName ?? '', raw.SendNPCIcon ?? '', iconMap);
  const journal = {
    detailedMission: raw.JournalDetailedMissionDescription ?? '',
    detailedTask: raw.JournalDetailedTaskDescription ?? '',
    missionSummary: raw.JournalMissionSummary ?? '',
    missionCompleteSummary: raw.JournalMissionCompleteSummary ?? '',
  };
  const text = (raw.Text ?? '').trim();
  const anyContent =
    text ||
    journal.detailedMission ||
    journal.detailedTask ||
    journal.missionSummary ||
    journal.missionCompleteSummary ||
    sender;
  if (!anyContent && type === 'None') return null;
  return { sender, text, journal };
}

function normalizeTask(raw: RawTask, iconMap: IconMap): MissionTask {
  const monsterRequirements = Object.entries(raw.QuestItemMonsterRequirements ?? {})
    .map(([key, val]) => {
      const { id, name } = parseCompoundKey(key);
      const ref = monsterRef(id, name);
      if (!ref) return null;
      return { ref, killCount: val.KillCount ?? 0 };
    })
    .filter((x): x is { ref: Ref; killCount: number } => x !== null);

  return {
    id: raw.ID,
    type: raw.Type,
    objective: raw.CurrentObjective ?? '',
    onEndObjective: raw.OnEndTaskObjective ?? '',
    nextTaskOnEnd: raw.OnEndNextTaskID ?? 0,
    timeLimitSeconds: raw.TimeLimitSeconds ?? 0,
    waypointNPC: npcRef(
      raw.WaypointNPCID ?? 0,
      raw.WaypointNPCName ?? '',
      raw.WaypointNPCIcon ?? '',
      iconMap,
    ),
    escortNPC: npcRef(
      raw.EscortNPCID ?? 0,
      raw.EscortNPCName ?? '',
      raw.EscortNPCIcon ?? '',
      iconMap,
    ),
    requiredInstance: instanceRef(raw.RequiredInstanceID ?? 0, raw.RequiredInstance ?? ''),
    monsterRequirements,
    messages: {
      start: normalizeMessage(raw.MessageOnStart, iconMap),
      end: normalizeMessage(raw.MessageOnEnd, iconMap),
      fail: normalizeMessage(raw.MessageOnFail, iconMap),
    },
  };
}

function normalizeMission(raw: RawMission, iconMap: IconMap): Mission {
  const startNPC = npcRef(raw.MissionStartNPCID ?? 0, raw.MissionStartNPCName ?? '', raw.MissionStartNPCIcon ?? '', iconMap);
  const journalNPC = npcRef(raw.MissionJournalNPCID ?? 0, raw.MissionJournalNPCName ?? '', raw.MissionJournalNPCIcon ?? '', iconMap);
  const endNPC = npcRef(raw.MissionEndNPCID ?? 0, raw.MissionEndNPCName ?? '', raw.MissionEndNPCIcon ?? '', iconMap);

  const rewards = raw.Rewards ?? {};
  const items = (rewards.Items ?? [])
    .map((it) => {
      const ref = itemRef(it.ItemID, it.Name, it.Icon ?? '', iconMap);
      if (!ref) return null;
      return {
        ref,
        rarity: it.Rarity ?? '',
        requiredLevel: it.RequiredLevel ?? 0,
        itemKind: it.Type ?? '',
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const requiredMissions = Object.entries(raw.RequiredMissions ?? {})
    .map(([key, val]) => {
      const id = parseInt(key, 10);
      return missionRef(Number.isFinite(id) ? id : 0, val.Name ?? '');
    })
    .filter((x): x is Ref => x !== null);

  // RequiredMissionIDs may include 0 padding; only add ones not already covered by RequiredMissions
  const reqIds = new Set(requiredMissions.map((r) => r.id));
  for (const id of raw.RequiredMissionIDs ?? []) {
    if (id > 0 && !reqIds.has(id)) {
      const r = missionRef(id, '');
      if (r) requiredMissions.push(r);
    }
  }

  const barkers = Object.entries(raw.Barkers ?? {})
    .map(([key, text]) => {
      const { id, name } = parseCompoundKey(key);
      const npc = npcRef(id, name, '', iconMap);
      if (!npc) return null;
      return { npc, text };
    })
    .filter((x): x is { npc: Ref; text: string } => x !== null);

  const tasks = Object.values(raw.Tasks ?? {})
    .map((t) => normalizeTask(t, iconMap))
    .sort((a, b) => a.id - b.id);

  return {
    id: raw.ID,
    name: raw.Name,
    level: raw.Level,
    difficulty: raw.Difficulty,
    type: raw.Type,
    inGame: raw.InGame,
    startNPC,
    journalNPC,
    endNPC,
    requiredGuide: raw.RequiredGuide && raw.RequiredGuide !== 'None' ? raw.RequiredGuide : '',
    requiredNano: nanoRef(raw.RequiredNanoID ?? 0, raw.RequiredNano ?? '', '', iconMap),
    requiredMissions,
    rewards: {
      fm: rewards.FM ?? 0,
      taros: rewards.Taros ?? 0,
      itemSelectionNeeded: rewards.ItemSelectionNeeded ?? false,
      items,
      nano: nanoRef(rewards.NanoRewardID ?? 0, rewards.NanoReward ?? '', '', iconMap),
    },
    tasks,
    barkers,
  };
}

function indexEntry(m: Mission): MissionIndexEntry {
  return {
    id: m.id,
    name: m.name,
    level: m.level,
    difficulty: m.difficulty,
    type: m.type,
    startNPC: m.startNPC ? { name: m.startNPC.name, icon: m.startNPC.icon ?? '' } : null,
  };
}

/**
 * Read mission_info.json from a cached ZIP, normalize every entry, and emit
 * chunked records + an index file under site/public/data/<slug>/.
 */
export async function normalizeMissions(
  zipPath: string,
  slug: string,
  iconMap: IconMap,
): Promise<{ count: number; chunks: number }> {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry('info/mission_info.json');
  if (!entry) {
    return { count: 0, chunks: 0 };
  }
  const raw = JSON.parse(entry.getData().toString('utf8')) as Record<string, RawMission>;

  const missions: Mission[] = Object.values(raw)
    .map((m) => normalizeMission(m, iconMap))
    .sort((a, b) => a.id - b.id);

  const { chunks } = await writeChunks(slug, 'missions', missions);
  await writeIndex(slug, 'missions', missions.map(indexEntry));

  return { count: missions.length, chunks };
}

/** Used by the orchestrator to advertise which entity types have data for a build. */
export const MISSION_TYPE = 'missions' as const;
