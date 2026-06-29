import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writeChunks, writeIndex } from '../chunk.js';
import { DATA_OUT } from '../paths.js';
import type { ItemIndexEntry, ItemSet, ItemSetIndexEntry, ItemSetItem } from './types.js';

const SOURCE_DIR = join(process.cwd(), 'fixed_data');

interface FixedItemSet {
  id: number;
  name: string;
  items: string[];
}

async function loadFixedItemSets(slug: string): Promise<Record<string, FixedItemSet>> {
  try {
    const raw = await readFile(join(SOURCE_DIR, slug, 'item_sets.json'), 'utf8');
    return JSON.parse(raw) as Record<string, FixedItemSet>;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function loadItemRefs(slug: string): Promise<Map<string, ItemSetItem>> {
  const raw = await readFile(join(DATA_OUT, slug, 'index', 'items.json'), 'utf8');
  const rows = JSON.parse(raw) as ItemIndexEntry[];
  return new Map(rows.map((item) => [item.id, {
    type: 'item' as const,
    id: item.id,
    name: item.name,
    icon: item.icon,
    contentLevel: item.contentLevel,
    requiredLevel: item.requiredLevel,
    rarity: item.rarity,
    obtainable: item.obtainable,
  }]));
}

function indexEntry(set: ItemSet): ItemSetIndexEntry {
  return {
    id: set.id,
    name: set.name,
    itemCount: set.items.length,
  };
}

export async function normalizeItemSets(slug: string): Promise<{ count: number; itemCount: number }> {
  const [fixedSets, itemRefs] = await Promise.all([loadFixedItemSets(slug), loadItemRefs(slug)]);
  const sets = Object.values(fixedSets)
    .map((set): ItemSet => ({
      id: set.id,
      name: set.name,
      items: Array.from(new Set(set.items))
        .map((id) => itemRefs.get(id))
        .filter((ref): ref is ItemSetItem => Boolean(ref))
        .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true })),
    }))
    .filter((set) => set.items.length > 0)
    .sort((a, b) => a.id - b.id || a.name.localeCompare(b.name));

  await writeChunks(slug, 'item-sets', sets, (set) => ({ url: set.id, chunk: 0 }));
  await writeIndex(slug, 'item-sets', sets.map(indexEntry));

  const flatRows = Object.fromEntries(sets.map((set) => [String(set.id), set]));
  const dir = join(DATA_OUT, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'item_sets.json'), JSON.stringify(flatRows));

  const itemCount = sets.reduce((sum, set) => sum + set.items.length, 0);
  return { count: sets.length, itemCount };
}
