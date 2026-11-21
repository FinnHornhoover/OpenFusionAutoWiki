import {
  ATTEMPT_COOKIE, ATTEMPT_SECONDS, authError, authHeaders, base64url, cookie, expiresIn,
  oauthConfig, randomToken, redirect, safeReturnTo, signCookie, type AuthContext, type OAuthAttempt,
} from '../../_shared/auth';

export async function onRequestGet(context: AuthContext) {
  const config = oauthConfig(context);
  if (!config) return authError('GitHub sign-in is unavailable on this host', 503);
  const attempt: OAuthAttempt = {
    state: randomToken(),
    verifier: randomToken(),
    returnTo: safeReturnTo(new URL(context.request.url).searchParams.get('returnTo'), config.origin),
    expires: expiresIn(ATTEMPT_SECONDS),
  };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(attempt.verifier));
  const authorization = new URL('https://github.com/login/oauth/authorize');
  authorization.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callback,
    state: attempt.state,
    code_challenge: base64url(new Uint8Array(digest)),
    code_challenge_method: 'S256',
  }).toString();
  const headers = authHeaders();
  headers.append('Set-Cookie', cookie(ATTEMPT_COOKIE, await signCookie(ATTEMPT_COOKIE, attempt, config.secret), ATTEMPT_SECONDS));
  return redirect(authorization.href, headers);
}
