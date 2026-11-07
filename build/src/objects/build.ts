import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import type { ModelPreview, PreviewMeta, PreviewType } from '../../../shared/objects.js';
import { chunkOf, writeChunks } from '../chunk.js';
import { downloadAll, downloadOne, fetchRelease, type DownloadedAsset, type Release } from '../download.js';
import { slugForZip } from '../manifest.js';
import { CACHE_DIR, DATA_OUT, FFINFO_CACHE } from '../paths.js';
import { log } from '../log.js';
import { Pack } from './pack.js';
import { AssetPool } from './pool.js';
import { ITEM_SLOTS, Recipes, type Xdt } from './recipes.js';
import { animationChoices } from '../../../shared/animations.js';

export const OBJECTS_CACHE = join(CACHE_DIR, 'objects');
export const POOL_DIR = join(OBJECTS_CACHE, 'pool');
export const UPLOAD_INDEX = join(OBJECTS_CACHE, 'upload.json');

function keyOf(type: PreviewType, row: ModelPreview): number {
  if (type === 'item-sets') return 0;
  if (type === 'items') {
    const [kind, id] = String(row.id).split('-').map(Number);
    return chunkOf(kind * 10000 + id);
  }
  return chunkOf(Number(row.id));
}

function setRecipes(slug: string, items: ModelPreview[]): ModelPreview[] {
  const path = join(DATA_OUT, slug, 'item-sets', '0.json');
  if (!existsSync(path)) return [];
  const sets = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { id: string; items: { id: string }[] }>;
  const byId = new Map(items.map((row) => [row.id, row]));
  const result: ModelPreview[] = [];
  for (const set of Object.values(sets)) {
    const slots = set.items.map((item) => ITEM_SLOTS[Number(item.id.split('-')[0])]);
    // Collections with alternatives in one slot need an outfit picker. Keep
    // this first slice to sets that describe a single wearable combination.
    if (slots.some((slot) => !slot) || new Set(slots).size !== slots.length) continue;
    const variants = (['m', 'f'] as const).flatMap((gender) => {
      const worn = set.items.map((item) => byId.get(item.id)?.variants.find((v) => v.gender === gender));
      if (worn.some((v) => !v) || !worn.length) return [];
      const hat = slots.indexOf('hat');
      const base = worn[hat >= 0 ? hat : 0]!;
      const parts = new Map(base.parts!.map((part) => [part.slot!, part]));
      for (let i = 0; i < worn.length; i++) {
        if (base.hiddenSlots?.includes(slots[i])) continue;
        const part = worn[i]!.parts!.find((part) => part.slot === slots[i]);
        if (!part) return [];
        parts.set(slots[i], part);
      }
      const weapon = slots.indexOf('weapon');
      return [{ ...base, animationContext: weapon >= 0 ? worn[weapon]!.animationContext : base.animationContext, parts: [...parts.values()] }];
    });
    if (variants.length) result.push({ id: set.id, variants });
  }
  return result;
}

