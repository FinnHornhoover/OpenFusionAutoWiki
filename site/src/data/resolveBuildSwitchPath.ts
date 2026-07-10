import { loadRouteMap } from './routeMap';
import { chunkFor } from './useEntity';
import type { BuildMeta } from './types';

const metaCache = new Map<string, Promise<BuildMeta>>();
const existenceCache = new Map<string, Promise<boolean>>();

async function loadMeta(build: string): Promise<BuildMeta> {
  let pending = metaCache.get(build);
  if (!pending) {
    pending = fetch(`/data/${build}/meta.json`)
      .then((response) => response.ok ? response.json() as Promise<BuildMeta> : { builtTypes: [] })
      .catch(() => ({ builtTypes: [] }));
    metaCache.set(build, pending);
  }
  return pending;
}

async function legacyEntityExists(build: string, type: string, id: string): Promise<boolean> {
  const chunk = chunkFor(type, id);
  if (chunk < 0) return false;
  const key = `${build}::${type}::${id}`;
  let pending = existenceCache.get(key);
  if (!pending) {
    pending = fetch(`/data/${build}/${type}/${chunk}.json`)
      .then(async (response) => {
        if (!response.ok) return false;
        const bucket = await response.json() as Record<string, unknown>;
        return Boolean(bucket[id]);
      })
      .catch(() => false);
    existenceCache.set(key, pending);
  }
  return pending;
}

async function resolveEntitySuffix(build: string, type: string, id: string): Promise<string[] | null> {
  try {
    const routes = await loadRouteMap(build, type);
    const target = routes[id];
    if (target) return [type, target.canonical];
  } catch {
    // Older generated data can still be checked through legacy chunks.
  }
  return (await legacyEntityExists(build, type, id)) ? [type, id] : null;
}

async function resolveSuffix(build: string, suffix: string[]): Promise<string[] | null> {
  if (suffix.length === 0) return [];
  if (suffix[0] === 'map') return suffix.length === 1 ? suffix : null;

  const meta = await loadMeta(build);
  const type = suffix[0];
  if (!meta.builtTypes.includes(type)) return null;
  if (suffix.length === 1) return suffix;
  if (suffix.length === 2) return resolveEntitySuffix(build, type, suffix[1]);
  return null;
}

export async function resolveBuildSwitchPath(build: string, pathname: string): Promise<string> {
  const segments = pathname.split('/').filter(Boolean);
  const suffix = segments.slice(1);
  for (let length = suffix.length; length >= 0; length -= 1) {
    const candidate = suffix.slice(0, length);
    const resolved = await resolveSuffix(build, candidate);
    if (resolved) {
      return `/${[build, ...resolved].join('/')}`;
    }
  }
  return `/${build}`;
}
