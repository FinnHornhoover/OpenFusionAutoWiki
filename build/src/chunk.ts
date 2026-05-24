import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DATA_OUT } from './paths.js';

/** Entities per chunk. Tunable; 250 keeps chunks ~1-5MB raw, well under 25MB cap. */
export const CHUNK_SIZE = 250;

/** Deterministic chunk id for a given numeric key. */
export function chunkOf(numericKey: number): number {
  return Math.floor(numericKey / CHUNK_SIZE);
}

export interface ChunkResult {
  chunks: number;
  records: number;
}

export interface ChunkKey {
  /** What the chunk's JSON object keys by; what the URL :id segment is. */
  url: string | number;
  /** Which chunk file the record lives in. */
  chunk: number;
}

/**
 * Write a typed entity collection to /data/<slug>/<type>/<chunk>.json. The
 * caller supplies `keyOf` so each entity type can decide its own URL identity
 * and chunk-assignment scheme (numeric for mission/npc IDs; compound
 * "typeId-itemId" for items, chunked by `typeId * 10000 + itemId`).
 */
export async function writeChunks<T>(
  slug: string,
  type: string,
  records: T[],
  keyOf: (r: T) => ChunkKey,
): Promise<ChunkResult> {
  const dir = join(DATA_OUT, slug, type);
  await mkdir(dir, { recursive: true });

  const buckets = new Map<number, Record<string, T>>();
  for (const r of records) {
    const { url, chunk } = keyOf(r);
    let bucket = buckets.get(chunk);
    if (!bucket) {
      bucket = {};
      buckets.set(chunk, bucket);
    }
    bucket[String(url)] = r;
  }

  for (const [chunk, bucket] of buckets) {
    await writeFile(join(dir, `${chunk}.json`), JSON.stringify(bucket));
  }

  return { chunks: buckets.size, records: records.length };
}

/**
 * Write the summary index for an entity type to /data/<slug>/index/<type>.json.
 * The index is what list pages render — keep it small.
 */
export async function writeIndex<T>(
  slug: string,
  type: string,
  rows: T[],
): Promise<void> {
  const dir = join(DATA_OUT, slug, 'index');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${type}.json`), JSON.stringify(rows));
}
