export interface AuthEnv {
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  SESSION_SIGNING_KEY?: string;
  PUBLIC_SITE_ORIGIN?: string;
}

export interface AuthContext {
  request: Request;
  env: AuthEnv;
}

interface SignedValue {
  expires: number;
}

export interface Session extends SignedValue {
  user: { id: number; login: string };
  csrf: string;
}

export const SESSION_COOKIE = '__Host-wiki_session';
export const ATTEMPT_COOKIE = '__Host-wiki_oauth';
export const SESSION_SECONDS = 8 * 60 * 60;
export const ATTEMPT_SECONDS = 10 * 60;

const encoder = new TextEncoder();

export function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value: string) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
}

export function randomToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function expiresIn(seconds: number) {
  return Date.now() + seconds * 1000;
}

function key(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signCookie(name: string, value: SignedValue, secret: string) {
  const payload = base64url(encoder.encode(JSON.stringify(value)));
  const signature = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(name + '.' + payload));
  return payload + '.' + base64url(new Uint8Array(signature));
}

async function readCookie<T extends SignedValue>(request: Request, name: string, secret?: string): Promise<T | null> {
  if (!secret || secret.length < 32) return null;
  const prefix = name + '=';
  const entry = request.headers.get('Cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  const match = /^([\w-]{1,3000})\.([\w-]{43})$/.exec(entry?.slice(prefix.length) ?? '');
  if (!match) return null;
  try {
    const [, payload, signature] = match;
    if (!await crypto.subtle.verify('HMAC', await key(secret), decode(signature), encoder.encode(name + '.' + payload))) return null;
    const value: T = JSON.parse(new TextDecoder().decode(decode(payload)));
    return Number.isFinite(value.expires) && value.expires > Date.now() ? value : null;
  } catch {
    return null;
  }
}

export interface OAuthAttempt extends SignedValue {
  state: string;
  verifier: string;
  returnTo: string;
}

export function readAttempt({ request, env }: AuthContext) {
  return readCookie<OAuthAttempt>(request, ATTEMPT_COOKIE, env.SESSION_SIGNING_KEY);
}

export function readSession({ request, env }: AuthContext) {
  return readCookie<Session>(request, SESSION_COOKIE, env.SESSION_SIGNING_KEY);
}

export function cookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Lax`;
}

export function authHeaders() {
  return new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
}

export function authError(error: string, status: number, headers = authHeaders()) {
  return Response.json({ error }, { status, headers });
}

export function redirect(location: string, headers = authHeaders()) {
  headers.set('Location', location);
  return new Response(null, { status: 303, headers });
}

export function oauthConfig({ request, env }: AuthContext) {
  const origin = new URL(request.url).origin;
  if (env.PUBLIC_SITE_ORIGIN !== origin || !origin.startsWith('https://')) return null;
  if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET || (env.SESSION_SIGNING_KEY?.length ?? 0) < 32) return null;
  return {
    origin,
    callback: origin + '/api/auth/callback',
    clientId: env.GITHUB_APP_CLIENT_ID,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET,
    secret: env.SESSION_SIGNING_KEY!,
  };
}

export function safeReturnTo(value: string | null, origin: string) {
  if (!value || value.length > 768 || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20]/.test(value)) return '/';
  const target = new URL(value, origin);
  if (target.origin !== origin || target.pathname.startsWith('//') || /^\/api(?:\/|$)/i.test(target.pathname)) return '/';
  return target.pathname + target.search + target.hash;
}

export async function mutationSession(context: AuthContext) {
  const { request, env } = context;
  if (request.headers.get('Origin') !== env.PUBLIC_SITE_ORIGIN || new URL(request.url).origin !== env.PUBLIC_SITE_ORIGIN) return null;
  const session = await readSession(context);
  return session && request.headers.get('X-Wiki-CSRF') === session.csrf ? session : null;
}
