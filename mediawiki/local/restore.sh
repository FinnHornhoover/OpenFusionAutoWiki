#!/usr/bin/env bash
set -euo pipefail

cd /var/www/html

dump_path="${1:-}"
image_dir="${2:-}"

if [[ -z "$dump_path" ]]; then
  dump_path="$(find /snapshot -type f \( -name '*.xml' -o -name '*.xml.gz' -o -name '*.xml.bz2' -o -name '*.xml.7z' \) -print -quit)"
fi

if [[ -z "$dump_path" ]]; then
  echo "No XML dump found. Pass its container path as the first argument." >&2
  exit 1
fi

echo "Importing pages from $dump_path"
case "$dump_path" in
  *.gz) gzip -dc "$dump_path" | php maintenance/run.php importDump --no-updates --report=100 ;;
  *.bz2) bzip2 -dc "$dump_path" | php maintenance/run.php importDump --no-updates --report=100 ;;
  *.7z) 7zr e -so "$dump_path" | php maintenance/run.php importDump --no-updates --report=100 ;;
  *) php maintenance/run.php importDump --no-updates --report=100 "$dump_path" ;;
esac

if [[ -z "$image_dir" ]]; then
  image_dir="$(find /snapshot -type d -name images -print -quit)"
fi

if [[ -n "$image_dir" ]]; then
  echo "Importing media from $image_dir"
  php maintenance/run.php importImages \
    --search-recursively \
    --user="${MEDIAWIKI_ADMIN_USER:-LocalAdmin}" \
    "$image_dir"
fi

php maintenance/run.php rebuildtextindex
php maintenance/run.php rebuildrecentchanges
ofaw-mediawiki-refresh-links
php maintenance/run.php initSiteStats --update
php maintenance/run.php runJobs --procs="${MEDIAWIKI_JOB_WORKERS:-8}" --memory-limit=max --quiet

echo "Restore complete"
