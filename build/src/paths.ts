import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// build/dist/paths.js → repo root is two dirs up
export const REPO_ROOT = resolve(here, '..', '..');
export const CACHE_DIR = resolve(REPO_ROOT, '.cache');
export const FFINFO_CACHE = resolve(CACHE_DIR, 'ffinfo');
export const SITE_PUBLIC = resolve(REPO_ROOT, 'site', 'public');
export const ICONS_OUT = resolve(SITE_PUBLIC, 'icons');
export const DATA_OUT = resolve(SITE_PUBLIC, 'data');
export const BUILDS_JSON = resolve(SITE_PUBLIC, 'builds.json');
