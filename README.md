# openfusion-auto-wiki

Generated wiki for FusionFall. It reads ZIP assets from [FFInfoPacks](https://github.com/FinnHornhoover/FFInfoPacks), normalizes every supported build, emits a static React+MDX site for Cloudflare Pages, and renders the same data as section-owned MediaWiki pages for fusionfall.wiki.

## Local development

```bash
npm install
npm run build:data       # download FFInfoPacks ZIPs + normalize (cached)
npm run build:site       # production Vite build
npm run build:mediawiki  # render MediaWiki pages and shard manifests
npm run build:all        # data + site + MediaWiki export
npm run dev              # Vite dev server on http://localhost:5173
```

`build:data` writes to `site/public/`. Re-runs reuse `.cache/` to avoid re-downloading ZIPs.

Optional environment variables:

```env
FFWIKI_RELEASE=latest
FFWIKI_BASE_URL=https://openfusion-auto-wiki.pages.dev
```

## Repository secrets

Configure these in **Settings > Secrets and variables > Actions** before enabling deployment:

| Secret                  | Used for                                   |
| ----------------------- | ------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | Deploying `site/dist` to Cloudflare Pages. |
| `CLOUDFLARE_ACCOUNT_ID` | Selecting the owning Cloudflare account.   |

`GITHUB_TOKEN` is supplied automatically. The workflow uses it to resolve FFInfoPacks and publish the generated MediaWiki server archive as a GitHub Release. MediaWiki credentials are not stored in GitHub Actions because releases are installed from the wiki server, not uploaded through the public API.

The wiki must retain its existing Maps and TabberNeue extensions. Generated pages require no gadget, Common.js, custom CSS, or additional extension. The optional `FFWIKI_BASE_URL` repository variable controls absolute sitemap URLs and defaults to `https://openfusion-auto-wiki.pages.dev`.

## Build and publishing pipeline

The shared normalization stage writes chunked JSON and route maps to `site/public/`. Two consumers then run:

1. `npm run build:site` compiles the React/MDX application into `site/dist/`.
2. `npm run build:mediawiki` renders MediaWiki wikitext, shard manifests, and bundled media into `mediawiki/output/`.

The MediaWiki export contains one visible article per semantic topic. Same-name entity types and all available builds are bundled under the unprefixed title. Each article contains a small TabberNeue manifest; full build bodies load on demand from bot-owned `Project:OpenFusionAutoWiki/Data/...` support pages.

Pages declare `section` or `generated` ownership. Before installation, `prepare:mediawiki` batch-reads current revisions and merges repository-owned sections into visible articles while retaining ordinary wiki prose. Generated support pages are replaced wholesale. It compares the previously installed manifest to the release, strips obsolete owned sections, and schedules stale pages for deletion only when they contain no user prose. Partial shard runs never perform stale-page cleanup.

Changed revisions are written to bounded gzip XML dumps. The server installer feeds these local files to `maintenance/run.php importDump --no-updates`, imports changed media with `importImages`, performs link/search/job maintenance once, and commits the new installed manifest only after every step succeeds. The public `action=edit` publisher remains available for small remote repairs but is not used by the release workflow.

Maps use the installed Maps extension. The release contains the world map and referenced icons; pages embed normalized marker coordinates and route lines. `Interactive Map` shows the world, while entity pages use focused interactive views.

Useful controls:

| Variable                          | Behavior                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `MEDIAWIKI_BUILD`                 | Generates support bodies for one build; unset generates all builds.                 |
| `MEDIAWIKI_SHARD`                 | Prepares one explicit shard and disables stale cleanup.                             |
| `MEDIAWIKI_START_SHARD`           | Zero-based first shard for a partial installation.                                  |
| `MEDIAWIKI_MAX_SHARDS`            | Consecutive shards to prepare; local bulk installation defaults to `all`.           |
| `MEDIAWIKI_MAX_PAGES`             | Limits pages from each selected shard for tests.                                    |
| `MEDIAWIKI_PAGE_QUERY_BATCH_SIZE` | Current-page query size; defaults to 500 when authenticated and 50 anonymously.     |
| `MEDIAWIKI_DUMP_PAGES`            | Maximum revisions per local XML dump; defaults to 5,000.                            |
| `MEDIAWIKI_DUMP_BYTES`            | Approximate uncompressed text limit per dump; defaults to 64 MiB.                   |
| `MEDIAWIKI_IMPORT_WORK`           | Directory for prepared dumps and the installation plan.                             |
| `MEDIAWIKI_STATE_DIR`             | Persistent directory containing the installed release manifest.                     |
| `MEDIAWIKI_SKIP_MEDIA`            | Set to `1` only for focused page tests; skipped media is not recorded as installed. |
| `MEDIAWIKI_SKIP_FINALIZE`         | Set to `1` only for focused tests to defer derived-data maintenance.                |

MediaWiki endpoint, shard size, schema version, edit summary, and template settings live in `mediawiki/config.json`.

### Local MediaWiki

The local stack mirrors MediaWiki 1.43, MariaDB 11.8, Maps 10.3, and TabberNeue 2.7. Start it at `http://127.0.0.1:8081`:

```bash
npm run mediawiki:local
```

The default login is `LocalAdmin` / `local-admin-password`. Build and install a complete export through the server-side maintenance path:

```bash
npm run build:mediawiki
MEDIAWIKI_USERNAME=LocalAdmin \
MEDIAWIKI_PASSWORD=local-admin-password \
MEDIAWIKI_MAX_SHARDS=all \
npm run mediawiki:publish-local
```

For a focused renderer test without global maintenance:

```bash
MEDIAWIKI_USERNAME=LocalAdmin \
MEDIAWIKI_PASSWORD=local-admin-password \
MEDIAWIKI_SHARD=000000 \
MEDIAWIKI_MAX_PAGES=10 \
MEDIAWIKI_SKIP_MEDIA=1 \
MEDIAWIKI_SKIP_FINALIZE=1 \
npm run mediawiki:publish-local
```

To clone `fusionfall.wiki`, the snapshot command sources the ignored `make_env.sh` by default. Set `OFAW_ENV_FILE` to use another environment file:

```bash
npm run mediawiki:snapshot
npm run mediawiki:local:reset
npm run mediawiki:local
npm run mediawiki:restore
```

`mediawiki:restore` imports snapshot XML and images with maintenance commands, then rebuilds derived data. Stop with `npm run mediawiki:local:down`; `npm run mediawiki:local:reset` removes local database, configuration, and upload volumes but leaves the release state and `.cache/fusionfall-wiki/` snapshots.

### Wiki server installation

The deployment workflow publishes `openfusion-autowiki-mediawiki.tar.gz` and its SHA-256 file on the latest GitHub Release. On the wiki host, use a persistent state directory and a temporary work directory:

```bash
gh release download --repo FinnHornhoover/OpenFusionAutoWiki \
  --pattern 'openfusion-autowiki-mediawiki.tar.gz*'
sha256sum -c openfusion-autowiki-mediawiki.tar.gz.sha256
if compgen -G 'openfusion-autowiki-mediawiki.tar.gz.part-*' > /dev/null; then
  cat openfusion-autowiki-mediawiki.tar.gz.part-* > openfusion-autowiki-mediawiki.tar.gz
fi
mkdir -p /srv/ofaw/release /srv/ofaw/work /srv/ofaw/state
tar -xzf openfusion-autowiki-mediawiki.tar.gz -C /srv/ofaw/release

export MEDIAWIKI_RELEASE_DIR=/srv/ofaw/release/mediawiki/output
export MEDIAWIKI_CONFIG=/srv/ofaw/release/mediawiki/config.json
export MEDIAWIKI_IMPORT_WORK=/srv/ofaw/work
export MEDIAWIKI_STATE_DIR=/srv/ofaw/state
export MEDIAWIKI_API_URL=http://127.0.0.1/api.php
export MEDIAWIKI_USERNAME=OpenFusionAutoWiki
export MEDIAWIKI_PASSWORD='...'
node /srv/ofaw/release/mediawiki/dist/prepare.js

MEDIAWIKI_ROOT=/var/www/html \
MEDIAWIKI_ADMIN_USER=OpenFusionAutoWiki \
bash /srv/ofaw/release/mediawiki/local/install-release.sh \
  "$MEDIAWIKI_RELEASE_DIR" "$MEDIAWIKI_IMPORT_WORK" "$MEDIAWIKI_STATE_DIR"
```

The credentials are used only for batched reads needed to preserve existing prose. Bulk page and media writes occur locally through MediaWiki maintenance commands and do not pass through Cloudflare or PHP upload limits. Keep `/srv/ofaw/state` across resets when reconciling releases; remove it only when deliberately establishing a new baseline.

## Deployment

The workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on pushes to `main`, manual dispatches, and daily. It:

1. Resolves and caches the latest FFInfoPacks release.
2. Downloads and normalizes every game build.
3. Builds the React site and self-contained MediaWiki export.
4. Packages and checksums a compressed MediaWiki server release.
5. Creates or refreshes the corresponding GitHub Release.
6. Deploys `site/dist` to Cloudflare Pages.

### Cloudflare Pages config files

Two static files in `site/public/` shape Pages' behavior:

- **`_redirects`** — SPA fallback: `/* /index.html 200`. Real files are served first; this catches React Router routes like `/<build>/missions/3`.
- **`_headers`** — per-path `Cache-Control`:
  - `/assets/*`, `/icons/*`, `/minimap/*`: `max-age=31536000, immutable`
  - `/data/*`, `/builds.json`: `max-age=300, stale-while-revalidate=86400`
  - `/sitemap.xml`, `/sitemaps/*`, `/robots.txt`: `max-age=3600`
  - `/`, `/index.html`: `max-age=0, must-revalidate`

## Repo layout

```
build/                  TypeScript normalization pipeline
  src/
    download.ts         FFInfoPacks GitHub release fetch
    icons.ts            md5-dedupe icon images
    minimap.ts          OFDropEditor minimap fetch
    manifest.ts         BuildEntry + slug derivation
    normalize/          one file per entity type
    chunk.ts            chunked per-entity emission
mediawiki/              MediaWiki renderer, publisher, and configuration
  local/                local MediaWiki image, snapshot, and restore tooling
  src/
    index.ts            wikitext export + shard manifests
    render.ts           type-specific links, lists, tables, and figures
    maps.ts             Maps-extension image layers, markers, and routes
    publish.ts          ownership-aware MediaWiki API publisher
  output/               generated pages and manifests (gitignored)
site/                   Vite + React + MDX
  public/               static assets + generated data (gitignored)
  src/
    components/         shared UI
    data/               hooks + typed JSON contracts
    pages/              routes
    templates/          per-entity-type MDX layouts
```
