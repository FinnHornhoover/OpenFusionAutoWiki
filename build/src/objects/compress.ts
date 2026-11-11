import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { OBJECTS_CACHE, POOL_DIR, UPLOAD_INDEX } from './build.js';
import type { PoolEntry } from './pool.js';
import { log } from '../log.js';

const encode = promisify(gzip);
const GZIP_DIR = join(OBJECTS_CACHE, 'gzip-v1');
export const PUBLICATION_INDEX = join(OBJECTS_CACHE, 'publication.json');

export interface UploadEntry extends PoolEntry {
  path: string;
  sourceBytes: number;
  contentEncoding?: 'gzip';
}

export async function prepareUploads(entries: PoolEntry[], pool = POOL_DIR, cache = GZIP_DIR): Promise<UploadEntry[]> {
  const eligible = (row: PoolEntry): boolean => row.bytes >= 1024 && /\.(glb|bin)$/.test(row.key);
  const directories = new Set(entries.filter(eligible).map((row) => dirname(join(cache, `${row.key}.gz`))));
  await Promise.all([...directories].map((directory) => mkdir(directory, { recursive: true })));

  const output: UploadEntry[] = new Array(entries.length);
  let next = 0, done = 0, storedBytes = 0, sourceBytes = 0, cached = 0, failed = false;
  const progress = (): void => log.info(`Compression: ${done}/${entries.length} assets; ${(sourceBytes / 1e9).toFixed(3)} GB → ${(storedBytes / 1e9).toFixed(3)} GB; ${cached} cached gzip files`);
  log.step('Preparing gzip publication assets');
  const timer = setInterval(progress, 5000);
  try {
    const results = await Promise.allSettled(Array.from({ length: Math.min(4, entries.length) }, async () => {
      try {
        while (next < entries.length && !failed) {
          const index = next++, row = entries[index];
          const entry: UploadEntry = { ...row, path: join(pool, row.key), sourceBytes: row.bytes };
          if (eligible(row)) {
            const path = join(cache, `${row.key}.gz`);
            let info = await stat(path).catch((error: NodeJS.ErrnoException) => {
              if (error.code !== 'ENOENT') throw error;
              return undefined;
            });
            if (info) cached++;
            else {
              const bytes = await encode(await readFile(entry.path), { level: 6 });
              const temporary = `${path}.${process.pid}.tmp`;
              try { await writeFile(temporary, bytes); await rename(temporary, path); }
              finally { await rm(temporary, { force: true }); }
              info = await stat(path);
            }
            if (info.size < row.bytes) { entry.path = path; entry.bytes = info.size; entry.contentEncoding = 'gzip'; }
          }
          output[index] = entry;
          done++; sourceBytes += row.bytes; storedBytes += entry.bytes;
        }
      } catch (error) { failed = true; throw error; }
    }));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const saving = sourceBytes ? (1 - storedBytes / sourceBytes) * 100 : 0;
    log.done(`Publication assets: ${entries.length.toLocaleString()} files; ${(sourceBytes / 1e9).toFixed(3)} GB → ${(storedBytes / 1e9).toFixed(3)} GB (${saving.toFixed(1)}% smaller)`);
    return output;
  } finally { clearInterval(timer); }
}

export async function preparePublication(): Promise<UploadEntry[]> {
  const entries = JSON.parse(readFileSync(UPLOAD_INDEX, 'utf8')) as PoolEntry[];
  const output = await prepareUploads(entries);
  await writeFile(PUBLICATION_INDEX, JSON.stringify(output));
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  preparePublication().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
