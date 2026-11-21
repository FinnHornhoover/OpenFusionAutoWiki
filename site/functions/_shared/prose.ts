import type { PageProse } from '../../src/content/document';

export interface ProseEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  PROSE_REPOSITORY?: string;
  PROSE_READ_TOKEN?: string;
}

export interface PageMapping {
  general?: string;
  specific?: string;
  wikiImages?: PageProse['wikiImages'];
}

export const segment = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

export function validRepository(value?: string): value is string {
  return !!value && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(value);
}

export async function pageMapping(env: ProseEnv, url: URL, build: string, type: string, route: string) {
  const mappingUrl = new URL(`/data/${build}/prose/${type}.json`, url);
  const mapping = await env.ASSETS.fetch(new Request(mappingUrl));
  if (mapping.status === 404 || (mapping.ok && mapping.headers.get('Content-Type')?.includes('text/html'))) {
    return undefined;
  }
  if (!mapping.ok) throw new Error('Content mapping read failed');
  const entries: Record<string, PageMapping> = await mapping.json();
  if (!Object.hasOwn(entries, route)) return undefined;
  return entries[route];
}
