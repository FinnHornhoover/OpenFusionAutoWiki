import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BuildEntry } from '../manifest.js';
import { BUILDS_JSON, DATA_OUT, REPO_ROOT, SITE_PUBLIC } from '../paths.js';
import type { RouteMap } from './routes.js';

interface ProseMapping {
  general?: string;
  specific?: string;
  entityId?: string;
  wikiImages?: Record<string, string>;
}

const safeKey = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

async function readOverrides(path: string): Promise<Record<string, ProseMapping>> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function documentKey(topic: string) {
  return safeKey.test(topic) ? topic : 'topic-' + createHash('sha256').update(topic).digest('hex').slice(0, 24);
}

export async function writeProseMapping(build: string, type: string, routes: RouteMap): Promise<number> {
  const [shared, overrides] = await Promise.all([
    readOverrides(join(SITE_PUBLIC, 'prose-topics', type + '.json')),
    readOverrides(join(REPO_ROOT, 'site', 'prose-mappings', build, 'prose', type + '.json')),
  ]);

  const topics = new Map<string, string>();
  for (const [route, target] of Object.entries(routes)) {
    if (route !== target.canonical || target.kind !== 'ambiguity') continue;
    for (const match of target.matches) {
      const member = routes[match.routeId];
      if (member?.kind === 'entity' && member.id === match.id) topics.set(member.canonical, route);
    }
  }

  const entries = Object.entries(routes).flatMap(([route, target]) => {
    if (route !== target.canonical) return [];
    const topic = target.kind === 'entity' && target.proseTopic ? target.proseTopic : topics.get(route) ?? route;
    const mapping = {
      general: documentKey(topic),
      entityId: target.kind === 'entity' ? String(target.id) : undefined,
      ...(Object.hasOwn(shared, topic) ? shared[topic] : undefined),
      ...(Object.hasOwn(overrides, route) ? overrides[route] : undefined),
    };
    if (!safeKey.test(mapping.general ?? '') || (mapping.specific !== undefined && !safeKey.test(mapping.specific))) {
      throw new Error(`Invalid prose document key for ${build}/${type}/${route}`);
    }
    return [[route, mapping] as const];
  });

  const directory = join(DATA_OUT, build, 'prose');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, type + '.json'), JSON.stringify(Object.fromEntries(entries)));
  return entries.length;
}

async function refreshProseMappings() {
  const builds = JSON.parse(await readFile(BUILDS_JSON, 'utf8')) as BuildEntry[];
  let files = 0;
  let pages = 0;
  for (const { slug } of builds) {
    const directory = join(DATA_OUT, slug, 'routes');
    const entries = await readdir(directory);
    for (const file of entries) {
      if (!file.endsWith('.json')) continue;
      const routes = JSON.parse(await readFile(join(directory, file), 'utf8')) as RouteMap;
      pages += await writeProseMapping(slug, file.slice(0, -5), routes);
      files++;
    }
  }
  console.log(`Generated ${files} prose mappings for ${pages.toLocaleString()} build routes.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await refreshProseMappings();
}
