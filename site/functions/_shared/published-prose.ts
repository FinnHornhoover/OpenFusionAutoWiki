import { installationToken, type GitHubWriteEnv } from './github-write';
import type { ProseEnv } from './prose';

export type PublishedProseEnv = ProseEnv & GitHubWriteEnv;

interface RepositoryIndex {
  paths: Set<string>;
  complete: boolean;
}

const indexes = new Map<string, { expires: number; result: Promise<RepositoryIndex | undefined> }>();
const tokens = new Map<string, { expires: number; result: Promise<string | undefined> }>();

export function proseReadToken(env: PublishedProseEnv, repository: string) {
  if (env.PROSE_READ_TOKEN || !env.GITHUB_APP_ID || !env.GITHUB_APP_INSTALLATION_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    return Promise.resolve(env.PROSE_READ_TOKEN);
  }
  const key = `${repository}:${env.GITHUB_APP_ID}:${env.GITHUB_APP_INSTALLATION_ID}`;
  const cached = tokens.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  const result = installationToken(env, repository, 'read').catch(() => {
    tokens.delete(key);
    return undefined;
  });
  tokens.set(key, { expires: Date.now() + 50 * 60_000, result });
  return result;
}

export function publishedProseIndex(repository: string, token?: string) {
  const cached = indexes.get(repository);
  if (cached && cached.expires > Date.now()) return cached.result;
  const result = (async () => {
    const response = await fetch(`https://api.github.com/repos/${repository}/git/trees/dev?recursive=1`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'OpenFusionAutoWiki',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: 'manual',
    });
    if (!response.ok) return undefined;
    const data = await response.json() as { tree?: { path: string; type: string }[]; truncated?: boolean };
    if (!Array.isArray(data.tree)) return undefined;
    return {
      paths: new Set(data.tree.filter((entry) => entry.type === 'blob' && entry.path.startsWith('pages/')).map((entry) => entry.path)),
      complete: data.truncated === false,
    };
  })().catch(() => undefined);
  indexes.set(repository, { expires: Date.now() + 30_000, result });
  return result;
}

export function noteProsePublication(repository: string, path: string) {
  void indexes.get(repository)?.result.then((index) => index?.paths.add(path));
}
