// FFAutomatedWiki — build pipeline orchestrator.
//
// P1 scope:
//  1. Discover the latest FFInfoPacks release (or env-pinned tag).
//  2. Download every ZIP asset into .cache/ffinfo/<tag>/ (idempotent).
//  3. MD5-dedupe icons + help images across all builds into site/public/icons/.
//  4. Emit site/public/builds.json from parsed ZIP filenames.

import { downloadAll, fetchRelease } from './download.js';
import { dedupeIcons } from './icons.js';
import { writeManifest } from './manifest.js';
import { log } from './log.js';

async function main(): Promise<void> {
  log.step('discovering FFInfoPacks release');
  const release = await fetchRelease();
  log.info(`release: ${release.tagName} — ${release.assets.length} ZIP assets`);

  log.step('downloading ZIPs');
  const downloaded = await downloadAll(release);
  const totalBytes = downloaded.reduce((s, d) => s + d.asset.size, 0);
  log.done(`downloaded/cached ${downloaded.length} ZIPs (${(totalBytes / (1024 * 1024)).toFixed(1)} MB total)`);

  log.step('deduping icons');
  const { stats } = await dedupeIcons(downloaded);
  log.done(
    `icons: ${stats.uniqueIconsWritten} unique / ${stats.totalImagesSeen} seen ` +
    `across ${stats.buildsProcessed} builds ` +
    `(${((1 - stats.uniqueIconsWritten / Math.max(1, stats.totalImagesSeen)) * 100).toFixed(1)}% dedup ratio)`,
  );

  log.step('writing manifest');
  const entries = await writeManifest(downloaded);
  log.done(`manifest: ${entries.length} builds → site/public/builds.json`);

  log.done('P1 complete');
}

main().catch((err) => {
  process.stderr.write(`\nbuild failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
