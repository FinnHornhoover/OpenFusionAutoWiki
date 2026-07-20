FROM composer:2 AS composer

FROM mediawiki:1.43

USER root

COPY --from=composer /usr/bin/composer /usr/local/bin/composer

RUN apt-get update \
    && apt-get install -y --no-install-recommends bzip2 p7zip-full unzip \
    && docker-php-ext-install pcntl \
    && rm -rf /var/lib/apt/lists/*

COPY mediawiki/local/composer.local.json /var/www/html/composer.local.json
COPY mediawiki/local/uploads.ini /usr/local/etc/php/conf.d/ofaw-uploads.ini

RUN composer update --no-interaction --no-progress --no-dev \
    && rm -rf /root/.composer/cache

COPY mediawiki/local/LocalSettings.extra.php /opt/ofaw/LocalSettings.extra.php
COPY mediawiki/local/entrypoint.sh /usr/local/bin/ofaw-mediawiki-entrypoint
COPY mediawiki/local/refresh-links-parallel.sh /usr/local/bin/ofaw-mediawiki-refresh-links
COPY mediawiki/local/restore.sh /usr/local/bin/ofaw-mediawiki-restore
COPY mediawiki/local/install-release.sh /usr/local/bin/ofaw-mediawiki-install-release

RUN chmod +x \
    /usr/local/bin/ofaw-mediawiki-entrypoint \
    /usr/local/bin/ofaw-mediawiki-refresh-links \
    /usr/local/bin/ofaw-mediawiki-install-release \
    /usr/local/bin/ofaw-mediawiki-restore

ENTRYPOINT ["ofaw-mediawiki-entrypoint"]
CMD ["apache2-foreground"]
