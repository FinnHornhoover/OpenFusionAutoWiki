import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DATA_OUT } from './paths.js';

/** Entities per chunk. Tunable; 250 keeps chunks ~1-5MB raw, well under 25MB cap. */
export const CHUNK_SIZE = 250;

/** Deterministic chunk id for a given entity id. */
export function chunkOf(id: number): number {
  return Math.floor(id / CHUNK_SIZE);
}

export interface ChunkResult {
  chunks: number;
  records: number;
}

/**
 * Write a typed entity collection to /data/<slug>/<type>/<chunk>.json.
 * Records are grouped into chunks by `chunkOf(record.id)`. The on-disk format
 * is a JSON object keyed by id (string) so the page lookup is O(1).
 */
export async function writeChunks<T extends { id: number }>(
  slug: string,
  type: string,
  records: T[],
): Promise<ChunkResult> {
  const dir = join(DATA_OUT, slug, type);
  await mkdir(dir, { recursive: true });

  const buckets = new Map<number, Record<string, T>>();
  for (const r of records) {
    const c = chunkOf(r.id);
    let b = buckets.get(c);
    if (!b) {
      b = {};
      buckets.set(c, b);
    }
    b[String(r.id)] = r;
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
