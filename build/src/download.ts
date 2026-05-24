import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

import { FFINFO_CACHE } from './paths.js';
import { log } from './log.js';

const GH_OWNER = 'FinnHornhoover';
const GH_REPO = 'FFInfoPacks';
const DEFAULT_CONCURRENCY = 4;

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string; // browser_download_url
}

export interface Release {
  tagName: string;
  name: string;
  assets: ReleaseAsset[];
}

export interface DownloadedAsset {
  asset: ReleaseAsset;
  path: string; // absolute path to cached ZIP
}

/**
 * Fetch the metadata for the latest FFInfoPacks release.
 * Override with FFWIKI_RELEASE=<tag> to pin (e.g., "release-26").
 */
export async function fetchRelease(): Promise<Release> {
  const pinned = process.env.FFWIKI_RELEASE?.trim();
  const url = pinned
    ? `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/tags/${pinned}`
    : `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`;

  const headers: Record<string, string> = {
    'User-Agent': 'FFAutomatedWiki/0.0 (build pipeline)',
    Accept: 'application/vnd.github+json',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${url}: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    tag_name: string;
    name: string;
    assets: Array<{ name: string; size: number; browser_download_url: string }>;
  };

  const assets: ReleaseAsset[] = body.assets
    .filter((a) => a.name.toLowerCase().endsWith('.zip'))
    .map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url }));

  return { tagName: body.tag_name, name: body.name, assets };
}

async function fileExistsWithSize(path: string, expected: number): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile() && s.size === expected;
  } catch {
    return false;
  }
}

async function downloadOne(asset: ReleaseAsset, destDir: string): Promise<DownloadedAsset> {
  const finalPath = join(destDir, asset.name);

  if (await fileExistsWithSize(finalPath, asset.size)) {
    log.info(`cache hit  ${asset.name}`);
    return { asset, path: finalPath };
  }

  const tmpPath = `${finalPath}.part`;
  // Clean up stale partial if any
  try { await unlink(tmpPath); } catch { /* noop */ }

  const started = Date.now();
  log.info(`fetching   ${asset.name} (${(asset.size / (1024 * 1024)).toFixed(1)} MB)`);

  const res = await fetch(asset.url, {
    headers: { 'User-Agent': 'FFAutomatedWiki/0.0' },
    redirect: 'follow',
  });
  if (!res.ok || !res.body) {
    throw new Error(`download ${asset.name}: HTTP ${res.status}`);
  }

  // Stream body to disk
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tmpPath));
  await rename(tmpPath, finalPath);

  // Sanity: size should match
  const s = await stat(finalPath);
  if (s.size !== asset.size) {
    log.warn(`size mismatch for ${asset.name}: expected ${asset.size}, got ${s.size}`);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  log.info(`downloaded ${asset.name} in ${secs}s`);
  return { asset, path: finalPath };
}

/**
 * Download all ZIP assets for a release into .cache/ffinfo/<tag>/.
 * Idempotent — files that already exist with the right size are skipped.
 */
export async function downloadAll(
  release: Release,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<DownloadedAsset[]> {
  const destDir = join(FFINFO_CACHE, release.tagName);
  await mkdir(destDir, { recursive: true });

  // Persist release metadata for traceability
  await writeFile(
    join(destDir, '_release.json'),
    JSON.stringify({ tagName: release.tagName, name: release.name, assetCount: release.assets.length }, null, 2),
  );

  const results: DownloadedAsset[] = new Array(release.assets.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= release.assets.length) return;
      results[i] = await downloadOne(release.assets[i], destDir);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, release.assets.length) }, worker);
  await Promise.all(workers);

  return results;
}
