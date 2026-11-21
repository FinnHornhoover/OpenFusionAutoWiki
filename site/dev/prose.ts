import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { Plugin } from 'vite';
import {
  authError, authHeaders, expiresIn, mutationSession, randomToken, readSession, redirect,
  safeReturnTo, SESSION_COOKIE, SESSION_SECONDS, signCookie, type Session,
} from '../functions/_shared/auth';
import { pageMapping, segment } from '../functions/_shared/prose';
import { readBytes, type ProseBucketEnv } from '../functions/_shared/prose-storage';
import { validateDocument } from '../functions/_shared/prose-validation';
import { onRequestGet as readImage } from '../functions/api/prose/images/[key]';
import { onRequestPost as uploadImage } from '../functions/api/prose/images/index';
import type { PageProse, ProseDocument, ProseScope } from '../src/content/document';

const devCookie = 'wiki_dev_session';
const devUser = { id: -1, login: 'local-editor' };
const loopbackNames = new Set(['localhost', '127.0.0.1', '[::1]']);
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

interface Snapshot {
  revision: string | null;
  document: ProseDocument;
}

const empty: Snapshot = { revision: null, document: { version: 1, sections: [] } };
const scopes = ['general', 'specific'] as const;
const routes = new Set(['/api/auth/login', '/api/auth/session', '/api/auth/logout', '/api/prose', '/api/prose/editor', '/api/prose/images']);

function hash(value: string | Uint8Array) {
  return createHash('sha1').update(value).digest('hex');
}

function snapshot(document: ProseDocument): Snapshot {
  return { revision: hash(JSON.stringify(document)), document };
}

function devRequest(url: URL, incoming: IncomingMessage) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const cookies = headers.get('Cookie')?.split(';').map((entry) => entry.trim());
  const localSession = cookies?.find((entry) => entry.startsWith(devCookie + '='));
  // Feed only the dev cookie into the shared session checks.
  headers.delete('Cookie');
  if (localSession) headers.set('Cookie', SESSION_COOKIE + localSession.slice(devCookie.length));

  const init: RequestInit & { duplex?: 'half' } = { method: incoming.method, headers };
  if (incoming.method === 'POST') {
    init.body = Readable.toWeb(incoming) as unknown as BodyInit;
    init.duplex = 'half';
  }
  return new Request(url, init);
}

async function send(outgoing: ServerResponse, result: Response) {
  outgoing.statusCode = result.status;
  result.headers.forEach((value, key) => outgoing.setHeader(key, value));
  outgoing.end(result.body ? Buffer.from(await result.arrayBuffer()) : undefined);
}

function memoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array; size: number; etag: string; customMetadata?: Record<string, string> }>();
  type Bucket = NonNullable<ProseBucketEnv['PROSE_IMAGES']>;
  return {
    async head(key: string) {
      return objects.get(key) ?? null;
    },
    async put(key: string, bytes: Uint8Array, { onlyIf, customMetadata }: Parameters<Bucket['put']>[2]) {
      const current = objects.get(key);
      if (onlyIf.get('If-None-Match') === '*' && current) return null;
      const matched = onlyIf.get('If-Match');
      if (matched && matched !== '"' + current?.etag + '"') return null;
      const object = { bytes, size: bytes.byteLength, etag: hash(bytes), customMetadata };
      objects.set(key, object);
      return object;
    },
    async get(key: string) {
      const object = objects.get(key);
      if (!object) return null;
      const body = new ReadableStream({ start(stream) { stream.enqueue(object.bytes); stream.close(); } });
      return { body, size: object.size, httpEtag: '"' + object.etag + '"' };
    },
  };
}

