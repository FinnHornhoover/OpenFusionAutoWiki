#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
port="${MEDIAWIKI_PORT:-8081}"

export MEDIAWIKI_API_URL="${MEDIAWIKI_API_URL:-http://127.0.0.1:$port/api.php}"
export MEDIAWIKI_USERNAME="${MEDIAWIKI_USERNAME:-LocalAdmin}"
export MEDIAWIKI_PASSWORD="${MEDIAWIKI_PASSWORD:-local-admin-password}"
export MEDIAWIKI_MAX_SHARDS="${MEDIAWIKI_MAX_SHARDS:-all}"
export MEDIAWIKI_IMPORT_WORK="${MEDIAWIKI_IMPORT_WORK:-$root/.cache/mediawiki-import}"
export MEDIAWIKI_STATE_DIR="${MEDIAWIKI_STATE_DIR:-$root/.cache/mediawiki-state}"

cd "$root"
npm run prepare:mediawiki

docker compose -f docker-compose.mediawiki.yml exec -T \
  -e MEDIAWIKI_SKIP_MEDIA="${MEDIAWIKI_SKIP_MEDIA:-0}" \
  -e MEDIAWIKI_SKIP_FINALIZE="${MEDIAWIKI_SKIP_FINALIZE:-0}" \
  mediawiki \
  ofaw-mediawiki-install-release /ofaw-release /ofaw-work /ofaw-state
