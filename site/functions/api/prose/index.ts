import type { PageProse, ProseDocument } from '../../../src/content/document';

import { pageMapping, segment, validRepository, type ProseEnv } from '../../_shared/prose';

async function readDocument(env: ProseEnv, type: string, scope: 'general' | 'specific', key?: string) {
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
      redirect: 'manual',
    },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error('Content repository read failed');
  const document: ProseDocument = await response.json();
  if (document.version !== 1 || !Array.isArray(document.sections)) throw new Error('Invalid document');
  return document;
}

export async function onRequestGet({ request, env }: { request: Request; env: ProseEnv }) {
  const url = new URL(request.url);
  const build = url.searchParams.get('build') ?? '';
  const type = url.searchParams.get('type') ?? '';
  const route = url.searchParams.get('route') ?? '';
  if (!segment.test(build) || !segment.test(type) || !route || route.length > 250) {
    return Response.json({ error: 'Invalid page address' }, { status: 400 });
  }
  if (!env.PROSE_REPOSITORY) return Response.json({});
  if (!validRepository(env.PROSE_REPOSITORY)) {
    return Response.json({ error: 'Invalid repository configuration' }, { status: 503 });
  }

  try {
    const mapping = await pageMapping(env, url, build, type, route);
    if (!mapping) return Response.json({});
    const { general, specific, wikiImages, entityId } = mapping;
    const [generalDocument, specificDocument] = await Promise.all([
      readDocument(env, type, 'general', general),
      readDocument(env, type, 'specific', specific),
    ]);
    return Response.json(
      { general: generalDocument, specific: specificDocument, wikiImages, entityId, scopes: ([general && 'general', specific && 'specific'] as const).filter((scope) => scope === 'general' || scope === 'specific') } satisfies PageProse,
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=15' } },
    );
  } catch {
    return Response.json({ error: 'Prose temporarily unavailable' }, { status: 503 });
  }
}
