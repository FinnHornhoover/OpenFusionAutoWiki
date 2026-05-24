import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants as fsc } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';

import AdmZip from 'adm-zip';

import { ICONS_OUT, CACHE_DIR } from './paths.js';
import { log } from './log.js';
import type { DownloadedAsset } from './download.js';

/** Path prefixes inside each ZIP that contain images we want to dedupe. */
const IMAGE_PREFIXES = ['icons/', 'help/'];
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/**
 * Per-build mapping: original path inside ZIP → md5 hash (no extension).
 * Used by later phases when rewriting JSON icon references.
 */
export type IconMap = Record<string, string>;

export interface IconResult {
  buildSlug: string;
  iconMap: IconMap;
  totalImages: number;
}

export interface IconStats {
  totalImagesSeen: number;
  uniqueIconsWritten: number;
  buildsProcessed: number;
}

function buildSlug(zipName: string): string {
  return zipName.replace(/\.zip$/i, '');
}

async function exists(path: string): Promise<boolean> {
  try { await access(path, fsc.F_OK); return true; } catch { return false; }
}

/**
 * Hash images from one ZIP and copy new files to site/public/icons/.
 *
 * Cache each build's icon map so later runs do not reopen every ZIP.
 */
async function dedupeOne(
  zipPath: string,
  written: Set<string>,
): Promise<IconResult> {
  const slug = buildSlug(zipPath.split('/').pop() ?? '');
  const cachePath = join(CACHE_DIR, 'iconmaps', `${slug}.json`);

  // A cached map is only valid if every referenced icon still exists.
  if (await exists(cachePath)) {
    const cached = JSON.parse(await readFile(cachePath, 'utf8')) as IconMap;
    let missing = 0;
    for (const hash of new Set(Object.values(cached))) {
      // Values already include the extension, e.g. "abcd1234.png".
      const target = join(ICONS_OUT, hash);
      if (!written.has(hash) && !(await exists(target))) {
        missing++;
      } else {
        written.add(hash);
      }
    }
    if (missing === 0) {
      log.info(`icons cached  ${slug} (${Object.keys(cached).length} refs)`);
      return { buildSlug: slug, iconMap: cached, totalImages: Object.keys(cached).length };
    }
    // Cache exists, but icons were removed. Re-extract below.
  }

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const iconMap: IconMap = {};
  let count = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');
    if (!IMAGE_PREFIXES.some((p) => name.startsWith(p))) continue;
    const ext = extname(name).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;

    const buf = entry.getData();
    const hash = createHash('md5').update(buf).digest('hex');
    const filename = `${hash}${ext}`;
    iconMap[name] = filename;
    count++;

    if (written.has(filename)) continue;
    const target = join(ICONS_OUT, filename);
    if (!(await exists(target))) {
      await writeFile(target, buf);
    }
    written.add(filename);
  }

  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(iconMap));

  log.info(`icons        ${slug} (${count} images)`);
  return { buildSlug: slug, iconMap, totalImages: count };
}

/**
 * Dedupe icons and help images across all cached ZIPs.
 *
 * The disk cache stays keyed by ZIP basename; the returned maps use public slugs.
 */
export async function dedupeIcons(
  assets: DownloadedAsset[],
  slugFor: (a: DownloadedAsset) => string,
): Promise<{ stats: IconStats; maps: Record<string, IconMap> }> {
  await mkdir(ICONS_OUT, { recursive: true });

  const written = new Set<string>();
  const maps: Record<string, IconMap> = {};
  let totalImagesSeen = 0;

  for (const a of assets) {
    const { iconMap, totalImages } = await dedupeOne(a.path, written);
    maps[slugFor(a)] = iconMap;
    totalImagesSeen += totalImages;
  }

  return {
    stats: {
      totalImagesSeen,
      uniqueIconsWritten: written.size,
      buildsProcessed: assets.length,
    },
    maps,
  };
}

export function _slugFor(zipBasename: string): string {
  return basename(zipBasename).replace(/\.zip$/i, '');
}
