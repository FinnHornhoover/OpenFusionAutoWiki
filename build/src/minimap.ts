import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { SITE_PUBLIC } from './paths.js';

/**
 * Verify the checked-in world minimap exists. The build must not fetch this
 * from external projects; site/public/minimap is the source of truth.
 */
export async function downloadMinimap(): Promise<{ bytes: number; cached: boolean }> {
  const dest = join(SITE_PUBLIC, 'minimap', 'all.png');

  try {
    const s = await stat(dest);
    if (s.size > 0) return { bytes: s.size, cached: true };
  } catch {
    // handled below
  }

  throw new Error(`missing checked-in minimap asset: ${dest}`);
}
