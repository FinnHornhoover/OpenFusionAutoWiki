// Build pipeline: fetch FFInfoPacks, dedupe shared assets, normalize each build,
// then write chunked JSON, indexes, search, sitemaps, and metadata.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { downloadAll, fetchRelease } from './download.js';
import { dedupeIcons } from './icons.js';
import { slugForZip, writeManifest } from './manifest.js';
import { downloadMinimap } from './minimap.js';
import { normalizeAreas } from './normalize/areas.js';
import { normalizeCodes } from './normalize/codes.js';
import { buildInstanceNameIndex } from './normalize/instanceLookup.js';
import { normalizeInfectedZones } from './normalize/infectedZones.js';
import { normalizeInstances } from './normalize/instances.js';
import { normalizeItems } from './normalize/items.js';
import { normalizeMissions } from './normalize/missions.js';
import { normalizeMobs } from './normalize/mobs.js';
import { buildMissionMobLocationMap } from './normalize/mobLocations.js';
import { normalizeNanos } from './normalize/nanos.js';
import { normalizeNpcs } from './normalize/npcs.js';
import { normalizePlayerStats } from './normalize/playerStats.js';
import { buildNpcLocationMap } from './normalize/npcLocations.js';
import { buildNpcNameIndex } from './normalize/npcNameIndex.js';
import { writeSearchIndex } from './normalize/search.js';
import { writeSitemapAndRobots } from './normalize/sitemap.js';
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
  const { stats, maps } = await dedupeIcons(downloaded, (a) => slugForZip(a.asset.name));
  log.done(
    `icons: ${stats.uniqueIconsWritten} unique / ${stats.totalImagesSeen} seen ` +
    `across ${stats.buildsProcessed} builds ` +
    `(${((1 - stats.uniqueIconsWritten / Math.max(1, stats.totalImagesSeen)) * 100).toFixed(1)}% dedup ratio)`,
  );

  log.step('writing manifest');
  const entries = await writeManifest(downloaded);
  log.done(`manifest: ${entries.length} builds → site/public/builds.json`);

  log.step('normalizing missions + NPCs + items + monsters');
  let totalMissions = 0;
  let totalMissionChunks = 0;
  let totalNpcs = 0;
  let totalNpcChunks = 0;
  let totalVendors = 0;
  let totalLinkedNpcs = 0;
  let totalInfectedZones = 0;
  let totalInfectedZoneChunks = 0;
  let totalInstances = 0;
  let totalInstanceChunks = 0;
  let totalInfectedInstances = 0;
  let totalItems = 0;
  let totalItemChunks = 0;
  let totalItemSources = 0;
  let totalCodes = 0;
  let totalCodeChunks = 0;
  let totalCodeItems = 0;
  let totalMobs = 0;
  let totalMobChunks = 0;
  let totalLinkedMobs = 0;
  let totalDroppingMobs = 0;
  let totalAreas = 0;
  let totalAreaChunks = 0;
  let totalAreasWithMissions = 0;
  let totalAreasWithTransport = 0;
  let totalNanos = 0;
  let totalNanoChunks = 0;
  let totalLinkedNanos = 0;
  let totalPlayerStats = 0;
  let totalSearchRows = 0;
  let totalSearchBytes = 0;
  for (const d of downloaded) {
    const slug = slugForZip(d.asset.name);
    const iconMap = maps[slug] ?? {};

    const instanceNames = buildInstanceNameIndex(d.path);
    const npcNameIndex = buildNpcNameIndex(d.path, iconMap);
    const npcLocations = buildNpcLocationMap(d.path, instanceNames);
    const missionMobLocations = buildMissionMobLocationMap(d.path, iconMap, instanceNames);

    const m = await normalizeMissions(d.path, slug, iconMap, npcNameIndex, npcLocations, missionMobLocations);
    totalMissions += m.count;
    totalMissionChunks += m.chunks;

    const n = await normalizeNpcs(d.path, slug, iconMap, m.npcMissions, instanceNames);
    totalNpcs += n.count;
    totalNpcChunks += n.chunks;
    totalVendors += n.vendors;
    totalLinkedNpcs += n.linked;

    const iz = await normalizeInfectedZones(d.path, slug, iconMap, m.missionLevels);
    totalInfectedZones += iz.count;
    totalInfectedZoneChunks += iz.chunks;

    const ins = await normalizeInstances(d.path, slug, iconMap, m.missionLevels);
    totalInstances += ins.count;
    totalInstanceChunks += ins.chunks;
    totalInfectedInstances += ins.infected;

    const it = await normalizeItems(d.path, slug, iconMap, instanceNames);
    totalItems += it.count;
    totalItemChunks += it.chunks;
    totalItemSources += it.sourceCount;

    const co = await normalizeCodes(d.path, slug, iconMap);
    totalCodes += co.count;
    totalCodeChunks += co.chunks;
    totalCodeItems += co.itemCount;

    const mb = await normalizeMobs(d.path, slug, iconMap, m.mobMissions, it.mobItems, instanceNames);
    totalMobs += mb.count;
    totalMobChunks += mb.chunks;
    totalLinkedMobs += mb.linked;
    totalDroppingMobs += mb.dropping;

    const ar = await normalizeAreas(d.path, slug, iconMap, m.npcMissions, m.missionLevels);
    totalAreas += ar.count;
    totalAreaChunks += ar.chunks;
    totalAreasWithMissions += ar.withMissions;
    totalAreasWithTransport += ar.withTransport;

    const na = await normalizeNanos(d.path, slug, iconMap, m.nanoMissions);
    totalNanos += na.count;
    totalNanoChunks += na.chunks;
    totalLinkedNanos += na.linked;

    const ps = await normalizePlayerStats(d.path, slug, iconMap);
    totalPlayerStats += ps.count;

    const search = await writeSearchIndex(slug);
    totalSearchRows += search.count;
    totalSearchBytes += search.bytes;

    await writeBuildMeta(slug, ['missions', 'npcs', 'items', 'codes', 'monsters', 'areas', 'instances', 'infected-zones', 'nanos', 'player-stats']);
    log.info(`${slug.padEnd(46)} missions=${m.count} npcs=${n.count} items=${it.count} codes=${co.count} mobs=${mb.count} areas=${ar.count} instances=${ins.count} infectedZones=${iz.count} nanos=${na.count} playerStats=${ps.count} search=${search.count}`);
  }
  log.done(`missions: ${totalMissions} → ${totalMissionChunks} chunks`);
  log.done(`npcs: ${totalNpcs} → ${totalNpcChunks} chunks; ${totalLinkedNpcs} link to missions; ${totalVendors} vendors`);
  log.done(`items: ${totalItems} → ${totalItemChunks} chunks; ${totalItemSources} source entries embedded`);
  log.done(`codes: ${totalCodes} → ${totalCodeChunks} chunks; ${totalCodeItems} item rewards`);
  log.done(`mobs: ${totalMobs} → ${totalMobChunks} chunks; ${totalLinkedMobs} link to missions; ${totalDroppingMobs} drop items`);
  log.done(`areas: ${totalAreas} → ${totalAreaChunks} chunks; ${totalAreasWithMissions} host missions; ${totalAreasWithTransport} have transport`);
  log.done(`instances: ${totalInstances} → ${totalInstanceChunks} chunks; ${totalInfectedInstances} infected instances`);
  log.done(`infected zones: ${totalInfectedZones} → ${totalInfectedZoneChunks} chunks`);
  log.done(`nanos: ${totalNanos} → ${totalNanoChunks} chunks; ${totalLinkedNanos} link to missions`);
  log.done(`player stats: ${totalPlayerStats} rows across ${downloaded.length} builds`);
  log.done(`search: ${totalSearchRows} rows across ${downloaded.length} builds (${(totalSearchBytes / (1024 * 1024)).toFixed(1)} MB total raw)`);

  log.step('checking world minimap asset');
  const mm = await downloadMinimap();
  log.done(`minimap: checked-in ${(mm.bytes / 1024).toFixed(1)} KB`);

  log.step('writing sitemap + robots.txt');
  const slugs = downloaded.map((d) => slugForZip(d.asset.name));
  const sitemap = await writeSitemapAndRobots(slugs);
  log.done(`sitemap: ${sitemap.totalUrls.toLocaleString()} URLs across ${slugs.length} per-build sitemaps; base=${sitemap.base}`);

  log.done('build complete');
}

main().catch((err) => {
  process.stderr.write(`\nbuild failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
