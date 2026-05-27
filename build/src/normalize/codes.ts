import AdmZip from 'adm-zip';

import { writeChunks, writeIndex } from '../chunk.js';
import type { IconMap } from '../icons.js';
import { itemRef } from './refs.js';
import type { Code, CodeIndexEntry, CodeItemEntry, Ref } from './types.js';

interface RawCodeItem {
  ID?: string;
  TypeID?: number;
  ItemID?: number;
  Name?: string;
  Icon?: string;
  Type?: string;
  DisplayType?: string;
  Rarity?: string;
  ContentLevel?: number;
  RequiredLevel?: number;
  Gender?: string;
  Obtainable?: boolean;
}

interface RawCodeInfo {
  Code?: string;
  Items?: Record<string, RawCodeItem>;
}

function codeId(code: string): string {
  return encodeURIComponent(code.trim());
}

function normalizeItem(raw: RawCodeItem, iconMap: IconMap): CodeItemEntry | null {
  const typeId = raw.TypeID ?? 0;
  const itemId = raw.ItemID ?? 0;
  const ref = itemRef(typeId, itemId, raw.Name ?? '', raw.Icon ?? '', iconMap);
  if (!ref) return null;
  return {
    ref,
    typeId,
    itemId,
    type: raw.DisplayType ?? raw.Type ?? '',
    rarity: raw.Rarity ?? '',
    gender: raw.Gender ?? '',
    contentLevel: raw.ContentLevel ?? 0,
    requiredLevel: raw.RequiredLevel ?? 0,
    obtainable: raw.Obtainable ?? true,
  };
}

function indexEntry(code: Code): CodeIndexEntry {
  return {
    id: code.id,
    code: code.code,
    name: code.code,
    icon: code.items[0]?.ref.icon ?? '',
    items: code.items.map((item) => item.ref),
  };
}

export async function normalizeCodes(
  zipPath: string,
  slug: string,
  iconMap: IconMap,
): Promise<{ count: number; chunks: number; itemCount: number }> {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry('info/code_item_info.json');
  if (!entry) return { count: 0, chunks: 0, itemCount: 0 };

  const raw = JSON.parse(entry.getData().toString('utf8')) as Record<string, RawCodeInfo>;
  const rows: Code[] = Object.entries(raw)
    .map(([key, value]) => {
      const code = (value.Code ?? key).trim();
      const items = Object.values(value.Items ?? {})
        .map((item) => normalizeItem(item, iconMap))
        .filter((item): item is CodeItemEntry => Boolean(item))
        .sort((a, b) => a.ref.name.localeCompare(b.ref.name));
      const ref: Ref = { type: 'code', id: codeId(code), name: code };
      return { id: codeId(code), code, name: code, ref, items };
    })
    .filter((row) => row.code && row.items.length > 0)
    .sort((a, b) => a.code.localeCompare(b.code));

  const { chunks } = await writeChunks(slug, 'codes', rows, (r) => ({ url: r.id, chunk: 0 }));
  await writeIndex(slug, 'codes', rows.map(indexEntry));

  return { count: rows.length, chunks, itemCount: rows.reduce((sum, row) => sum + row.items.length, 0) };
}
