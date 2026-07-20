#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${OFAW_ENV_FILE:-$root/make_env.sh}"

if [[ -f "$env_file" ]]; then
  # Credentials remain outside the repository and are exported only to the tool container.
  set -a
  source "$env_file"
  set +a
fi

if [[ -z "${MEDIAWIKI_USERNAME:-}" || -z "${MEDIAWIKI_PASSWORD:-}" ]]; then
  echo "Set MEDIAWIKI_USERNAME and MEDIAWIKI_PASSWORD, or provide OFAW_ENV_FILE." >&2
  exit 1
fi

cd "$root"
docker compose -f docker-compose.mediawiki.yml --profile tools run --rm snapshot
