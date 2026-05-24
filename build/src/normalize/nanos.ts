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
    powers,
    missionsRewarding: back?.rewards ?? [],
    missionsRequiring: back?.required ?? [],
  };
}

function indexEntry(n: Nano): NanoIndexEntry {
  return { id: n.id, name: n.name, icon: n.icon, nanoType: n.nanoType, awardLevel: n.awardLevel };
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

  const linked = nanos.filter((n) => n.missionsRewarding.length > 0 || n.missionsRequiring.length > 0).length;

  // Nanos fit in a single chunk per build.
  const { chunks } = await writeChunks(slug, 'nanos', nanos, (n) => ({
    url: n.id,
    chunk: chunkOf(n.id),
  }));
  await writeIndex(slug, 'nanos', nanos.map(indexEntry));

  return { count: nanos.length, chunks, linked };
}
