# openfusion-auto-wiki

Auto-generated wiki for the online game FusionFall. Reads ZIP assets from
[FFInfoPacks](https://github.com/FinnHornhoover/FFInfoPacks), normalizes every
build's missions / NPCs / items / monsters / areas / nanos, and emits a
static React+MDX site you can host anywhere.

## Local development

```bash
npm install
npm run build:data    # download FFInfoPacks ZIPs + normalize (cached)
npm run dev           # vite dev server on http://localhost:5173
```

`build:data` writes into `site/public/`. Re-runs reuse `.cache/` so cold downloads
only happen once.

Optional env vars:

| Var | Effect |
| --- | --- |
| `FFWIKI_RELEASE` | Pin a specific FFInfoPacks release tag (default: `latest`) |
| `FFWIKI_BASE_URL` | Absolute base for sitemap.xml + robots.txt (default: `https://example.com` with a build-time warning) |
| `GITHUB_TOKEN` | Lifts the 60/hr unauthenticated GitHub API rate limit |

## Deployment (Cloudflare Pages)

A GitHub Actions workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
deploys to Cloudflare Pages on every push to `main`. To enable it:

1. **Create the Pages project.** In the Cloudflare dashboard, create a Pages
   project named `openfusion-auto-wiki` (or edit the workflow's `--project-name`
   if you prefer a different slug). Connect or skip Git integration — the
   workflow uses the Direct Upload path via `wrangler`.

2. **Add repository secrets** under *Settings → Secrets and variables → Actions*:
   - `CLOUDFLARE_API_TOKEN` — token with the *Cloudflare Pages: Edit* permission
   - `CLOUDFLARE_ACCOUNT_ID` — your account ID (shown on the Cloudflare dashboard)

3. **(Optional) Add a repository variable** for a custom domain:
   - `FFWIKI_BASE_URL` — e.g. `https://ffwiki.example.com`. When unset the
     workflow defaults to `https://openfusion-auto-wiki.pages.dev`, which the
     sitemap will reference.

4. **Push to `main`** to deploy. The workflow:
   - installs `npm` deps,
   - resolves the latest FFInfoPacks release tag via the GitHub API,
   - restores `.cache/ffinfo` and `.cache/iconmaps` keyed on that tag — so
     every new upstream release triggers a fresh cold download, but every
     re-run on the same release is warm,
   - runs `build:data` then `build:site`,
   - smoke-checks the dist (≤20K files, ≤25MB per file — Cloudflare's caps),
   - uploads `site/dist/` via `cloudflare/wrangler-action`.

The pipeline always targets the latest FFInfoPacks release. To pin a specific
release locally, set `FFWIKI_RELEASE=release-26` before running `npm run build:data`.

### Cloudflare Pages config files

Two static files in `site/public/` shape Pages' behavior:

- **`_redirects`** — SPA fallback: `/* /index.html 200`. Real files (JS, CSS,
  data, icons, minimap, sitemap) are served first; this only catches the
  React Router routes like `/<build>/missions/3`.
- **`_headers`** — per-path `Cache-Control`:
  - `/assets/*`, `/icons/*`, `/minimap/*` → `max-age=31536000, immutable`
  - `/data/*`, `/builds.json` → `max-age=300, stale-while-revalidate=86400`
  - `/sitemap.xml`, `/sitemaps/*`, `/robots.txt` → `max-age=3600`
  - `/`, `/index.html` → `max-age=0, must-revalidate`

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
