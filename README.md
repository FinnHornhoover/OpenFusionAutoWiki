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

| Secret                  | Used for                                                                      |
| ----------------------- | ----------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Deploying `site/dist` to Cloudflare Pages.                                    |
| `CLOUDFLARE_ACCOUNT_ID` | Selecting the Cloudflare account that owns the Pages project.                 |
| `MEDIAWIKI_USERNAME`    | Logging in to `fusionfall.wiki/api.php`. Use the dedicated publisher account. |
| `MEDIAWIKI_PASSWORD`    | Password for the dedicated publisher account.                                 |

The MediaWiki account needs `read`, `edit`, `createpage`, `upload`, and `apihighlimits` rights. `GITHUB_TOKEN` is supplied automatically by GitHub Actions and is used to resolve the latest FFInfoPacks release.

The wiki must retain its existing Maps and TabberNeue extensions. Generated pages require no gadget, Common.js, custom CSS, or additional extension.

The optional `FFWIKI_BASE_URL` repository variable controls absolute sitemap URLs. It defaults to `https://openfusion-auto-wiki.pages.dev`.

## Build and publishing pipeline

The shared normalization stage writes chunked JSON and route maps to `site/public/`. Two consumers then run:

1. `npm run build:site` compiles the React/MDX application into `site/dist/`.
2. `npm run build:mediawiki` renders MediaWiki wikitext into `mediawiki/output/pages/`.

The MediaWiki export contains one visible article per semantic topic. Same-name entity types and all available builds are bundled under the unprefixed title. Each article contains a small TabberNeue manifest; full build bodies load on demand from bot-owned `Project:OpenFusionAutoWiki/Data/...` support pages.

The root `manifest.json` points to bounded 500-page manifests under `mediawiki/output/shards/`. Pages declare `section` or `generated` ownership. The publisher batch-reads current revisions, merges OFAW sections into visible articles, replaces generated support pages wholesale, and skips unchanged text. Changed pages are written through concurrent `action=edit` requests using `baserevid` or `createonly` conflict protection. Referenced media is uploaded separately with bounded concurrency and chunking for large files.

Maps use the installed Maps extension. The publisher uploads the world map and referenced icons once; pages embed normalized marker coordinates and route lines. `Interactive Map` shows the world, while entity pages use focused interactive views.

For local export testing:

```bash
MEDIAWIKI_BUILD=retrobution npm run build:mediawiki
MEDIAWIKI_SHARD=000000 MEDIAWIKI_MAX_PAGES=10 npm run publish:mediawiki

# Publish every shard in the generated Retrobution manifest.
MEDIAWIKI_MAX_SHARDS=all npm run publish:mediawiki
```

Publishing recognizes these controls:

| Variable                                 | Behavior                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `MEDIAWIKI_BUILD`                        | Generates support bodies for one build while retaining complete bundled article shells; unset generates every build body. |
| `MEDIAWIKI_SHARD`                        | Publishes one explicit shard ID.                                                                                          |
| `MEDIAWIKI_START_SHARD`                  | Zero-based first shard for a manual consecutive batch.                                                                    |
| `MEDIAWIKI_MAX_SHARDS`                   | Consecutive shards to publish; defaults to `10` and accepts `all`.                                                        |
| `MEDIAWIKI_MAX_PAGES`                    | Limits pages read from each selected shard; useful for live test batches.                                                 |
| `MEDIAWIKI_EDIT_CONCURRENCY`             | Concurrent page edit workers; defaults to `8` and is capped at `16`.                                                      |
| `MEDIAWIKI_PAGE_QUERY_BATCH_SIZE`        | Titles read per query; defaults to and is capped at `500`.                                                                |
| `MEDIAWIKI_MEDIA_DELAY_MS`               | Delay between missing media uploads; defaults to 250 ms.                                                                  |
| `MEDIAWIKI_MEDIA_CONCURRENCY`            | Concurrent missing-media upload workers; defaults to `4` and is capped at `16`.                                           |
| `MEDIAWIKI_UPLOAD_CHUNK_BYTES`           | Chunk size for large media uploads; defaults to 512 KiB.                                                                  |
| `MEDIAWIKI_UPLOAD_CHUNK_THRESHOLD_BYTES` | Files larger than this use chunked upload; defaults to 1 MiB.                                                             |
| `GITHUB_RUN_NUMBER`                      | Advances scheduled publishing by one `MEDIAWIKI_MAX_SHARDS` group.                                                        |

MediaWiki endpoint, shard size, schema version, edit summary, and template settings live in `mediawiki/config.json`.

## Deployment

The workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on pushes to `main`, manual dispatches, and the daily continuation schedule. It:

1. Resolves and caches the latest FFInfoPacks release.
2. Downloads and normalizes all game builds.
3. Builds the React site and MediaWiki export.
4. Retains the MediaWiki output as a seven-day workflow artifact.
5. Publishes ten MediaWiki shards through conflict-safe concurrent edits using the configured credentials.
6. Deploys `site/dist` to Cloudflare Pages.

The shard group defaults from `GITHUB_RUN_NUMBER`, so successive workflow runs advance without overlap. Set `MEDIAWIKI_SHARD` to publish or retry one shard, or set `MEDIAWIKI_START_SHARD` for a manual consecutive batch.

From the GitHub Actions **Run workflow** dialog, you can optionally choose a single `mediawiki_build`, an explicit `mediawiki_shard`, a starting shard, the shard count, and the page edit concurrency. Leaving them blank performs the normal full export and advances from `GITHUB_RUN_NUMBER`.

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
