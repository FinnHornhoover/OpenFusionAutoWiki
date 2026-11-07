# openfusion-auto-wiki

Generated wiki for FusionFall. It reads ZIP assets from [FFInfoPacks](https://github.com/FinnHornhoover/FFInfoPacks), normalizes every build's missions / NPCs / items / monsters / areas / nanos, and emits a static React+MDX site to be hosted on Cloudflare Pages.

## Local development

Use Node.js 22 or newer.

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

### 3D previews (R2)

Models, textures and animations share a content-addressed R2 pool across builds
and releases. Entity recipes stay with the Pages data. The viewer loads on demand;
missing client models retain their normal icon-only pages.
Outfit previews include sets with one item per slot; collections containing
alternatives need a picker in a later iteration.
The viewer opens in a modal (full viewport on small screens), with grouped
animations, seeking, speed and loop controls. Vehicle motions, other weapon styles,
partial layers and body-shape controls are excluded from public animation choices.
Only selected clips and required composition controls enter the shared asset pool.

After feature completion, enable production previews:

1. Create a Standard R2 bucket and connect `assets.<your-domain>` to it.
2. Allow CORS `GET`/`HEAD` from the wiki's origin. Add a cache rule making all
   assets on that hostname eligible for caching (including `.glb` and `.bin`).
3. Set repository variables `FFWIKI_OBJECTS_URL=https://assets.<your-domain>`
   and `R2_BUCKET=<bucket-name>`.
4. Set secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` using an R2 API token
   with Object Read & Write permission for that bucket. The existing
   `CLOUDFLARE_ACCOUNT_ID` supplies the account.

The workflow uses the matching FFObjectPacks release tag and validates format and
revision. Fixed builds reuse the non-fixed assets with their own table data.
It uploads new assets before deploying Pages, retains assets for older deployments,
and skips objects already present. `npm run upload:objects` runs publication alone.

For local iteration after generating wiki data, with extracted Format 4 packs:

```bash
FFWIKI_RELEASE=release-41 \
FFWIKI_OBJECT_PACKS=/tmp/ff-format4/packs \
FFWIKI_BUILDS=beta-20100104,beta-20111013,retrobution npm run build:previews
npm run dev
```

Local overrides use `/objects` and do not enforce release revision matching.
The development server serves `.cache/objects/pool` without copying assets into
Pages. Regenerate data before starting the server. Preview coverage is recorded
in `site/public/data/<build>/previews/coverage.json`.
Next: vehicles, outfit picker, areas, coverage fixes, then production rollout.

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