export async function buildPreviews(release: Release, downloaded: DownloadedAsset[]): Promise<void> {
  const local = process.env.FFWIKI_OBJECT_PACKS;
  const baseUrl = process.env.FFWIKI_OBJECTS_URL?.replace(/\/$/, '') ?? (local ? '/objects' : '');
  if (!baseUrl) return;
  if (!/^https:\/\//.test(baseUrl) && baseUrl !== '/objects') throw new Error('FFWIKI_OBJECTS_URL must be HTTPS or /objects for local previews');

  const selected = process.env.FFWIKI_BUILDS?.split(',').map((s) => s.trim()).filter(Boolean);
  const objects = local ? undefined : await fetchRelease('FFObjectPacks', release.tagName);
  const packDirectory = join(OBJECTS_CACHE, release.tagName);
  mkdirSync(packDirectory, { recursive: true });
  const pool = new AssetPool(POOL_DIR);
  const completed = new Set<string>();
  const groups = new Map<string, DownloadedAsset[]>();
  for (const info of downloaded) {
    const slug = slugForZip(info.asset.name);
    if (selected && !selected.includes(slug)) continue;
    const source = slug.replace(/-fixed$/, '');
    groups.set(source, [...groups.get(source) ?? [], info]);
  }

  for (const [source, builds] of groups) {
    const canonical = downloaded.find((d) => slugForZip(d.asset.name) === source);
    let location: string;
    if (local) {
      location = join(resolve(local), source);
      if (!existsSync(location)) { log.warn(`${source}: no local object pack; skipped`); continue; }
    } else {
      const asset = objects!.assets.find((a) => slugForZip(a.name) === source);
      if (!asset) throw new Error(`${release.tagName}: missing object pack for ${source}`);
      location = (await downloadOne(asset, packDirectory)).path;
    }

    const pack = new Pack(location);
    const revision = Number(/_r(\d+)/.exec(canonical?.asset.name ?? builds[0].asset.name)?.[1]);
    if (pack.manifest.build !== source || (!local && pack.manifest.revision !== revision)) {
      throw new Error(`${source}: ObjectPacks build/revision does not match FFInfoPacks`);
    }
    for (const info of builds) {
      const slug = slugForZip(info.asset.name);
      log.step(`${slug}: building 3D preview recipes`);
      const zip = new AdmZip(info.path);
      const xdtEntry = zip.getEntries().find((e) => /(^|\/)xdt.json$/.test(e.entryName));
      if (!xdtEntry) throw new Error(`${slug}: missing xdt.json`);
      const recipes = new Recipes(pack, JSON.parse(xdtEntry.getData().toString('utf8')) as Xdt);
      const entities = recipes.entities();
      entities['item-sets'] = setRecipes(slug, entities.items);
      const directory = join(DATA_OUT, slug, 'previews');
      rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory, { recursive: true });
      const types: PreviewType[] = [];
      for (const type of Object.keys(entities) as PreviewType[]) {
        const index = JSON.parse(readFileSync(join(DATA_OUT, slug, 'index', `${type}.json`), 'utf8')) as { id: number | string; members?: { id: number }[] }[];
        const ids = new Set(index.flatMap((row) => [String(row.id), ...row.members?.map((member) => String(member.id)) ?? []]));
        entities[type] = entities[type].filter((row) => ids.has(String(row.id)));
        if (!entities[type].length) continue;
        for (const recipe of entities[type]) for (const variant of recipe.variants) {
          const context = variant.animationContext ?? { kind: variant.gender ? 'avatar' : 'creature' };
          variant.animations = animationChoices(pack.animationClips(variant.model.model), context);
          for (const part of [variant.model, ...variant.parts ?? []]) {
            pool.add(pack, part.model);
            if (part === variant.model) {
              const names = variant.animations.map((clip) => clip.name);
              if (variant.height !== undefined) names.push('height', 'height_Add');
              if (variant.shape !== undefined) names.push('shape', 'shape_Add');
              pool.stageAnimations(pack, part.model, names);
            } else if (part.mode === 'attached') {
              const clips = pack.animationClips(part.model).filter((clip) => clip.duration > 0);
              part.autoAnimation = clips.find((clip) => clip.name === 'nif-default')?.name ?? clips.map((clip) => clip.name).sort()[0] ?? null;
              if (part.autoAnimation) pool.stageAnimations(pack, part.model, [part.autoAnimation]);
            }
            if (part.primary) pool.add(pack, part.primary);
            if (part.secondary) pool.add(pack, part.secondary);
          }
        }
        types.push(type);
        await writeChunks(slug, `previews/${type}`, entities[type], (row) => ({ url: row.id, chunk: keyOf(type, row) }));
      }
      const meta: PreviewMeta = { baseUrl: `${baseUrl}/v4`, types, release: release.tagName, format: 4 };
      writeFileSync(join(directory, 'meta.json'), JSON.stringify(meta));
      writeFileSync(join(directory, 'coverage.json'), JSON.stringify({ counts: Object.fromEntries(types.map((type) => [type, entities[type].length])), unresolved: [...recipes.missing].sort() }));
      completed.add(slug);
      log.done(`${slug}: ${types.map((t) => `${t}=${entities[t].length}`).join(' ')}; unresolved aliases=${recipes.missing.size}`);
    }
    // Keep only one ObjectPacks ZIP on the runner at a time. Fixed variants
    // share the loaded pack but derive recipes from their own table data.
    if (!local) rmSync(location);
  }

  pool.save(UPLOAD_INDEX);
  const bytes = [...pool.entries.values()].reduce((sum, row) => sum + row.bytes, 0);
  log.done(`3D assets: ${pool.entries.size.toLocaleString()} unique files, ${(bytes / 1e9).toFixed(3)} GB, ${completed.size} builds`);
}

async function main(): Promise<void> {
  if (process.env.FFWIKI_OBJECT_PACKS && process.env.FFWIKI_RELEASE) {
    const directory = join(FFINFO_CACHE, process.env.FFWIKI_RELEASE);
    const downloaded = readdirSync(directory).filter((name) => name.endsWith('.zip')).map((name) => ({
      asset: { name, size: statSync(join(directory, name)).size, url: '' }, path: join(directory, name),
    }));
    await buildPreviews({ tagName: process.env.FFWIKI_RELEASE, name: '', assets: downloaded.map((d) => d.asset) }, downloaded);
  } else {
    const release = await fetchRelease();
    await buildPreviews(release, await downloadAll(release));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
