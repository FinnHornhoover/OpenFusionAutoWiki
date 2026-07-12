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

| Secret | Used for |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Deploying `site/dist` to Cloudflare Pages. |
| `CLOUDFLARE_ACCOUNT_ID` | Selecting the Cloudflare account that owns the Pages project. |
| `MEDIAWIKI_USERNAME` | Logging in to `fusionfall.wiki/api.php`. A dedicated bot account or BotPassword username is recommended. |
| `MEDIAWIKI_PASSWORD` | Password or BotPassword paired with `MEDIAWIKI_USERNAME`. |

The MediaWiki account needs permission to read, create, and edit the target pages. `GITHUB_TOKEN` is supplied automatically by GitHub Actions and is used to resolve the latest FFInfoPacks release.

The optional `FFWIKI_BASE_URL` repository variable controls absolute sitemap URLs. It defaults to `https://openfusion-auto-wiki.pages.dev`.

## Build and publishing pipeline

The shared normalization stage writes chunked JSON and route maps to `site/public/`. Two consumers then run:

1. `npm run build:site` compiles the React/MDX application into `site/dist/`.
2. `npm run build:mediawiki` renders MediaWiki wikitext into `mediawiki/output/pages/`.

The MediaWiki export contains a small root `manifest.json` and bounded 500-page manifests under `mediawiki/output/shards/`. Splitting the manifest prevents Node string and heap limits on the roughly 590,000-page full export.

Generated wiki sections contain `OFAW` ownership markers. Publishing replaces only sections carrying those markers and appends missing generated sections, preserving general text and all unowned sections.

For local export testing:

```bash
MEDIAWIKI_BUILD=retrobution npm run build:mediawiki
MEDIAWIKI_SHARD=000000 npm run publish:mediawiki
```

Publishing recognizes these controls:

| Variable | Behavior |
| --- | --- |
| `MEDIAWIKI_BUILD` | Generates only one build slug; unset generates every build. |
| `MEDIAWIKI_SHARD` | Publishes one explicit shard ID. |
| `MEDIAWIKI_MAX_SHARDS` | Number of shards selected per run; the workflow uses `1`. |
| `MEDIAWIKI_EDIT_DELAY_MS` | Delay between edits; defaults to 1,500 ms. |
| `GITHUB_RUN_NUMBER` | Selects the next shard when no explicit shard is supplied. |

MediaWiki endpoint, shard size, schema version, edit summary, and template settings live in `mediawiki/config.json`.

## Deployment

The workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on pushes to `main`, manual dispatches, and the daily continuation schedule. It:

1. Resolves and caches the latest FFInfoPacks release.
2. Downloads and normalizes all game builds.
3. Builds the React site and MediaWiki export.
4. Retains the MediaWiki output as a seven-day workflow artifact.
5. Publishes one MediaWiki shard using the configured credentials.
6. Deploys `site/dist` to Cloudflare Pages.

The shard defaults from `GITHUB_RUN_NUMBER`, so successive workflow runs advance through the export. Set `MEDIAWIKI_SHARD` locally to publish or retry a specific shard.

From the GitHub Actions **Run workflow** dialog, you can optionally choose a single `mediawiki_build`, an explicit `mediawiki_shard`, and `mediawiki_max_shards`. Leaving them blank performs the normal full export and advances from `GITHUB_RUN_NUMBER`.

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
    publish.ts          section-preserving MediaWiki API publisher
  output/               generated pages and manifests (gitignored)
site/                   Vite + React + MDX
  public/               static assets + generated data (gitignored)
  src/
    components/         shared UI
    data/               hooks + typed JSON contracts
    pages/              routes
    templates/          per-entity-type MDX layouts
```
