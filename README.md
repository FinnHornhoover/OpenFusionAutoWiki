# openfusion-auto-wiki

Generated wiki for FusionFall. It reads ZIP assets from [FFInfoPacks](https://github.com/FinnHornhoover/FFInfoPacks), normalizes every build's missions / NPCs / items / monsters / areas / nanos, and emits a static React+MDX site to be hosted on Cloudflare Pages.

## Local development

```bash
npm install
npm run build:data    # download FFInfoPacks ZIPs + normalize (cached)
npm run dev           # vite dev server on http://localhost:5173
```

`build:data` writes to `site/public/`. Re-runs reuse `.cache/` to avoid re-downloading ZIPs.
It also reads player prices from the price guide when `google-service-account.json`
exists at the repository root or `GOOGLE_SERVICE_ACCOUNT_JSON` contains the
service-account JSON (or a path to it). Missing credentials leave prices absent
without failing the rest of the build.

Optional env vars:

```env
FFWIKI_RELEASE=latest
FFWIKI_BASE_URL=https://openfusion-auto-wiki.pages.dev
```

Required secrets:
```env
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
GOOGLE_SERVICE_ACCOUNT_JSON=...
```

## Deployment (Cloudflare Pages)

The workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) deploys to Cloudflare Pages on pushes to `main`.

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
build/                  TypeScript pipeline
  src/
    download.ts         FFInfoPacks GitHub release fetch
    icons.ts            md5-dedupe icon images
    minimap.ts          OFDropEditor minimap fetch
    manifest.ts         BuildEntry + slug derivation
    normalize/          one file per entity type
    chunk.ts            chunked per-entity emission
site/                   Vite + React + MDX
  public/               static assets + generated data (gitignored)
  src/
    components/         shared UI
    data/               hooks + typed JSON contracts
    pages/              routes
    templates/          per-entity-type MDX layouts
```
