import AdmZip from 'adm-zip';

import { chunkOf, writeChunks, writeIndex } from '../chunk.js';
import type { IconMap } from '../icons.js';
import type { NpcGrouping } from './npcGrouping.js';
import type { NpcNameIndex } from './npcNameIndex.js';
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
  GuideEmail,
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
  GuideEmails?: Record<string, string>;
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
  TypeID?: number;
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

function normalizeMessage(raw: RawTaskMessage | undefined, iconMap: IconMap, grouping: NpcGrouping): TaskMessage | null {
  if (!raw) return null;
  const type = (raw.Type ?? 'None').trim();
  const sender = npcRef(raw.SendNPCID ?? 0, raw.SendNPCName ?? '', raw.SendNPCIcon ?? '', iconMap, grouping);
  const journal = {
    detailedMission: raw.JournalDetailedMissionDescription ?? '',
    detailedTask: raw.JournalDetailedTaskDescription ?? '',
    missionSummary: raw.JournalMissionSummary ?? '',
    missionCompleteSummary: raw.JournalMissionCompleteSummary ?? '',
  };
  const text = (raw.Text ?? '').trim();
  const bubbleText = (raw.DialogBubble ?? '').trim();
  const bubbleNpc = npcRef(
    raw.DialogBubbleNPCID ?? 0,
    raw.DialogBubbleNPCName ?? '',
    raw.DialogBubbleNPCIcon ?? '',
    iconMap,
    grouping,
  );
  const bubble = bubbleText || bubbleNpc ? { sender: bubbleNpc, text: bubbleText } : null;
  const anyContent =
    text ||
    bubble ||
    journal.detailedMission ||
    journal.detailedTask ||
    journal.missionSummary ||
    journal.missionCompleteSummary ||
    sender;
  if (!anyContent && type === 'None') return null;
  return { sender, text, bubble, journal };
}

function normalizeGuideEmails(raw: RawTask, npcNameIndex: NpcNameIndex): GuideEmail[] {
  const out: GuideEmail[] = [];
  for (const [sender, body] of Object.entries(raw.GuideEmails ?? {})) {
    const trimmed = (body ?? '').trim();
    if (!sender && !trimmed) continue;
    out.push({
      sender,
      senderRef: npcNameIndex.get(sender.toLowerCase()) ?? null,
      body: trimmed,
    });
  }
  return out;
}

function normalizeTask(raw: RawTask, iconMap: IconMap, npcNameIndex: NpcNameIndex, grouping: NpcGrouping): MissionTask {
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
      grouping,
    ),
    escortNPC: npcRef(
      raw.EscortNPCID ?? 0,
      raw.EscortNPCName ?? '',
      raw.EscortNPCIcon ?? '',
      iconMap,
      grouping,
    ),
    requiredInstance: instanceRef(raw.RequiredInstanceID ?? 0, raw.RequiredInstance ?? ''),
    monsterRequirements,
    messages: {
      start: normalizeMessage(raw.MessageOnStart, iconMap, grouping),
      end: normalizeMessage(raw.MessageOnEnd, iconMap, grouping),
      fail: normalizeMessage(raw.MessageOnFail, iconMap, grouping),
    },
    guideEmails: normalizeGuideEmails(raw, npcNameIndex),
  };
}

