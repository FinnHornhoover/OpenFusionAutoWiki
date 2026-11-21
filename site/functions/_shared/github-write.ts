import { base64url } from './auth';
import type { ProseDocument } from '../../src/content/document';

export interface GitHubWriteEnv {
  GITHUB_APP_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
}

const api = 'https://api.github.com';
const branch = 'dev';
const encoder = new TextEncoder();

function base64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function der(tag: number, ...parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  return new Uint8Array([tag, 0x82, length >> 8, length & 255, ...parts.flatMap((part) => Array.from(part))]);
}

function privateKeyBytes(pem: string) {
  const bytes = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (char) => char.charCodeAt(0));
  if (!pem.includes('BEGIN RSA PRIVATE KEY')) return bytes;
  const algorithm = Uint8Array.of(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00);
  return der(0x30, Uint8Array.of(0x02, 0x01, 0x00), algorithm, der(0x04, bytes));
}

export function githubRequest(path: string, token: string, body?: unknown) {
  return fetch(api + path, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'OpenFusionAutoWiki',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function installationToken(env: GitHubWriteEnv, repository: string) {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY || !/^\d+$/.test(env.GITHUB_APP_INSTALLATION_ID ?? '')) {
    throw new Error('Missing GitHub App configuration');
  }
  const now = Math.floor(Date.now() / 1000);
  const claims = { iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID };
  const encoded = [JSON.stringify({ alg: 'RS256', typ: 'JWT' }), JSON.stringify(claims)]
    .map((value) => base64url(encoder.encode(value))).join('.');
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const key = await crypto.subtle.importKey('pkcs8', privateKeyBytes(env.GITHUB_APP_PRIVATE_KEY), algorithm, false, ['sign']);
  const signature = await crypto.subtle.sign(algorithm, key, encoder.encode(encoded));
  const response = await githubRequest(
    `/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`,
    encoded + '.' + base64url(new Uint8Array(signature)),
    { repositories: [repository.split('/')[1]], permissions: { contents: 'write' } },
  );
  if (!response.ok) throw new Error('GitHub App token unavailable');
  const { token } = await response.json() as { token?: string };
  if (!token) throw new Error('GitHub App token missing');
  return token;
}

export async function branchHead(repository: string, token: string) {
  const response = await githubRequest(`/repos/${repository}/git/ref/heads/${branch}`, token);
  if (!response.ok) throw new Error('Content branch unavailable');
  const data = await response.json() as { object: { sha: string } };
  return data.object.sha;
}

export async function documentAt(repository: string, token: string, path: string, head: string) {
  const response = await githubRequest(`/repos/${repository}/contents/${path}?ref=${head}`, token);
  if (response.status === 404) return { revision: null, document: { version: 1, sections: [] } satisfies ProseDocument };
  if (!response.ok) throw new Error('Content document unavailable');
  const data = await response.json() as { sha: string; content: string; encoding: string };
  if (data.encoding !== 'base64') throw new Error('Unexpected document encoding');
  const bytes = Uint8Array.from(atob(data.content.replace(/\s/g, '')), (char) => char.charCodeAt(0));
  const document: ProseDocument = JSON.parse(new TextDecoder().decode(bytes));
  return { revision: data.sha, document };
}

export async function commitDocument(repository: string, token: string, path: string, expectedHeadOid: string, document: ProseDocument) {
  const bytes = encoder.encode(JSON.stringify(document, null, 2) + '\n');
  const response = await githubRequest('/graphql', token, {
    query: 'mutation Save($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }',
    variables: {
      input: {
        branch: { repositoryNameWithOwner: repository, branchName: branch },
        expectedHeadOid,
        message: { headline: `Update ${path}` },
        fileChanges: { additions: [{ path, contents: base64(bytes) }] },
      },
    },
  });
  if (!response.ok) throw new Error('GitHub commit request failed');
  const data = await response.json() as { data?: { createCommitOnBranch?: { commit?: { oid: string } } } };
  const commit = data.data?.createCommitOnBranch?.commit?.oid;
  if (!commit) return null;
  const header = encoder.encode(`blob ${bytes.byteLength}\0`);
  const object = new Uint8Array(header.length + bytes.length);
  object.set(header);
  object.set(bytes, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', object));
  const revision = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { commit, revision };
}
