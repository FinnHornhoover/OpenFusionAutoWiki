import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants as fsc } from 'node:fs';
import { join } from 'node:path';

import { DATA_OUT } from '../paths.js';
import type {
  AreaIndexEntry,
  InfectedZoneIndexEntry,
  InstanceIndexEntry,
  CodeIndexEntry,
  ItemIndexEntry,
  ItemSetIndexEntry,
  MissionIndexEntry,
  MobIndexEntry,
  NanoIndexEntry,
  NpcIndexEntry,
} from './types.js';

/** Per-build search row — one entry per searchable entity, all 6 types unioned. */
export interface SearchRow {
  /** URL segment for this entity type (matches the route segment + builtTypes). */
  type: 'missions' | 'npcs' | 'items' | 'item-sets' | 'codes' | 'monsters' | 'areas' | 'instances' | 'infected-zones' | 'nanos' | 'player-stats';
  /** URL identifier (numeric or compound string, same shape Ref.id uses). */
  id: number | string;
  name: string;
  icon: string;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path, fsc.F_OK); return true; } catch { return false; }
}

async function loadIndex<T>(slug: string, type: string): Promise<T[]> {
  const path = join(DATA_OUT, slug, 'index', `${type}.json`);
  if (!(await exists(path))) return [];
  return JSON.parse(await readFile(path, 'utf8')) as T[];
}

/**
 * Build a single flat search file for one game build by unioning the per-type
 * index files already on disk. Each row carries id/name/icon — the minimum
 * needed to render a hit and route to it.
 *
 * Out-of-game NPCs and monsters are excluded by default; they remain reachable
 * via the per-type indexes' "Hide out-of-game" toggles.
 */
export async function writeSearchIndex(slug: string): Promise<{ count: number; bytes: number }> {
  const [missions, npcs, items, itemSets, codes, monsters, areas, instances, infectedZones, nanos] = await Promise.all([
    loadIndex<MissionIndexEntry>(slug, 'missions'),
    loadIndex<NpcIndexEntry>(slug, 'npcs'),
    loadIndex<ItemIndexEntry>(slug, 'items'),
    loadIndex<ItemSetIndexEntry>(slug, 'item-sets'),
    loadIndex<CodeIndexEntry>(slug, 'codes'),
    loadIndex<MobIndexEntry>(slug, 'monsters'),
    loadIndex<AreaIndexEntry>(slug, 'areas'),
    loadIndex<InstanceIndexEntry>(slug, 'instances'),
    loadIndex<InfectedZoneIndexEntry>(slug, 'infected-zones'),
    loadIndex<NanoIndexEntry>(slug, 'nanos'),
  ]);

  const rows: SearchRow[] = [];
  for (const m of missions) {
    rows.push({ type: 'missions', id: m.id, name: m.name, icon: m.startNPC?.icon ?? '' });
  }
  for (const n of npcs) {
    if (!n.inGame) continue;
    rows.push({ type: 'npcs', id: n.id, name: n.name, icon: n.icon });
  }
  for (const it of items) {
    rows.push({ type: 'items', id: it.id, name: it.name, icon: it.icon });
  }
  for (const set of itemSets) {
    rows.push({ type: 'item-sets', id: set.id, name: set.name, icon: '' });
  }
  for (const code of codes) {
    rows.push({ type: 'codes', id: code.id, name: code.code, icon: code.icon });
  }
  for (const mb of monsters) {
    if (!mb.inGame) continue;
    rows.push({ type: 'monsters', id: mb.id, name: mb.name, icon: mb.icon });
  }
  for (const a of areas) {
    rows.push({ type: 'areas', id: a.id, name: a.name, icon: '' });
  }
  for (const inst of instances) {
    if (!inst.inGame) continue;
    rows.push({ type: 'instances', id: inst.id, name: inst.name, icon: '' });
  }
  for (const iz of infectedZones) {
    if (!iz.inGame) continue;
    rows.push({ type: 'infected-zones', id: iz.id, name: iz.name, icon: iz.icon });
  }
  for (const na of nanos) {
    rows.push({ type: 'nanos', id: na.id, name: na.name, icon: na.icon });
  }
  rows.push({ type: 'player-stats', id: '', name: 'Player Stats', icon: '' });

  const dir = join(DATA_OUT, slug);
  await mkdir(dir, { recursive: true });
  const payload = JSON.stringify(rows);
  await writeFile(join(dir, 'search.json'), payload);
  return { count: rows.length, bytes: payload.length };
}
