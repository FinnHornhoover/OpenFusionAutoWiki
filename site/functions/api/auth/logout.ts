import { SESSION_COOKIE, authError, authHeaders, cookie, mutationSession, type AuthContext } from '../../_shared/auth';

export async function onRequestPost(context: AuthContext) {
  if (!await mutationSession(context)) return authError('Invalid session or request origin', 403);
  const headers = authHeaders();
  headers.append('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
  return new Response(null, { status: 204, headers });
}
