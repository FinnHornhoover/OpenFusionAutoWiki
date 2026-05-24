import AdmZip from 'adm-zip';

import type { NpcGrouping } from './npcGrouping.js';

interface RawNpcInstance {
  TypeID: number;
  X?: number;
  Y?: number;
  AreaZone?: string;
}

export interface NpcPoint {
  x: number;
  y: number;
  areaZone: string;
}

/**
 * Map canonical NPC type-ID → first known spawn point. Used to give mission
 * task waypoints a renderable location without a separate fetch at runtime.
 * Falls back to {} when npc_info.json is missing.
 */
export type NpcLocationMap = Map<number, NpcPoint>;

export function buildNpcLocationMap(zipPath: string, grouping: NpcGrouping): NpcLocationMap {
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
      out.set(canonical, {
        x: inst.X ?? 0,
        y: inst.Y ?? 0,
        areaZone: inst.AreaZone ?? '',
      });
    }
  }
  return out;
}
