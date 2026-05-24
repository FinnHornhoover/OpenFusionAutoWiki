// FFAutomatedWiki — build pipeline orchestrator.
//
// P1: download, icon dedupe, manifest.
// P2: normalize missions per build → chunked JSON + per-type index.
//     Each build also gets a meta.json declaring which entity types are populated.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { downloadAll, fetchRelease } from './download.js';
import { dedupeIcons } from './icons.js';
import { writeManifest } from './manifest.js';
import { normalizeMissions } from './normalize/missions.js';
import { DATA_OUT } from './paths.js';
import { log } from './log.js';

async function writeBuildMeta(slug: string, builtTypes: string[]): Promise<void> {
  const dir = join(DATA_OUT, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'meta.json'), JSON.stringify({ builtTypes }));
}

async function main(): Promise<void> {
  log.step('discovering FFInfoPacks release');
  const release = await fetchRelease();
  log.info(`release: ${release.tagName} — ${release.assets.length} ZIP assets`);

  log.step('downloading ZIPs');
  const downloaded = await downloadAll(release);
  const totalBytes = downloaded.reduce((s, d) => s + d.asset.size, 0);
  log.done(`downloaded/cached ${downloaded.length} ZIPs (${(totalBytes / (1024 * 1024)).toFixed(1)} MB total)`);

  log.step('deduping icons');
  const { stats, maps } = await dedupeIcons(downloaded);
  log.done(
    `icons: ${stats.uniqueIconsWritten} unique / ${stats.totalImagesSeen} seen ` +
    `across ${stats.buildsProcessed} builds ` +
    `(${((1 - stats.uniqueIconsWritten / Math.max(1, stats.totalImagesSeen)) * 100).toFixed(1)}% dedup ratio)`,
  );

  log.step('writing manifest');
  const entries = await writeManifest(downloaded);
  log.done(`manifest: ${entries.length} builds → site/public/builds.json`);

  log.step('normalizing missions');
  let totalMissions = 0;
  let totalChunks = 0;
  for (const d of downloaded) {
    const slug = d.asset.name.replace(/\.zip$/i, '');
    const iconMap = maps[slug] ?? {};
    const { count, chunks } = await normalizeMissions(d.path, slug, iconMap);
    totalMissions += count;
    totalChunks += chunks;
    await writeBuildMeta(slug, ['missions']);
    log.info(`missions     ${slug} (${count} → ${chunks} chunks)`);
  }
  log.done(`missions: ${totalMissions} records across ${downloaded.length} builds → ${totalChunks} chunks`);

  log.done('build complete');
}

main().catch((err) => {
  process.stderr.write(`\nbuild failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
