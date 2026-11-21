import {
  ATTEMPT_COOKIE, SESSION_COOKIE, SESSION_SECONDS, authError, authHeaders, cookie, expiresIn,
  oauthConfig, randomToken, readAttempt, redirect, signCookie, type AuthContext, type Session,
} from '../../_shared/auth';

export async function onRequestGet(context: AuthContext) {
  const config = oauthConfig(context);
  if (!config) return authError('GitHub sign-in is unavailable on this host', 503);
  const params = new URL(context.request.url).searchParams;
  const attempt = await readAttempt(context);
  const code = params.get('code');
  const headers = authHeaders();
  headers.append('Set-Cookie', cookie(ATTEMPT_COOKIE, '', 0));
  if (!attempt || attempt.state !== params.get('state') || !code) {
    return authError('Sign-in was cancelled or expired. Start again from the wiki.', 400, headers);
  }

  try {
    const exchange = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.callback,
        code,
        code_verifier: attempt.verifier,
      }),
      redirect: 'manual',
    });
    if (!exchange.ok) throw new Error('Access token exchange failed');
    const { access_token: token }: { access_token?: string } = await exchange.json();
    if (!token) throw new Error('Missing access token');

    const profile = await fetch('https://api.github.com/user', {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'OpenFusionAutoWiki' },
      redirect: 'manual',
    });
    if (!profile.ok) throw new Error('Profile lookup failed');
    const { id, login }: { id: number; login: string } = await profile.json();
    if (!Number.isSafeInteger(id) || id <= 0 || typeof login !== 'string' || !login) throw new Error('Invalid profile');
    const session: Session = { user: { id, login }, csrf: randomToken(), expires: expiresIn(SESSION_SECONDS) };
    headers.append('Set-Cookie', cookie(SESSION_COOKIE, await signCookie(SESSION_COOKIE, session, config.secret), SESSION_SECONDS));
    return redirect(attempt.returnTo, headers);
  } catch {
    return authError('GitHub sign-in could not be completed. Please try again.', 502, headers);
  }
}
