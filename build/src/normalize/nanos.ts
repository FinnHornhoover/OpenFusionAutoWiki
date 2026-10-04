import AdmZip from 'adm-zip';

import { chunkOf, writeChunks, writeIndex } from '../chunk.js';
import { iconFor, itemRef } from './refs.js';
import type {
  Nano,
  NanoIndexEntry,
  NanoPower,
  Ref,
} from './types.js';
import type { IconMap } from '../icons.js';
import type { NanoMissionsMap } from './missions.js';

/** Extract level from comment text like "LEVEL 28 NANO" or "LVL 5". 0 when absent. */
function levelFromComment(comment: string): number {
  const m = /L(?:VL|EVEL)\s*(\d+)/i.exec(comment);
  return m ? parseInt(m[1], 10) : 0;
}

interface RawNanoPower {
  ID: number;
  Name?: string;
  Comment?: string;
  Icon?: string;
  TypeName?: string;
  SkillID?: number;
  SkillName?: string;
  SkillIcon?: string;
  SkillCoolTime?: number;
  SkillRange?: number;
  SkillAngle?: number;
  SkillArea?: number;
  SkillTargetNumber?: number;
  PowerItem?: {
    ItemID: number;
    TypeID?: number;
    Name?: string;
    Icon?: string;
  };
  PowerItemID?: number;
  PowerItemCount?: number;
}

interface RawNano {
  ID: number;
  Name: string;
  Comment?: string;
  NanoIcon?: string;
  NanoType?: string;
  NanoTypeID?: number;
  NanoPowers?: Record<string, RawNanoPower>;
}

function normalizePower(raw: RawNanoPower, iconMap: IconMap): NanoPower {
  const pi = raw.PowerItem;
  const powerItem: Ref | null = pi && pi.ItemID > 0
    ? itemRef(pi.TypeID ?? 0, pi.ItemID, pi.Name ?? '', pi.Icon ?? '', iconMap)
    : null;
  return {
    id: raw.ID,
    name: (raw.Name ?? '').trim(),
    comment: (raw.Comment ?? '').trim(),
    icon: iconFor(raw.Icon ?? '', iconMap),
    typeName: (raw.TypeName ?? '').trim(),
    skillName: (raw.SkillName ?? '').trim(),
    skillId: raw.SkillID ?? 0,
    skillIcon: iconFor(raw.SkillIcon ?? '', iconMap),
    skillCoolTime: raw.SkillCoolTime ?? 0,
    skillRange: raw.SkillRange ?? 0,
    skillAngle: raw.SkillAngle ?? 0,
    skillArea: raw.SkillArea ?? 0,
    skillTargetNumber: raw.SkillTargetNumber ?? 0,
    powerItem,
    powerItemCount: raw.PowerItemCount ?? 0,
  };
}

function normalizeNano(
  raw: RawNano,
  iconMap: IconMap,
  nanoMissions: NanoMissionsMap,
): Nano {
  const powers: NanoPower[] = Object.values(raw.NanoPowers ?? {})
    .map((p) => normalizePower(p, iconMap))
    .sort((a, b) => a.id - b.id);
  const back = nanoMissions.get(raw.ID);
  const comment = (raw.Comment ?? '').trim();
  return {
    id: raw.ID,
    name: raw.Name,
    comment,
    icon: iconFor(raw.NanoIcon ?? '', iconMap),
    nanoType: raw.NanoType ?? '',
    nanoTypeId: raw.NanoTypeID ?? 0,
    awardLevel: levelFromComment(comment),
    obtainable: false,
    powers,
    missionsRewarding: back?.rewards ?? [],
    missionsRequiring: back?.required ?? [],
  };
}

function indexEntry(n: Nano): NanoIndexEntry {
  return { id: n.id, name: n.name, icon: n.icon, nanoType: n.nanoType, awardLevel: n.awardLevel, obtainable: n.obtainable };
}

export async function normalizeNanos(
  zipPath: string,
  slug: string,
  iconMap: IconMap,
  nanoMissions: NanoMissionsMap,
): Promise<{ count: number; chunks: number; linked: number }> {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry('info/nano_info.json');
  if (!entry) return { count: 0, chunks: 0, linked: 0 };
  const raw = JSON.parse(entry.getData().toString('utf8')) as Record<string, RawNano>;

  const nanos: Nano[] = Object.values(raw)
    .map((n) => normalizeNano(n, iconMap, nanoMissions))
    .filter((n) => n.id > 0)
    .sort((a, b) => a.id - b.id);

  const playerEntry = zip.getEntry('info/player_info.json');
  const players = playerEntry
    ? JSON.parse(playerEntry.getData().toString('utf8')) as Record<string, {
      Level?: number;
      NanosUnlocked?: Record<string, { ID?: number }>;
    }>
    : {};
  const unlocked = new Set(Object.values(players).flatMap((player) =>
    Object.values(player.NanosUnlocked ?? {}).map((nano) => nano.ID)));
  const capsuleNameKey = (name: string) => name.toLowerCase()
    .replace(/^p\.?\s*bubblegum$/, 'princess bubblegum').replace(/[^a-z0-9]/g, '');
  const capsuleNanos = new Set<string>();
  const itemEntry = zip.getEntry('info/item_info.json');
  if (itemEntry) {
    const items = JSON.parse(itemEntry.getData().toString('utf8')) as Record<string, { TypeID?: number; Name?: string }>;
    for (const item of Object.values(items)) {
      if (item.TypeID !== 9) continue;
      const match = /^(?:Nano\s+(.+)|(.+)\s+Nano)\s+Capsule$/i.exec(item.Name ?? '');
      if (match) capsuleNanos.add(capsuleNameKey(match[1] ?? match[2]));
    }
  }
  for (const nano of nanos) {
    nano.obtainable = unlocked.has(nano.id) || capsuleNanos.has(capsuleNameKey(nano.name))
      || nano.name.trim().toLowerCase() === 'unstable nano';
  }

  // Original builds lack level text. Their player rows describe unlocks before
  // reaching the next level, so use the earliest unlock row's level plus one.
  if (!nanos.some((nano) => /L(?:VL|EVEL)\s*\d+/i.test(nano.comment))) {
    if (playerEntry) {
      const unlockLevels = new Map<number, number>();
      for (const player of Object.values(players)) {
        if (player.Level == null) continue;
        for (const nano of Object.values(player.NanosUnlocked ?? {})) {
          if (nano.ID == null || nano.ID <= 0) continue;
          const level = player.Level + 1;
          unlockLevels.set(nano.ID, Math.min(unlockLevels.get(nano.ID) ?? level, level));
        }
      }
      for (const nano of nanos) nano.awardLevel = unlockLevels.get(nano.id) ?? 0;
    }
  }

  const linked = nanos.filter((n) => n.missionsRewarding.length > 0 || n.missionsRequiring.length > 0).length;

  // Nanos fit in a single chunk per build.
  const { chunks } = await writeChunks(slug, 'nanos', nanos, (n) => ({
    url: n.id,
    chunk: chunkOf(n.id),
  }));
  await writeIndex(slug, 'nanos', nanos.map(indexEntry));

  return { count: nanos.length, chunks, linked };
}
