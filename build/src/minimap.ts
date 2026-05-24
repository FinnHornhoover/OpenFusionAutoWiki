import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { SITE_PUBLIC } from './paths.js';
import { log } from './log.js';

/** OFDropEditor's stitched world minimap — 2048×2048 px / 1.9 MB. */
const MINIMAP_URL = 'https://raw.githubusercontent.com/FinnHornhoover/OFDropEditor/main/src/main/resources/finnhh/oftools/dropeditor/all_minimap.png';

/**
 * Download the world minimap to site/public/minimap/all.png. Idempotent —
 * skips re-download if the file exists at non-zero size.
 */
export async function downloadMinimap(): Promise<{ bytes: number; cached: boolean }> {
  const dest = join(SITE_PUBLIC, 'minimap', 'all.png');
  await mkdir(dirname(dest), { recursive: true });

  try {
    const s = await stat(dest);
    if (s.size > 0) return { bytes: s.size, cached: true };
  } catch {
    // not present yet
  }

  log.info(`fetching all_minimap.png from OFDropEditor`);
  const res = await fetch(MINIMAP_URL, {
    headers: { 'User-Agent': 'openfusion-auto-wiki/0.0' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`minimap HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return { bytes: buf.length, cached: false };
}