function normalizeMission(raw: RawMission, iconMap: IconMap, npcNameIndex: NpcNameIndex, grouping: NpcGrouping): Mission {
  const startNPC = npcRef(raw.MissionStartNPCID ?? 0, raw.MissionStartNPCName ?? '', raw.MissionStartNPCIcon ?? '', iconMap, grouping);
  const journalNPC = npcRef(raw.MissionJournalNPCID ?? 0, raw.MissionJournalNPCName ?? '', raw.MissionJournalNPCIcon ?? '', iconMap, grouping);
  const endNPC = npcRef(raw.MissionEndNPCID ?? 0, raw.MissionEndNPCName ?? '', raw.MissionEndNPCIcon ?? '', iconMap, grouping);

  const rewards = raw.Rewards ?? {};
  const items = (rewards.Items ?? [])
    .map((it) => {
      const ref = itemRef(it.TypeID ?? 0, it.ItemID, it.Name, it.Icon ?? '', iconMap);
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
      const npc = npcRef(id, name, '', iconMap, grouping);
      if (!npc) return null;
      return { npc, text };
    })
    .filter((x): x is { npc: Ref; text: string } => x !== null);

  const tasks = Object.values(raw.Tasks ?? {})
    .map((t) => normalizeTask(t, iconMap, npcNameIndex, grouping))
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
    requiredByMissions: [], // filled in a second pass
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

/** Lightweight back-reference: missions a specific NPC participates in. */
export interface NpcMissionsEntry {
  starts: Ref[];
  journals: Ref[];
  ends: Ref[];
}
export type NpcMissionsMap = Map<number, NpcMissionsEntry>;

/** Back-reference: missions that require killing a specific mob type. */
export type MobMissionsMap = Map<number, Ref[]>;

/** Back-reference: missions a specific nano is rewarded by or required for. */
export interface NanoMissionsEntry {
  rewards: Ref[];
  required: Ref[];
}
export type NanoMissionsMap = Map<number, NanoMissionsEntry>;

function pushRole(map: NpcMissionsMap, npcId: number, role: keyof NpcMissionsEntry, ref: Ref): void {
  let entry = map.get(npcId);
  if (!entry) {
    entry = { starts: [], journals: [], ends: [] };
    map.set(npcId, entry);
  }
  // Avoid duplicates within the same role for the same mission id
  if (!entry[role].some((r) => r.id === ref.id)) entry[role].push(ref);
}

/**
 * Read mission_info.json from a cached ZIP, normalize every entry, and emit
 * chunked records + an index file under site/public/data/<slug>/. Also
 * returns an inverted map of NPC id → { starts, journals, ends } so the
 * NPC normalizer can show "missions given by this NPC" without re-scanning.
 */
export async function normalizeMissions(
  zipPath: string,
  slug: string,
  iconMap: IconMap,
  npcNameIndex: NpcNameIndex,
  grouping: NpcGrouping,
): Promise<{
  count: number;
  chunks: number;
  npcMissions: NpcMissionsMap;
  mobMissions: MobMissionsMap;
  nanoMissions: NanoMissionsMap;
}> {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry('info/mission_info.json');
  const npcMissions: NpcMissionsMap = new Map();
  const mobMissions: MobMissionsMap = new Map();
  const nanoMissions: NanoMissionsMap = new Map();
  if (!entry) {
    return { count: 0, chunks: 0, npcMissions, mobMissions, nanoMissions };
  }
  const raw = JSON.parse(entry.getData().toString('utf8')) as Record<string, RawMission>;

  const missions: Mission[] = Object.values(raw)
    .map((m) => normalizeMission(m, iconMap, npcNameIndex, grouping))
    .sort((a, b) => a.id - b.id);

  // Build the inverted indexes:
  //   NPC → missions in the three giver roles
  //   mob → missions that require killing it
  //   mission → missions that name it as a prereq
  const byId = new Map<number, Mission>();
  for (const m of missions) byId.set(m.id, m);

  for (const m of missions) {
    const missionAsRef: Ref = { type: 'mission', id: m.id, name: m.name };
    // NPC and mission Ref.ids are always numeric (only item refs are string-compound).
    if (m.startNPC) pushRole(npcMissions, m.startNPC.id as number, 'starts', missionAsRef);
    if (m.journalNPC) pushRole(npcMissions, m.journalNPC.id as number, 'journals', missionAsRef);
    if (m.endNPC) pushRole(npcMissions, m.endNPC.id as number, 'ends', missionAsRef);

    for (const req of m.requiredMissions) {
      const target = byId.get(req.id as number);
      if (target && !target.requiredByMissions.some((r) => r.id === m.id)) {
        target.requiredByMissions.push(missionAsRef);
      }
    }

    for (const task of m.tasks) {
      for (const mr of task.monsterRequirements) {
        const mobId = mr.ref.id as number;
        let list = mobMissions.get(mobId);
        if (!list) {
          list = [];
          mobMissions.set(mobId, list);
        }
        if (!list.some((r) => r.id === m.id)) list.push(missionAsRef);
      }
    }

    // Nano roles: rewarded by a mission or required to start one.
    const upsertNano = (nanoId: number, role: keyof NanoMissionsEntry) => {
      let e = nanoMissions.get(nanoId);
      if (!e) {
        e = { rewards: [], required: [] };
        nanoMissions.set(nanoId, e);
      }
      if (!e[role].some((r) => r.id === m.id)) e[role].push(missionAsRef);
    };
    if (m.rewards.nano) upsertNano(m.rewards.nano.id as number, 'rewards');
    if (m.requiredNano) upsertNano(m.requiredNano.id as number, 'required');
  }

  const { chunks } = await writeChunks(slug, 'missions', missions, (m) => ({
    url: m.id,
    chunk: chunkOf(m.id),
  }));
  await writeIndex(slug, 'missions', missions.map(indexEntry));

  return { count: missions.length, chunks, npcMissions, mobMissions, nanoMissions };
}

/** Used by the orchestrator to advertise which entity types have data for a build. */
export const MISSION_TYPE = 'missions' as const;
