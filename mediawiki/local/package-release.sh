#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
archive="${1:-$root/mediawiki/openfusion-autowiki-mediawiki.tar.gz}"
part_bytes="${MEDIAWIKI_RELEASE_PART_BYTES:-1900000000}"

if [[ ! -f "$root/mediawiki/output/manifest.json" ]]; then
  echo "Build the MediaWiki export before packaging it." >&2
  exit 1
fi
if [[ ! -f "$root/mediawiki/dist/prepare.js" ]]; then
  echo "Build the MediaWiki workspace before packaging it." >&2
  exit 1
fi

node - "$root" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "mediawiki/output/manifest.json"), "utf8"),
);
for (const record of manifest.media) {
  const expected = path.join("mediawiki", "output", "media", record.name);
  if (record.source !== expected || !fs.existsSync(path.join(root, expected))) {
    throw new Error("MediaWiki release is missing bundled media: " + record.name);
  }
}
NODE

mkdir -p "$(dirname "$archive")"
rm -f "$archive" "$archive".part-*
tar -czf "$archive" \
  -C "$root" \
  mediawiki/output \
  mediawiki/dist \
  mediawiki/config.json \
  mediawiki/local/install-release.sh

size="$(stat -c %s "$archive")"
if (( size > part_bytes )); then
  split --bytes="$part_bytes" --numeric-suffixes --suffix-length=3 \
    "$archive" "$archive.part-"
  rm "$archive"
  printf '%s\n' "$archive".part-*
else
  echo "$archive"
fi
