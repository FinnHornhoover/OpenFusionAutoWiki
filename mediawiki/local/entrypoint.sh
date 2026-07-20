#!/usr/bin/env bash
set -euo pipefail

cd /var/www/html

config_dir=/var/www/html/local-config
generated_config="$config_dir/LocalSettings.php"
mkdir -p "$config_dir"

if [[ ! -f "$generated_config" ]]; then
  php maintenance/run.php install \
    --confpath="$config_dir" \
    --dbtype=mysql \
    --dbserver="${MEDIAWIKI_DB_HOST}" \
    --dbname="${MEDIAWIKI_DB_NAME}" \
    --dbuser="${MEDIAWIKI_DB_USER}" \
    --dbpass="${MEDIAWIKI_DB_PASSWORD}" \
    --server="${MEDIAWIKI_SERVER}" \
    --scriptpath="" \
    --lang=en \
    --pass="${MEDIAWIKI_ADMIN_PASSWORD}" \
    --skins=Vector \
    "FusionFall Wiki" "${MEDIAWIKI_ADMIN_USER}"
fi

cat > /var/www/html/LocalSettings.php <<'PHP'
<?php
require '/var/www/html/local-config/LocalSettings.php';
require '/opt/ofaw/LocalSettings.extra.php';
PHP

php maintenance/run.php update --quick

exec "$@"
