import AdmZip from 'adm-zip';

import type { IconMap } from '../icons.js';
import { iconFor } from './refs.js';
import type { InstanceNameIndex } from './instanceLookup.js';
import { slugify } from './slug.js';

interface RawMobType {
  ID: number;
  Icon?: string;
  Name?: string;
}

interface RawMobInstance {
  TypeID?: number;
  AreaZone?: string;
  InstanceID?: number;
  X?: number;
  Y?: number;
  Z?: number;
}

export interface MissionMobLocation {
  areaZone: string;
  areaId: string;
  x: number;
  y: number;
  z: number;
  instanceID: number;
  instanceName: string;
  points: Array<{ x: number; y: number }>;
}

export interface MissionMobInfo {
  icon: string;
  mapIcon: string;
  locations: MissionMobLocation[];
}

export type MissionMobLocationMap = Map<number, MissionMobInfo>;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function monsterMapIcon(name: string): string {
  return name.includes('Fusion') && !name.includes('Fusion Spawn')
    ? '/minimap/mapicons/lair_fusion_boss_monster.png'
    : '/minimap/mapicons/other_monster.png';
}

export function buildMissionMobLocationMap(
  zipPath: string,
  iconMap: IconMap,
  instanceNames: InstanceNameIndex,
): MissionMobLocationMap {
  const zip = new AdmZip(zipPath);
  const typeEntry = zip.getEntry('info/mob_type_info.json');
  const instanceEntry = zip.getEntry('info/mob_info.json');
  const out: MissionMobLocationMap = new Map();
  if (!typeEntry || !instanceEntry) return out;

  const types = JSON.parse(typeEntry.getData().toString('utf8')) as Record<string, RawMobType>;
  const instances = JSON.parse(instanceEntry.getData().toString('utf8')) as Record<string, Record<string, RawMobInstance>>;
  const pointsByType = new Map<number, RawMobInstance[]>();

  for (const group of Object.values(instances)) {
    for (const point of Object.values(group ?? {})) {
      const typeId = point?.TypeID ?? 0;
      if (typeId <= 0) continue;
      const points = pointsByType.get(typeId) ?? [];
      points.push(point);
      pointsByType.set(typeId, points);
    }
  }

  for (const raw of Object.values(types)) {
    const grouped = new Map<string, RawMobInstance[]>();
    for (const point of pointsByType.get(raw.ID) ?? []) {
      const areaZone = point.AreaZone ?? '';
      const instanceID = point.InstanceID ?? 0;
      const key = `${areaZone}|${instanceID}`;
      const points = grouped.get(key) ?? [];
      points.push(point);
      grouped.set(key, points);
    }
    const locations = [...grouped.values()].map((points) => {
      const first = points[0];
      const areaZone = first.AreaZone ?? '';
      const instanceID = first.InstanceID ?? 0;
      return {
        areaZone,
        areaId: areaZone && areaZone !== 'Unknown - Unknown' ? slugify(areaZone) : '',
        x: median(points.map((point) => point.X ?? 0)),
        y: median(points.map((point) => point.Y ?? 0)),
        z: median(points.map((point) => point.Z ?? 0)),
        instanceID,
        instanceName: instanceNames.get(instanceID) ?? '',
        points: points.map((point) => ({ x: point.X ?? 0, y: point.Y ?? 0 })),
      };
    });
    out.set(raw.ID, {
      icon: iconFor(raw.Icon ?? '', iconMap),
      mapIcon: monsterMapIcon(raw.Name ?? ''),
      locations,
    });
  }

  return out;
}
