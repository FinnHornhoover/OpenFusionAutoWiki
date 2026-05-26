import AdmZip from 'adm-zip';

import type { InstanceNameIndex } from './instanceLookup.js';
import type { NpcGrouping } from './npcGrouping.js';
import { slugify } from './slug.js';

interface RawNpcInstance {
  TypeID: number;
  X?: number;
  Y?: number;
  Z?: number;
  AreaZone?: string;
  InstanceID?: number;
}

export interface NpcPoint {
  x: number;
  y: number;
  z: number;
  areaZone: string;
  areaId: string;
  instanceID: number;
  instanceName: string;
}

/** First known spawn point per canonical NPC type, used for mission waypoints. */
export type NpcLocationMap = Map<number, NpcPoint>;

export function buildNpcLocationMap(
  zipPath: string,
  grouping: NpcGrouping,
  instanceNames: InstanceNameIndex,
): NpcLocationMap {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry('info/npc_info.json');
  const out: NpcLocationMap = new Map();
  if (!entry) return out;
  const raw = JSON.parse(entry.getData().toString('utf8')) as Record<string, Record<string, RawNpcInstance>>;
  for (const typeBucket of Object.values(raw)) {
    if (!typeBucket || typeof typeBucket !== 'object') continue;
    for (const inst of Object.values(typeBucket)) {
      if (!inst || typeof inst !== 'object') continue;
      const canonical = grouping.memberToCanonical.get(inst.TypeID) ?? inst.TypeID;
      if (out.has(canonical)) continue; // first spawn wins
      const areaZone = inst.AreaZone ?? '';
      const instanceID = inst.InstanceID ?? 0;
      out.set(canonical, {
        x: inst.X ?? 0,
        y: inst.Y ?? 0,
        z: inst.Z ?? 0,
        areaZone,
        areaId: areaZone && areaZone !== 'Unknown - Unknown' ? slugify(areaZone) : '',
        instanceID,
        instanceName: instanceNames.get(instanceID) ?? '',
      });
    }
  }
  return out;
}
