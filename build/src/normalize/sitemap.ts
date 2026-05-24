import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants as fsc } from 'node:fs';
import { join } from 'node:path';

import { DATA_OUT, SITE_PUBLIC } from '../paths.js';
import { log } from '../log.js';

/** Default points at the canonical Cloudflare Pages URL; override at build time
 *  via `FFWIKI_BASE_URL=https://ffwiki.example.com node build/dist/index.js`. */
function baseUrl(): string {
  const raw = (process.env.FFWIKI_BASE_URL ?? '').trim();
  if (raw) return raw.replace(/\/+$/, '');
  return 'https://example.com';
}

interface IndexRow { id: number | string; }

async function exists(path: string): Promise<boolean> {
  try { await access(path, fsc.F_OK); return true; } catch { return false; }
}

async function loadIndex(slug: string, type: string): Promise<IndexRow[]> {
  const path = join(DATA_OUT, slug, 'index', `${type}.json`);
  if (!(await exists(path))) return [];
  return JSON.parse(await readFile(path, 'utf8')) as IndexRow[];
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const ENTITY_TYPES = ['missions', 'npcs', 'items', 'monsters', 'areas', 'nanos'] as const;

/** Per-build sitemap. Lists the build landing + per-type index + every entity. */
async function writeBuildSitemap(slug: string, base: string): Promise<number> {
  const urls: string[] = [];
  urls.push(`${base}/${slug}`);
  for (const type of ENTITY_TYPES) {
    urls.push(`${base}/${slug}/${type}`);
    const rows = await loadIndex(slug, type);
    for (const r of rows) {
      urls.push(`${base}/${slug}/${type}/${r.id}`);
    }
  }

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${escapeXml(u)}</loc></url>`).join('\n') +
    '\n</urlset>\n';

  const dir = join(SITE_PUBLIC, 'sitemaps');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${slug}.xml`), body);
  return urls.length;
}

/** Site-level sitemap.xml — a sitemapindex pointing at every per-build sitemap. */
async function writeSitemapIndex(slugs: string[], base: string): Promise<void> {
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    slugs.map((s) => `  <sitemap><loc>${escapeXml(`${base}/sitemaps/${s}.xml`)}</loc></sitemap>`).join('\n') +
    '\n</sitemapindex>\n';
  await writeFile(join(SITE_PUBLIC, 'sitemap.xml'), body);
}

/** robots.txt — allow crawlers, point at sitemap, hide the raw JSON. */
async function writeRobots(base: string): Promise<void> {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /data/',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
  await writeFile(join(SITE_PUBLIC, 'robots.txt'), body);
}

/** One-shot generator called after every per-build entity write is complete. */
export async function writeSitemapAndRobots(
  slugs: string[],
): Promise<{ totalUrls: number; base: string }> {
  const base = baseUrl();
  if (base === 'https://example.com') {
    log.warn('FFWIKI_BASE_URL not set — sitemap will use https://example.com (override before deploy)');
  }

  let totalUrls = 0;
  for (const slug of slugs) {
    totalUrls += await writeBuildSitemap(slug, base);
  }
  await writeSitemapIndex(slugs, base);
  await writeRobots(base);
  return { totalUrls, base };
}
