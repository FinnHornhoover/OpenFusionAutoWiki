import AdmZip from 'adm-zip';

import { chunkOf, writeChunks, writeIndex } from '../chunk.js';
import { iconFor } from './refs.js';
import type {
  Mob,
  MobIndexEntry,
  MobLocation,
  Ref,
} from './types.js';
import type { IconMap } from '../icons.js';
import type { MobMissionsMap } from './missions.js';
import type { MobItemsMap } from './items.js';
import type { InstanceNameIndex } from './instanceLookup.js';
import { slugify } from './slug.js';

interface RawMobType {
  ID: number;
  Name: string;
  Icon?: string;
  Category?: string;
  ColorType?: string;
  Comment?: string;
  Level?: number;
  InGame?: boolean;
  Height?: number;
  Scale?: number;
  Radius?: number;

  StandardHP?: number;
  AttackPower?: number;
  AttackRange?: number;
  CombatRange?: number;
  SightRange?: number;
  IdleRange?: number;
  Power?: number;
  Protection?: number;
  Accuracy?: number;
  WalkSpeed?: number;
  RunSpeed?: number;
  RespawnSeconds?: number;
  RespawnTime?: string;

  ActiveSkill?: string;
  ActiveSkillIcon?: string;
  PassiveBuff?: string;
  PassiveBuffIcon?: string;
  SupportSkill?: string;
  SupportSkillIcon?: string;
}

interface RawMobInstance {
  ID?: string | number;
  AreaZone?: string;
  TypeID?: number;
  TypeIcon?: string;
  TypeName?: string;
  X?: number;
  Y?: number;
  Z?: number;
  InstanceID?: number;
  HP?: number;
}

/** Group locations under the mob type they spawn for. mob_info is keyed by group→instances. */
function buildLocationsByType(
  rawInstances: Record<string, Record<string, RawMobInstance>>,
  instanceNames: InstanceNameIndex,
): Map<number, MobLocation[]> {
  const out = new Map<number, MobLocation[]>();
  for (const [groupId, group] of Object.entries(rawInstances)) {
    if (!group || typeof group !== 'object') continue;
    for (const inst of Object.values(group)) {
      if (typeof inst !== 'object' || !inst) continue;
      const tid = inst.TypeID ?? 0;
      if (tid <= 0) continue;
      let list = out.get(tid);
      if (!list) {
        list = [];
        out.set(tid, list);
      }
      const areaZone = inst.AreaZone ?? '';
      const instanceID = inst.InstanceID ?? 0;
      list.push({
        areaZone,
        areaId: areaZone && areaZone !== 'Unknown - Unknown' ? slugify(areaZone) : '',
        x: inst.X ?? 0,
        y: inst.Y ?? 0,
        z: inst.Z ?? 0,
        instanceID,
        instanceName: instanceNames.get(instanceID) ?? '',
        hp: inst.HP ?? 0,
        groupId,
      });
    }
  }
  return out;
}

function mostCommonSpawnHP(locations: MobLocation[]): number {
  const counts = new Map<number, number>();
  let bestHP = 0;
  let bestCount = 0;
  for (const loc of locations) {
    if (loc.hp <= 0) continue;
    const count = (counts.get(loc.hp) ?? 0) + 1;
    counts.set(loc.hp, count);
    if (count > bestCount) {
      bestHP = loc.hp;
      bestCount = count;
    }
  }
  return bestHP;
}

