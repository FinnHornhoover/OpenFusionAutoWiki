import AdmZip from 'adm-zip';

import { iconFor } from './refs.js';
import type { NpcGrouping } from './npcGrouping.js';
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

export function buildNpcNameIndex(
  zipPath: string,
  iconMap: IconMap,
  grouping: NpcGrouping,
): NpcNameIndex {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry('info/npc_type_info.json');
  const index: NpcNameIndex = new Map();
  if (!entry) return index;

  const raw = JSON.parse(entry.getData().toString('utf8')) as Record<string, RawNpcType>;

  // Collapse across grouping first: a name that maps to >1 canonical ID is ambiguous;
  // a name that maps to exactly one canonical ID resolves cleanly even if many alias
  // IDs share the same display name.
  const canonByName = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const t of Object.values(raw)) {
    if (!t.InGame) continue;
    const name = (t.Name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const canonicalId = grouping.memberToCanonical.get(t.ID) ?? t.ID;
    const existing = canonByName.get(key);
    if (existing === undefined) canonByName.set(key, canonicalId);
    else if (existing !== canonicalId) ambiguous.add(key);
  }

  // Re-walk to pick representative metadata for each unambiguous name.
  for (const t of Object.values(raw)) {
    if (!t.InGame) continue;
    const name = (t.Name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (ambiguous.has(key) || index.has(key)) continue;
    const canonicalId = canonByName.get(key);
    if (canonicalId === undefined || canonicalId !== t.ID) continue;
    index.set(key, {
      type: 'npc',
      id: canonicalId,
      name,
      icon: iconFor(t.Icon ?? '', iconMap),
    });
  }
  return index;
}
