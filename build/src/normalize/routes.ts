import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants as fsc } from 'node:fs';
import { join } from 'node:path';

import { chunkOf } from '../chunk.js';
import { DATA_OUT } from '../paths.js';
import { slugify } from './slug.js';

type EntityType = 'missions' | 'npcs' | 'items' | 'item-sets' | 'codes' | 'monsters' | 'areas' | 'instances' | 'infected-zones' | 'nanos';

interface IndexRow {
  id: number | string;
  name: string;
  code?: string;
  icon?: string;
  members?: Array<{ id: number; category?: string; inGame?: boolean }>;
  routeId?: string;
}

export interface RouteEntityTarget {
  kind: 'entity';
  id: number | string;
  chunk: number;
  canonical: string;
}

export interface RouteAmbiguityMatch {
  id: number | string;
  name: string;
  routeId: string;
  icon: string;
  detail: string;
}

export interface RouteAmbiguityTarget {
  kind: 'ambiguity';
  canonical: string;
  title: string;
  matches: RouteAmbiguityMatch[];
}

export type RouteTarget = RouteEntityTarget | RouteAmbiguityTarget;
export type RouteMap = Record<string, RouteTarget>;

async function exists(path: string): Promise<boolean> {
  try { await access(path, fsc.F_OK); return true; } catch { return false; }
}

async function loadIndex(slug: string, type: EntityType): Promise<IndexRow[]> {
  const path = join(DATA_OUT, slug, 'index', `${type}.json`);
  if (!(await exists(path))) return [];
  return JSON.parse(await readFile(path, 'utf8')) as IndexRow[];
}

function semanticSource(type: EntityType, row: IndexRow): string {
  return type === 'codes' ? row.code || row.name || String(row.id) : row.name || String(row.id);
}

function entityChunk(type: EntityType, id: number | string): number {
  if (type === 'areas' || type === 'instances' || type === 'infected-zones' || type === 'codes' || type === 'item-sets') return 0;
  if (type === 'items') {
    const m = /^(\d+)-(\d+)$/.exec(String(id));
    if (!m) return 0;
    return chunkOf(parseInt(m[1], 10) * 10000 + parseInt(m[2], 10));
  }
  return chunkOf(Number(id));
}

function disambiguatedId(base: string, id: number | string): string {
  return `${base}-${id}`;
}

function detailFor(row: IndexRow, member?: { category?: string; inGame?: boolean }): string {
  const bits: string[] = [];
  const category = member?.category || (row as { category?: string }).category;
  if (category) bits.push(category);
  const inGame = member?.inGame ?? (row as { inGame?: boolean }).inGame;
  if (inGame === false) bits.push('out of game');
  return bits.join(' - ');
}

export async function writeRouteMaps(slug: string, types: readonly EntityType[]): Promise<{ routes: number; aliases: number }> {
  let totalRoutes = 0;
  let totalAliases = 0;
  const dir = join(DATA_OUT, slug, 'routes');
  await mkdir(dir, { recursive: true });

  for (const type of types) {
    const rows = await loadIndex(slug, type);
    const exactRows: Array<{ row: IndexRow; id: number | string; base: string; name: string; icon: string; detail: string }> = [];

    for (const row of rows) {
      const base = slugify(semanticSource(type, row));
      if (type === 'npcs' && row.members && row.members.length > 1) {
        for (const member of row.members) {
          exactRows.push({
            row,
            id: member.id,
            base,
            name: row.name,
            icon: row.icon || '',
            detail: detailFor(row, member),
          });
        }
      } else {
        exactRows.push({
          row,
          id: row.id,
          base,
          name: semanticSource(type, row),
          icon: row.icon || '',
          detail: detailFor(row),
        });
      }
    }

    const groups = new Map<string, typeof exactRows>();
    for (const exact of exactRows) {
      const group = groups.get(exact.base) ?? [];
      group.push(exact);
      groups.set(exact.base, group);
    }

    const routeMap: RouteMap = {};
    const routeIdByLegacyId = new Map<string, string>();

    for (const [base, group] of groups) {
      const collides = group.length > 1;
      if (collides) {
        routeMap[base] = {
          kind: 'ambiguity',
          canonical: base,
          title: group[0]?.name || base,
          matches: group.map((entry) => ({
            id: entry.id,
            name: entry.name,
            routeId: disambiguatedId(base, entry.id),
            icon: entry.icon,
            detail: entry.detail,
          })),
        };
      }

      for (const entry of group) {
        const canonical = collides ? disambiguatedId(base, entry.id) : base;
        routeIdByLegacyId.set(String(entry.id), canonical);
        const target: RouteEntityTarget = {
          kind: 'entity',
          id: entry.id,
          chunk: entityChunk(type, entry.id),
          canonical,
        };
        routeMap[canonical] = target;
        if (!collides || String(entry.id) !== base) routeMap[String(entry.id)] = target;
      }
    }

    const indexed = rows.map((row) => {
      const routeId = type === 'npcs' && row.members && row.members.length > 1
        ? slugify(semanticSource(type, row))
        : routeIdByLegacyId.get(String(row.id));
      return routeId ? { ...row, routeId } : row;
    });

    await writeFile(join(DATA_OUT, slug, 'index', `${type}.json`), JSON.stringify(indexed));
    await writeFile(join(dir, `${type}.json`), JSON.stringify(routeMap));
    totalRoutes += rows.length;
    totalAliases += Object.keys(routeMap).length;
  }

  return { routes: totalRoutes, aliases: totalAliases };
}
