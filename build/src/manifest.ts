import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { BUILDS_JSON } from './paths.js';
import type { DownloadedAsset } from './download.js';

export interface BuildEntry {
  /** Full ZIP basename without `.zip`. Unique key. */
  slug: string;
  /** Part 1 of the slug — official build identity (e.g., `retrobution`, `beta-20111013-fixed`). */
  officialName: string;
  /** Part 2 of the slug — revision of the derived files (e.g., `r7`). */
  rev: string;
  /** Part 3 (optional) — short, user-friendly nickname (e.g., `academy`, `common-future`). */
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

export function parseSlug(slug: string): BuildEntry {
  // Split into three slots: officialName _ rev _ nickname(rest)
  const firstUs = slug.indexOf('_');
  const officialName = firstUs === -1 ? slug : slug.slice(0, firstUs);
  const afterFirst = firstUs === -1 ? '' : slug.slice(firstUs + 1);

  const secondUs = afterFirst.indexOf('_');
  const rev = secondUs === -1 ? afterFirst : afterFirst.slice(0, secondUs);
  const nickname = secondUs === -1 ? '' : afterFirst.slice(secondUs + 1);

  const fixed = /-fixed$/.test(officialName);
  const date = extractIsoDate(officialName);

  // Dropdown form: "Nickname -- officialName" when a nickname exists, else just officialName.
  // The officialName portion after "--" stays verbatim (it's a precise identifier).
  // The no-nickname fallback follows the title rule: date-bearing names keep their case,
  // word-only names get their first letter capitalized.
  const officialFallback = /\d/.test(officialName)
    ? officialName
    : officialName.charAt(0).toUpperCase() + officialName.slice(1);
  const displayName = nickname
    ? `${titleCaseWords(nickname)} -- ${officialName}`
    : officialFallback;

  // tag facets: leading word of officialName (before first dash/digit), "fixed" if so, nickname
  const facetBase = officialName.replace(/-fixed$/, '').replace(/-\d{8}.*$/, '');
  const tags: string[] = [];
  if (facetBase) tags.push(facetBase);
  if (fixed) tags.push('fixed');
  if (nickname) tags.push(nickname);

  return {
    slug,
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

export async function writeManifest(assets: DownloadedAsset[]): Promise<BuildEntry[]> {
  const entries = assets
    .map((a) => parseSlug(a.asset.name.replace(/\.zip$/i, '')))
    .sort(compareEntries);

  await mkdir(dirname(BUILDS_JSON), { recursive: true });
  await writeFile(BUILDS_JSON, JSON.stringify(entries, null, 2));
  return entries;
}
