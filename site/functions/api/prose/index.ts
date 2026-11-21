import type { PageProse, ProseDocument } from '../../../src/content/document';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  PROSE_REPOSITORY?: string;
  PROSE_READ_TOKEN?: string;
}

interface PageMapping {
  general?: string;
  specific?: string;
  wikiImages?: PageProse['wikiImages'];
}

const segment = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

async function readDocument(env: Env, type: string, scope: 'general' | 'specific', key?: string) {
  if (!key) return undefined;
  if (!segment.test(key)) throw new Error('Invalid content key');
  const response = await fetch(
    `https://api.github.com/repos/${env.PROSE_REPOSITORY}/contents/pages/${type}/${scope}/${key}.json?ref=dev`,
    {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'OpenFusionAutoWiki',
        ...(env.PROSE_READ_TOKEN ? { Authorization: `Bearer ${env.PROSE_READ_TOKEN}` } : {}),
      },
      redirect: 'error',
    },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error('Content repository read failed');
  const document: ProseDocument = await response.json();
  if (document.version !== 1 || !Array.isArray(document.sections)) throw new Error('Invalid document');
  return document;
}

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  const url = new URL(request.url);
  const build = url.searchParams.get('build') ?? '';
  const type = url.searchParams.get('type') ?? '';
  const route = url.searchParams.get('route') ?? '';
  if (!segment.test(build) || !segment.test(type) || !route || route.length > 250) {
    return Response.json({ error: 'Invalid page address' }, { status: 400 });
  }
  if (!env.PROSE_REPOSITORY) return Response.json({});
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(env.PROSE_REPOSITORY)) {
    return Response.json({ error: 'Invalid repository configuration' }, { status: 503 });
  }

  try {
    const mappingUrl = new URL(`/data/${build}/prose/${type}.json`, url);
    const mapping = await env.ASSETS.fetch(new Request(mappingUrl));
    if (mapping.status === 404 || (mapping.ok && mapping.headers.get('Content-Type')?.includes('text/html'))) {
      return Response.json({});
    }
    if (!mapping.ok) throw new Error('Content mapping read failed');
    const entries: Record<string, PageMapping> = await mapping.json();
    if (!Object.hasOwn(entries, route)) return Response.json({});
    const { general, specific, wikiImages } = entries[route];
    const [generalDocument, specificDocument] = await Promise.all([
      readDocument(env, type, 'general', general),
      readDocument(env, type, 'specific', specific),
    ]);
    return Response.json(
      { general: generalDocument, specific: specificDocument, wikiImages } satisfies PageProse,
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=15' } },
    );
  } catch {
    return Response.json({ error: 'Prose temporarily unavailable' }, { status: 503 });
  }
}