function normalizeMob(
  raw: RawMobType,
  iconMap: IconMap,
  locations: MobLocation[],
  mobMissions: MobMissionsMap,
  mobItems: MobItemsMap,
): Mob {
  const standardHP = raw.StandardHP ?? 0;
  const displayHP = mostCommonSpawnHP(locations) || standardHP;

  return {
    id: raw.ID,
    name: raw.Name,
    icon: iconFor(raw.Icon ?? '', iconMap),
    category: raw.Category ?? '',
    colorType: raw.ColorType ?? '',
    level: raw.Level ?? 0,
    inGame: raw.InGame ?? false,
    comment: (raw.Comment ?? '').trim(),
    height: raw.Height ?? 0,
    scale: raw.Scale ?? 1,
    radius: raw.Radius ?? 0,

    standardHP,
    displayHP,
    attackPower: raw.AttackPower ?? 0,
    attackRange: raw.AttackRange ?? 0,
    combatRange: raw.CombatRange ?? 0,
    sightRange: raw.SightRange ?? 0,
    idleRange: raw.IdleRange ?? 0,
    power: raw.Power ?? 0,
    protection: raw.Protection ?? 0,
    accuracy: raw.Accuracy ?? 0,
    walkSpeed: raw.WalkSpeed ?? 0,
    runSpeed: raw.RunSpeed ?? 0,
    respawnSeconds: raw.RespawnSeconds ?? 0,
    respawnTime: (raw.RespawnTime ?? '').trim(),

    activeSkill: (raw.ActiveSkill ?? '').trim(),
    activeSkillIcon: iconFor(raw.ActiveSkillIcon ?? '', iconMap),
    passiveBuff: (raw.PassiveBuff ?? '').trim(),
    passiveBuffIcon: iconFor(raw.PassiveBuffIcon ?? '', iconMap),
    supportSkill: (raw.SupportSkill ?? '').trim(),
    supportSkillIcon: iconFor(raw.SupportSkillIcon ?? '', iconMap),

    missionsRequiring: mobMissions.get(raw.ID) ?? [],
    drops: (mobItems.get(raw.ID) ?? [])
      .slice()
      .sort((a, b) => {
        const ma = Math.max(a.boyProbability, a.girlProbability);
        const mb = Math.max(b.boyProbability, b.girlProbability);
        return (mb - ma) || a.item.name.localeCompare(b.item.name);
      }),

    locations,
  };
}

function indexEntry(mob: Mob): MobIndexEntry {
  return {
    id: mob.id,
    name: mob.name,
    icon: mob.icon,
    level: mob.level,
    standardHP: mob.standardHP,
    colorType: mob.colorType,
    category: mob.category,
    instanceCount: mob.locations.length,
    inGame: mob.inGame,
  };
}

/**
 * Read mob_type_info.json + mob_info.json. Combine type metadata with spawn
 * instances, then attach the mission-requirement and item-drop back-indexes
 * built earlier in the orchestrator.
 */
export async function normalizeMobs(
  zipPath: string,
  slug: string,
  iconMap: IconMap,
  mobMissions: MobMissionsMap,
  mobItems: MobItemsMap,
  instanceNames: InstanceNameIndex,
): Promise<{ count: number; chunks: number; linked: number; dropping: number }> {
  const zip = new AdmZip(zipPath);
  const typeEntry = zip.getEntry('info/mob_type_info.json');
  const instEntry = zip.getEntry('info/mob_info.json');
  if (!typeEntry) {
    return { count: 0, chunks: 0, linked: 0, dropping: 0 };
  }

  const rawTypes = JSON.parse(typeEntry.getData().toString('utf8')) as Record<string, RawMobType>;
  const rawInsts = instEntry
    ? (JSON.parse(instEntry.getData().toString('utf8')) as Record<string, Record<string, RawMobInstance>>)
    : {};

  const locationsByType = buildLocationsByType(rawInsts, instanceNames);

  const mobs: Mob[] = Object.values(rawTypes)
    .map((t) => normalizeMob(t, iconMap, locationsByType.get(t.ID) ?? [], mobMissions, mobItems))
    .sort((a, b) => a.id - b.id);

  const linked = mobs.filter((m) => m.missionsRequiring.length > 0).length;
  const dropping = mobs.filter((m) => m.drops.length > 0).length;

  const { chunks } = await writeChunks(slug, 'monsters', mobs, (m) => ({
    url: m.id,
    chunk: chunkOf(m.id),
  }));
  await writeIndex(slug, 'monsters', mobs.map(indexEntry));

  // Suppress unused-helper warnings.
  void (null as unknown as Ref);

  return { count: mobs.length, chunks, linked, dropping };
}
