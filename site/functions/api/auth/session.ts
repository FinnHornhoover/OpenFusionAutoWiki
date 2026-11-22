import { authHeaders, readSession, type AuthContext } from '../../_shared/auth';

export async function onRequestGet(context: AuthContext) {
  const session = await readSession(context);
  return Response.json(session ? { user: session.user, csrf: session.csrf } : { user: null }, { headers: authHeaders() });
}
