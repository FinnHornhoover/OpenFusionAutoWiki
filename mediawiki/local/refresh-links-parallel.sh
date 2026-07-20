#!/usr/bin/env bash
set -euo pipefail

cd /var/www/html

workers="${MEDIAWIKI_REFRESH_LINK_WORKERS:-8}"
if ! [[ "$workers" =~ ^[1-9][0-9]*$ ]]; then
  echo "MEDIAWIKI_REFRESH_LINK_WORKERS must be a positive integer" >&2
  exit 1
fi

max_page_id="$({
  printf '%s\n' \
    '$dbr = MediaWiki\MediaWikiServices::getInstance()->getConnectionProvider()->getReplicaDatabase(); echo $dbr->newSelectQueryBuilder()->select("MAX(page_id)")->from("page")->caller(__METHOD__)->fetchField();'
} | php maintenance/run.php eval)"

if ! [[ "$max_page_id" =~ ^[0-9]+$ ]] || (( max_page_id == 0 )); then
  echo "No pages require link refresh"
  exit 0
fi

if (( workers > max_page_id )); then
  workers="$max_page_id"
fi

chunk_size=$(( (max_page_id + workers - 1) / workers ))
log_dir="$(mktemp -d)"
pids=()

cleanup() {
  rm -rf "$log_dir"
}
trap cleanup EXIT

echo "Refreshing links through page ID $max_page_id with $workers workers"
for (( worker = 0; worker < workers; worker++ )); do
  start=$(( worker * chunk_size + 1 ))
  end=$(( start + chunk_size - 1 ))
  if (( end > max_page_id )); then
    end="$max_page_id"
  fi

  (
    php maintenance/run.php refreshLinks --e "$end" "$start" \
      >"$log_dir/$worker.log" 2>&1
  ) &
  pids+=("$!")
done

failed=0
for (( worker = 0; worker < workers; worker++ )); do
  if wait "${pids[$worker]}"; then
    echo "Link worker $((worker + 1))/$workers complete"
  else
    cat "$log_dir/$worker.log" >&2
    failed=1
  fi
done

if (( failed != 0 )); then
  echo "One or more link refresh workers failed" >&2
  exit 1
fi
