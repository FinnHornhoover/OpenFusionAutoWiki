import { authError, authHeaders, mutationSession, readSession, type AuthEnv } from '../../_shared/auth';
import { branchHead, commitDocument, documentAt, installationToken, type GitHubWriteEnv } from '../../_shared/github-write';
import { pageMapping, segment, validRepository, type ProseEnv } from '../../_shared/prose';
import { readBytes, reserveMutation, type ProseBucketEnv } from '../../_shared/prose-storage';
import { validateDocument } from '../../_shared/prose-validation';

type Env = AuthEnv & ProseEnv & ProseBucketEnv & GitHubWriteEnv;
type Context = { request: Request; env: Env };

async function target({ request, env }: Context) {
  const url = new URL(request.url);
  const build = url.searchParams.get('build') ?? '';
  const type = url.searchParams.get('type') ?? '';
  const route = url.searchParams.get('route') ?? '';
  const scope = url.searchParams.get('scope');
  if (!segment.test(build) || !segment.test(type) || !route || route.length > 250 || (scope !== 'general' && scope !== 'specific')) return null;
  const mapping = await pageMapping(env, url, build, type, route);
  const key = mapping?.[scope];
  if (!mapping || !key || !segment.test(key)) return null;
  return { path: `pages/${type}/${scope}/${key}.json`, mapping };
}

export async function onRequestGet(context: Context) {
  if (!await readSession(context)) return authError('Sign in to edit prose', 401);
  const { env } = context;
  const repository = env.PROSE_REPOSITORY;
  if (!validRepository(repository)) return authError('Editing is unavailable', 503);
  try {
    const page = await target(context);
    if (!page) return authError('This prose target is unavailable', 404);
    const token = await installationToken(env, repository);
    const head = await branchHead(repository, token);
    const current = await documentAt(repository, token, page.path, head);
    return Response.json({ ...current, path: page.path, wikiImages: page.mapping.wikiImages }, { headers: authHeaders() });
  } catch {
    return authError('The current prose could not be loaded', 503);
  }
}

export async function onRequestPost(context: Context) {
  const session = await mutationSession(context);
  if (!session) return authError('Sign in and retry the save from the wiki', 403);
  const { env, request } = context;
  const repository = env.PROSE_REPOSITORY;
  const bucket = env.PROSE_IMAGES;
  if (!validRepository(repository) || !bucket) return authError('Editing is unavailable', 503);

  try {
    const page = await target(context);
    if (!page) return authError('This prose target is unavailable', 404);
    if (!await reserveMutation(bucket, 'saves', session.user.id)) {
      const headers = authHeaders();
      headers.set('Retry-After', String(60 - Math.floor(Date.now() / 1000) % 60));
      return authError('Too many saves. Try again shortly.', 429, headers);
    }

    const bytes = await readBytes(request, 64 * 1024);
    if (!bytes) return authError('The document is too large', 413);
    let draft: { revision: string | null; document: unknown };
    try {
      draft = JSON.parse(new TextDecoder().decode(bytes));
      if (!draft || (draft.revision !== null && (typeof draft.revision !== 'string' || !/^[a-f0-9]{40}$/.test(draft.revision)))) throw new Error();
    } catch {
      return authError('Invalid save request', 400);
    }

    const token = await installationToken(env, repository);
    let head = await branchHead(repository, token);
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await documentAt(repository, token, page.path, head);
      if (current.revision !== draft.revision) {
        return Response.json(current, { status: 409, headers: authHeaders() });
      }
      let validated: ReturnType<typeof validateDocument>;
      try {
        validated = validateDocument(draft.document, page.mapping, current.document, session.user);
      } catch (error) {
        return authError(error instanceof Error ? error.message : 'Invalid document', 422);
      }
      const images = await Promise.all([...validated.uploads].map((key) => bucket.head(key)));
      if (images.some((image) => !image)) return authError('An uploaded image could not be found', 422);
      if (images.reduce((total, image) => total + (image?.size ?? 0), 0) > 8 * 1024 * 1024) {
        return authError('Uploaded images must total 8 MiB or less', 422);
      }
      const commit = await commitDocument(repository, token, page.path, head, validated.document);
      if (commit) {
        return Response.json({ ...commit, document: validated.document }, { headers: authHeaders() });
      }
      const next = await branchHead(repository, token);
      if (next === head) break;
      head = next;
    }
    return authError('The save could not be committed. Retry with your draft.', 503);
  } catch {
    return authError('The save could not be completed. Retry with your draft.', 503);
  }
}
