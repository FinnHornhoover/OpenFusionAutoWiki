import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { BUILDS_JSON } from './paths.js';
import { log } from './log.js';
import type { DownloadedAsset } from './download.js';

export interface BuildEntry {
  /** Stable URL slug — equals officialName so revision bumps don't break links. */
  slug: string;
  /** Official build identity (e.g., `retrobution`, `beta-20111013-fixed`). Same as `slug`. */
  officialName: string;
  /** Revision of the derived files (e.g., `r7`). Bumps across releases without changing slug. */
  rev: string;
  /** Optional short user-friendly nickname (e.g., `academy`, `common-future`). */
  nickname: string;
  /** True when officialName ends with `-fixed`. */
  fixed: boolean;
  /** Label shown in dropdowns/buttons/headings. */
  displayName: string;
  /** ISO YYYY-MM-DD when officialName encodes a date, otherwise `""`. */
  date: string;
  /** Coarse facets for filtering/search (officialName base, "fixed" if applicable, nickname). */
  tags: string[];
}

function titleCaseWords(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function extractIsoDate(officialName: string): string {
  const m = /\b(\d{4})(\d{2})(\d{2})\b/.exec(officialName);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/** Derive the stable URL slug (= officialName) directly from a ZIP filename. */
export function slugForZip(assetName: string): string {
  const base = assetName.replace(/\.zip$/i, '');
  const us = base.indexOf('_');
  return us === -1 ? base : base.slice(0, us);
}

/** Parse a ZIP basename into a BuildEntry. Slug = officialName, NOT the basename. */
export function parseAssetName(zipBasename: string): BuildEntry {
  // Split into three slots: officialName _ rev _ nickname(rest)
  const firstUs = zipBasename.indexOf('_');
  const officialName = firstUs === -1 ? zipBasename : zipBasename.slice(0, firstUs);
  const afterFirst = firstUs === -1 ? '' : zipBasename.slice(firstUs + 1);

  const secondUs = afterFirst.indexOf('_');
  const rev = secondUs === -1 ? afterFirst : afterFirst.slice(0, secondUs);
  const nickname = secondUs === -1 ? '' : afterFirst.slice(secondUs + 1);

  const fixed = /-fixed$/.test(officialName);
  const date = extractIsoDate(officialName);

  // Dropdown form: "Nickname -- officialName" when a nickname exists, else just officialName.
  // Case-preserving for date-bearing names (beta-…); capitalize-first for word-only names.
  const officialFallback = /\d/.test(officialName)
    ? officialName
    : officialName.charAt(0).toUpperCase() + officialName.slice(1);
  const displayName = nickname
    ? `${titleCaseWords(nickname)} -- ${officialName}`
    : officialFallback;

  // tag facets: leading word of officialName, "fixed" if so, nickname
  const facetBase = officialName.replace(/-fixed$/, '').replace(/-\d{8}.*$/, '');
  const tags: string[] = [];
  if (facetBase) tags.push(facetBase);
  if (fixed) tags.push('fixed');
  if (nickname) tags.push(nickname);

  return {
    slug: officialName,
    officialName,
    rev,
    nickname,
    fixed,
    displayName,
    date,
    tags,
  };
}

/**
 * Sort: dateless entries first (retrobution etc.), then dated entries newest-first,
 * with fixed before non-fixed within the same date.
 */
function compareEntries(a: BuildEntry, b: BuildEntry): number {
  const aHasDate = a.date !== '';
  const bHasDate = b.date !== '';
  if (aHasDate !== bHasDate) return aHasDate ? 1 : -1;
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
  if (a.nickname !== b.nickname) return a.nickname.localeCompare(b.nickname);
  return a.officialName.localeCompare(b.officialName);
}

/** Parse a rev string ("r7", "r20") into a number; -1 if unparseable. */
function revNumber(rev: string): number {
  const m = /^r(\d+)$/i.exec(rev);
  return m ? parseInt(m[1], 10) : -1;
}

export async function writeManifest(assets: DownloadedAsset[]): Promise<BuildEntry[]> {
  const all = assets.map((a) => parseAssetName(a.asset.name.replace(/\.zip$/i, '')));

  // If two ZIPs share an officialName (e.g. a future release ships both r7 and r8 of
  // the same build), keep the highest-rev one. Stable URLs are the whole point.
  const bySlug = new Map<string, BuildEntry>();
  for (const e of all) {
    const cur = bySlug.get(e.slug);
    if (!cur || revNumber(e.rev) > revNumber(cur.rev)) bySlug.set(e.slug, e);
    else log.warn(`duplicate slug "${e.slug}" — keeping ${cur.rev}, dropping ${e.rev}`);
  }

  const entries = [...bySlug.values()].sort(compareEntries);

  await mkdir(dirname(BUILDS_JSON), { recursive: true });
  await writeFile(BUILDS_JSON, JSON.stringify(entries, null, 2));
  return entries;
}
