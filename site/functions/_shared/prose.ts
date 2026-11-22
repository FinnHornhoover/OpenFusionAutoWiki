import type { RouteMap } from '../../src/data/routeMap';
import type { PageProse } from '../../src/content/document';

export interface ProseEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  PROSE_REPOSITORY?: string;
  PROSE_READ_TOKEN?: string;
}

export interface PageMapping {
  entityId?: string;
  general?: string;
  specific?: string;
  wikiImages?: PageProse['wikiImages'];
}

export const segment = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

export function validRepository(value?: string): value is string {
  return !!value && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(value);
}

async function mappingAsset<T>(env: ProseEnv, url: URL, path: string) {
  const response = await env.ASSETS.fetch(new Request(new URL(path, url)));
  if (response.status === 404 || (response.ok && response.headers.get('Content-Type')?.includes('text/html'))) return undefined;
  if (!response.ok) throw new Error('Content mapping read failed');
  return await response.json() as T;
}

export async function pageMapping(env: ProseEnv, url: URL, build: string, type: string, route: string) {
  const entries = await mappingAsset<Record<string, PageMapping>>(env, url, `/data/${build}/prose/${type}.json`);
  if (entries && Object.hasOwn(entries, route)) return entries[route];

  const topics = await mappingAsset<Record<string, PageMapping>>(env, url, `/prose-topics/${type}.json`);
  if (!topics) return undefined;
  const candidates = Object.keys(topics).filter((topic) => route === topic || route.startsWith(topic + '-'));
  if (!candidates.length) return undefined;
  const routes = await mappingAsset<RouteMap>(env, url, `/data/${build}/routes/${type}.json`);
  if (!routes || !Object.hasOwn(routes, route)) return undefined;
  const target = routes[route];
  for (const topic of candidates) {
    const family = routes[topic];
    if (route === topic || (family?.kind === 'ambiguity' && family.matches.some((match) => match.routeId === route))) {
      return { ...topics[topic], entityId: target.kind === 'entity' ? String(target.id) : undefined };
    }
  }
  return undefined;
}
