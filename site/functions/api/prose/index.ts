import type { PageProse, ProseDocument } from '../../../src/content/document';

import { proseReadToken, publishedProseIndex, type PublishedProseEnv } from '../../_shared/published-prose';
import { pageMapping, segment, validRepository } from '../../_shared/prose';

async function readDocument(repository: string, path: string | undefined, token?: string) {
  if (!path) return undefined;
  const response = await fetch(
    `https://api.github.com/repos/${repository}/contents/${path}?ref=dev`,
    {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'OpenFusionAutoWiki',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

export async function onRequestGet({ request, env }: { request: Request; env: PublishedProseEnv }) {
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
    const scopes: NonNullable<PageProse['scopes']> = [];
    const generalPath = general && segment.test(general) ? `pages/${type}/general/${general}.json` : undefined;
    const specificPath = specific && segment.test(specific) ? `pages/${type}/specific/${specific}.json` : undefined;
    if (generalPath) scopes.push('general');
    if (specificPath) scopes.push('specific');
    const availability = { wikiImages, entityId, scopes };
    const repository = env.PROSE_REPOSITORY;
    const token = await proseReadToken(env, repository);
    const index = await publishedProseIndex(repository, token);
    const published = (path?: string) => path && (!index?.complete || index.paths.has(path)) ? path : undefined;
    try {
      const [generalDocument, specificDocument] = await Promise.all([
        readDocument(repository, published(generalPath), token),
        readDocument(repository, published(specificPath), token),
      ]);
      return Response.json(
        { ...availability, general: generalDocument, specific: specificDocument } satisfies PageProse,
        { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=15' } },
      );
    } catch {
      return Response.json(availability, { headers: { 'Cache-Control': 'no-store' } });
    }
  } catch {
    return Response.json({ error: 'Prose temporarily unavailable' }, { status: 503 });
  }
}
