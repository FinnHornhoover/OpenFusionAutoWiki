#!/usr/bin/env bash
set -euo pipefail

cd "${MEDIAWIKI_ROOT:-/var/www/html}"

release_dir="${1:-/ofaw-release}"
work_dir="${2:-/ofaw-work}"
state_dir="${3:-/ofaw-state}"
plan="$work_dir/plan.json"

if [[ ! -f "$plan" ]]; then
  echo "No prepared import plan found at $plan" >&2
  exit 1
fi

mapfile -t dumps < <(
  find "$work_dir/dumps" -maxdepth 1 -type f -name '*.xml.gz' -print | sort
)
echo "Importing ${#dumps[@]} prepared XML dumps"
for index in "${!dumps[@]}"; do
  echo "[$((index + 1))/${#dumps[@]}] ${dumps[$index]}"
  gzip -dc "${dumps[$index]}" \
    | php maintenance/run.php importDump --no-updates --report=1000
done

delete_file="$work_dir/delete-titles.txt"
if [[ -s "$delete_file" ]]; then
  delete_count="$(wc -l < "$delete_file")"
  echo "Deleting $delete_count stale, prose-free pages"
  php maintenance/run.php deleteBatch \
    --u="${MEDIAWIKI_ADMIN_USER:-OpenFusionAutoWiki}" \
    --r="Remove stale OpenFusionAutoWiki page" \
    "$delete_file"
fi

media_dir="$(mktemp -d /tmp/ofaw-media.XXXXXX)"
trap 'rm -rf "$media_dir"' EXIT
if [[ "${MEDIAWIKI_SKIP_MEDIA:-0}" != "1" ]]; then
  php -r '
foreach (json_decode(file_get_contents($argv[1]), true, 512, JSON_THROW_ON_ERROR) as $name) {
    echo $name, "\n";
}
' "$work_dir/media.json" | while IFS= read -r name; do
    if [[ ! -f "$release_dir/media/$name" ]]; then
      echo "Release is missing media/$name" >&2
      exit 1
    fi
    cp "$release_dir/media/$name" "$media_dir/$name"
  done

  if find "$media_dir" -maxdepth 1 -type f -print -quit | grep -q .; then
    media_count="$(find "$media_dir" -maxdepth 1 -type f | wc -l)"
    echo "Importing $media_count new or changed media files"
    php maintenance/run.php importImages \
      --overwrite \
      --user="${MEDIAWIKI_ADMIN_USER:-OpenFusionAutoWiki}" \
      --summary="Update OpenFusion AutoWiki media" \
      "$media_dir"
  fi
fi

if [[ "${MEDIAWIKI_SKIP_FINALIZE:-0}" != "1" ]]; then
  echo "Rebuilding derived MediaWiki data"
  php maintenance/run.php rebuildtextindex
  php maintenance/run.php rebuildrecentchanges
  if command -v ofaw-mediawiki-refresh-links >/dev/null 2>&1; then
    ofaw-mediawiki-refresh-links
  else
    php maintenance/run.php refreshLinks --e
  fi
  php maintenance/run.php initSiteStats --update
  php maintenance/run.php runJobs \
    --procs="${MEDIAWIKI_JOB_WORKERS:-8}" \
    --memory-limit=max \
    --quiet
fi

mkdir -p "$state_dir"
cp "$work_dir/next-state.json.gz" "$state_dir/installed.json.gz"
echo "OpenFusionAutoWiki release import complete"
