import AdmZip from 'adm-zip';

import { iconFor } from './refs.js';
import type { Ref } from './types.js';
import type { IconMap } from '../icons.js';

/**
 * Maps lowercased NPC name → ref. Only names that uniquely identify a single
 * in-game NPC are kept; ambiguous names (e.g., generic "Recruit") are dropped
 * so we don't link to a random NPC.
 */
export type NpcNameIndex = Map<string, Ref>;

interface RawNpcType {
  ID: number;
  Name?: string;
  Icon?: string;
  InGame?: boolean;
}

export function buildNpcNameIndex(zipPath: string, iconMap: IconMap): NpcNameIndex {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry('info/npc_type_info.json');
  const index: NpcNameIndex = new Map();
  if (!entry) return index;

  const raw = JSON.parse(entry.getData().toString('utf8')) as Record<string, RawNpcType>;
  const firstByName = new Map<string, RawNpcType>();
  const ambiguous = new Set<string>();

  for (const t of Object.values(raw)) {
    const name = (t.Name ?? '').trim();
    if (!name || !t.InGame) continue;
    const key = name.toLowerCase();
    if (firstByName.has(key)) ambiguous.add(key);
    else firstByName.set(key, t);
  }

  for (const [key, t] of firstByName) {
    if (ambiguous.has(key)) continue;
    index.set(key, {
      type: 'npc',
      id: t.ID,
      name: t.Name ?? '',
      icon: iconFor(t.Icon ?? '', iconMap),
    });
  }
  return index;
}