export default function localProse(): Plugin {
  return {
    name: 'local-wiki-prose',
    apply: 'serve',
    configureServer(server) {
      const secret = randomToken();
      const bucket = memoryBucket();
      const documents = new Map<string, Snapshot>([['pages/npcs/general/buttercup.json', snapshot({
        version: 1,
        sections: [{
          id: 'staging-check', title: 'Staging check', updatedAt: '2026-11-21',
          blocks: [{ id: 'intro', kind: 'markdown', source: 'This prose is available for local editing.' }],
          sections: [],
        }],
      })]]);

      async function readMapping(request: Request) {
        const path = new URL(request.url).pathname;
        const match = /^\/data\/([a-z0-9_-]+)\/prose\/([a-z0-9_-]+)\.json$/i.exec(path);
        if (!match) return new Response(null, { status: 404 });
        const file = resolve(server.config.root, 'prose-mappings', match[1], 'prose', match[2] + '.json');
        const body = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        });
        return body === null ? new Response(null, { status: 404 }) : new Response(body, { headers: { 'Content-Type': 'application/json' } });
      }

      async function handle(request: Request, url: URL) {
        const env = { PUBLIC_SITE_ORIGIN: url.origin, SESSION_SIGNING_KEY: secret, PROSE_IMAGES: bucket };
        const context = { request, env };
        const path = url.pathname;
        const method = request.method;

        if (path === '/api/auth/login' && method === 'GET') {
          const session: Session = { user: devUser, csrf: randomToken(), expires: expiresIn(SESSION_SECONDS) };
          const value = await signCookie(SESSION_COOKIE, session, secret);
          const headers = authHeaders();
          headers.set('Set-Cookie', devCookie + '=' + value + '; Path=/; Max-Age=' + SESSION_SECONDS + '; HttpOnly; SameSite=Strict');
          return redirect(safeReturnTo(url.searchParams.get('returnTo'), url.origin), headers);
        }
        if (path === '/api/auth/session' && method === 'GET') {
          const session = await readSession(context);
          return Response.json({ user: session?.user ?? null, csrf: session?.csrf, development: true }, { headers: authHeaders() });
        }
        if (path === '/api/auth/logout' && method === 'POST') {
          if (!await mutationSession(context)) return authError('Invalid session or request origin', 403);
          const headers = authHeaders();
          headers.set('Set-Cookie', devCookie + '=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict');
          return new Response(null, { status: 204, headers });
        }
        if (path === '/api/prose/images' && method === 'POST') return uploadImage(context);
        if (path.startsWith('/api/prose/images/') && method === 'GET') {
          return readImage({ params: { key: path.slice('/api/prose/images/'.length) }, env });
        }
        if (path !== '/api/prose' && path !== '/api/prose/editor') return authError('Method not allowed', 405);
        if (method !== 'GET' && (path !== '/api/prose/editor' || method !== 'POST')) return authError('Method not allowed', 405);

        const build = url.searchParams.get('build') ?? '';
        const type = url.searchParams.get('type') ?? '';
        const route = url.searchParams.get('route') ?? '';
        if (!segment.test(build) || !segment.test(type) || !route || route.length > 250) return authError('Invalid page address', 400);
        const mapping = await pageMapping({ ASSETS: { fetch: readMapping } }, url, build, type, route);
        if (!mapping) return path === '/api/prose' ? Response.json({}) : authError('This prose target is unavailable', 404);

        const documentPath = (scope: ProseScope) => {
          const key = mapping[scope];
          return key && segment.test(key) ? 'pages/' + type + '/' + scope + '/' + key + '.json' : undefined;
        };

        if (path === '/api/prose') {
          const available: ProseScope[] = [];
          const prose: PageProse = { wikiImages: mapping.wikiImages, scopes: available };
          for (const scope of scopes) {
            const key = documentPath(scope);
            if (!key) continue;
            available.push(scope);
            prose[scope] = documents.get(key)?.document;
          }
          return Response.json(prose, { headers: authHeaders() });
        }

        const scope = url.searchParams.get('scope');
        const key = scope === 'general' || scope === 'specific' ? documentPath(scope) : undefined;
        if (!key) return authError('This prose target is unavailable', 404);
        if (method === 'GET') {
          if (!await readSession(context)) return authError('Sign in to edit prose', 401);
          return Response.json({ ...(documents.get(key) ?? empty), path: key, wikiImages: mapping.wikiImages }, { headers: authHeaders() });
        }

        const session = await mutationSession(context);
        if (!session) return authError('Sign in and retry the save from the wiki', 403);
        const bytes = await readBytes(request, 64 * 1024);
        if (!bytes) return authError('The document is too large', 413);
        let draft: { revision: string | null; document: unknown };
        try {
          draft = JSON.parse(new TextDecoder().decode(bytes));
          if (!draft || (draft.revision !== null && (typeof draft.revision !== 'string' || !/^[a-f0-9]{40}$/.test(draft.revision)))) throw new Error();
        } catch {
          return authError('Invalid save request', 400);
        }
        const current = documents.get(key) ?? empty;
        if (current.revision !== draft.revision) return Response.json(current, { status: 409, headers: authHeaders() });
        try {
          const { document, uploads } = validateDocument(draft.document, mapping, current.document, session.user);
          const images = await Promise.all([...uploads].map((key) => bucket.head(key)));
          if (images.some((image) => !image)) return authError('An uploaded image could not be found', 422);
          if (images.reduce((total, image) => total + (image?.size ?? 0), 0) > 8 * 1024 * 1024) {
            return authError('Uploaded images must total 8 MiB or less', 422);
          }
          if ((documents.get(key) ?? empty).revision !== current.revision) {
            return Response.json(documents.get(key) ?? empty, { status: 409, headers: authHeaders() });
          }
          const saved = snapshot(document);
          documents.set(key, saved);
          return Response.json(saved, { headers: authHeaders() });
        } catch (error) {
          return authError(error instanceof Error ? error.message : 'Invalid document', 422);
        }
      }

      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/api/') || !loopbackAddresses.has(request.socket.remoteAddress ?? '')) return next();
        const url = new URL(request.url, 'http://' + request.headers.host);
        if (!loopbackNames.has(url.hostname) || (!routes.has(url.pathname) && !url.pathname.startsWith('/api/prose/images/'))) return next();
        void handle(devRequest(url, request), url).then((result) => send(response, result)).catch(() => {
          void send(response, authError('The local prose service could not complete the request', 500));
        });
      });
    },
  };
}
