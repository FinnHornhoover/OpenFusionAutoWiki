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
import { normalizeNpcs } from './normalize/npcs.js';
import { buildNpcNameIndex } from './normalize/npcNameIndex.js';
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

  log.step('normalizing missions + NPCs');
  let totalMissions = 0;
  let totalMissionChunks = 0;
  let totalNpcs = 0;
  let totalNpcChunks = 0;
  let totalVendors = 0;
  let totalLinkedNpcs = 0;
  for (const d of downloaded) {
    const slug = d.asset.name.replace(/\.zip$/i, '');
    const iconMap = maps[slug] ?? {};

    const npcNameIndex = buildNpcNameIndex(d.path, iconMap);
    const m = await normalizeMissions(d.path, slug, iconMap, npcNameIndex);
    totalMissions += m.count;
    totalMissionChunks += m.chunks;

    const n = await normalizeNpcs(d.path, slug, iconMap, m.npcMissions);
    totalNpcs += n.count;
    totalNpcChunks += n.chunks;
    totalVendors += n.vendors;
    totalLinkedNpcs += n.linked;

    await writeBuildMeta(slug, ['missions', 'npcs']);
    log.info(`${slug.padEnd(46)} missions=${m.count} npcs=${n.count} (${n.linked} link mission, ${n.vendors} vendors)`);
  }
  log.done(`missions: ${totalMissions} records → ${totalMissionChunks} chunks`);
  log.done(`npcs: ${totalNpcs} records → ${totalNpcChunks} chunks; ${totalLinkedNpcs} link to missions; ${totalVendors} are vendors`);

  log.done('build complete');
}

main().catch((err) => {
  process.stderr.write(`\nbuild failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
