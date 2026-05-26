import type { Ref } from './types.js';
import type { IconMap } from '../icons.js';

/**
 * Convert a "icons/foo.png" path to a md5-hashed filename using the per-build map.
 * Returns "" when the path is unknown — callers should treat empty as "no icon".
 */
export function iconFor(iconPath: string, iconMap: IconMap): string {
  if (!iconPath) return '';
  const norm = iconPath.replace(/\\/g, '/');
  return iconMap[norm] ?? '';
}

export function npcRef(
  id: number,
  name: string,
  iconPath: string,
  iconMap: IconMap,
): Ref | null {
  if (!id || id <= 0) return null;
  return { type: 'npc', id, name: name || `NPC #${id}`, icon: iconFor(iconPath, iconMap) };
}

/** Items live at compound (typeId, itemId) — same itemId is reused across typeIds. */
export function itemRef(
  typeId: number,
  itemId: number,
  name: string,
  iconPath: string,
  iconMap: IconMap,
): Ref | null {
  if (!itemId || itemId <= 0) return null;
  return {
    type: 'item',
    id: `${typeId}-${itemId}`,
    name: name || `Item #${itemId}`,
    icon: iconFor(iconPath, iconMap),
  };
}

/** Compound numeric key for chunking items. */
export function itemChunkKey(typeId: number, itemId: number): number {
  return typeId * 10000 + itemId;
}

export function nanoRef(id: number, name: string, iconPath: string, iconMap: IconMap): Ref | null {
  if (!id || id <= 0) return null;
  return { type: 'nano', id, name: name || `Nano #${id}`, icon: iconFor(iconPath, iconMap) };
}

export function missionRef(id: number, name: string): Ref | null {
  if (!id || id <= 0) return null;
  return { type: 'mission', id, name: name || `Mission #${id}` };
}

export function monsterRef(id: number, name: string): Ref | null {
  if (!id || id <= 0) return null;
  return { type: 'monster', id, name: name || `Monster #${id}` };
}

export function instanceRef(id: number, name: string): Ref | null {
  if (!id || id <= 0) return null;
  return { type: 'instance', id, name: name || `Instance #${id}` };
}

/**
 * Many JSON files use compound keys like "0701::Dee Dee" — the part before "::"
 * is a zero-padded numeric id, the part after is the display name. This parser
 * returns both halves.
 */
export function parseCompoundKey(key: string): { id: number; name: string } {
  const sep = key.indexOf('::');
  if (sep === -1) return { id: 0, name: key };
  const idStr = key.slice(0, sep);
  const name = key.slice(sep + 2);
  const id = parseInt(idStr, 10);
  return { id: Number.isFinite(id) ? id : 0, name };
}
