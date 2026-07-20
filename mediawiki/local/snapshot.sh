#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${MEDIAWIKI_USERNAME:-}" || -z "${MEDIAWIKI_PASSWORD:-}" ]]; then
  echo "MEDIAWIKI_USERNAME and MEDIAWIKI_PASSWORD are required" >&2
  exit 1
fi

api_url="${MEDIAWIKI_API_URL:-https://fusionfall.wiki/api.php}"
cookie_file=/tmp/mediawiki.cookies
login_token_file=/tmp/login-token.json
login_result_file=/tmp/login-result.json

python - "$api_url" "$cookie_file" "$login_token_file" "$login_result_file" <<'PY'
import json
import os
import sys
import urllib.parse
import urllib.request
from http.cookiejar import MozillaCookieJar

api_url, cookie_path, token_path, result_path = sys.argv[1:]
cookies = MozillaCookieJar(cookie_path)
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))

def request(params):
    data = urllib.parse.urlencode(params).encode()
    request = urllib.request.Request(
        api_url,
        data=data,
        headers={
            "Accept": "application/json",
            "User-Agent": "OpenFusionAutoWiki/2.0 local snapshot",
        },
    )
    with opener.open(request) as response:
        return json.load(response)

token_result = request({
    "action": "query",
    "meta": "tokens",
    "type": "login",
    "format": "json",
})
with open(token_path, "w", encoding="utf-8") as output:
    json.dump(token_result, output)

login_result = request({
    "action": "login",
    "lgname": os.environ["MEDIAWIKI_USERNAME"],
    "lgpassword": os.environ["MEDIAWIKI_PASSWORD"],
    "lgtoken": token_result["query"]["tokens"]["logintoken"],
    "format": "json",
})
with open(result_path, "w", encoding="utf-8") as output:
    json.dump(login_result, output)

if login_result.get("login", {}).get("result") != "Success":
    raise SystemExit("MediaWiki login failed: " + json.dumps(login_result))

cookies.save(ignore_discard=True, ignore_expires=True)
PY

rm -f "$login_token_file" "$login_result_file"

resume_args=()
if [[ -f /snapshot/live/config.json ]]; then
  resume_args+=(--resume)
fi

exec wikiteam3dumpgenerator \
  "${api_url%/api.php}" \
  --api "$api_url" \
  --cookies "$cookie_file" \
  --path /snapshot/live \
  --delay "${MEDIAWIKI_SNAPSHOT_DELAY:-0.25}" \
  --xml \
  --xmlrevisions \
  --images \
  "${resume_args[@]}"
