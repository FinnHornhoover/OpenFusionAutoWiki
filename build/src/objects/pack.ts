import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import AdmZip from 'adm-zip';
import { decode, decodeMulti } from '@msgpack/msgpack';

export interface Prefab {
  file: string;
  clips: { name: string; file: string; duration: number }[];
  renderers: Record<string, number[]>;
}

export interface Model {
  source_path: string;
  object: number;
  graph: string;
  rigs: number[];
  prefab?: Prefab;
}

interface Graph {
  file: string;
  asset: { source: string; name: string };
}

interface Texture {
  object: number;
  source_path: string;
  name: string;
  file?: string;
}

interface PrefabDocument {
  extras?: { clips?: Record<string, string> };
  nodes?: { extras?: { animation?: { enabled: boolean; play_automatically: boolean; default: number | null; clips: { file?: string }[] } } }[];
}

export interface Rig {
  script_type: string;
  data: {
    skins?: { r: number }[];
    skinColor?: { r: number; g: number; b: number; a: number };
    hairColor?: { r: number; g: number; b: number; a: number };
  };
}

export class Pack {
  private archive?: AdmZip;
  private prefix = '';
  private models = new Map<string, Model[]>();
  private prefabs = new Map<string, Prefab>();
  private clipCatalogs = new Map<string, { name: string; duration: number }[]>();
  private prefabDocuments = new Map<string, PrefabDocument>();
  private textures = new Map<string, Texture[]>();
  private graphs = new Map<string, Graph>();
  private textureSources = new Map<number, string>();
  private rigCache?: Record<string, Rig>;
  readonly manifest: { format_version: number; build: string; revision: number };

  constructor(private location: string) {
    if (statSync(location).isFile()) {
      this.archive = new AdmZip(location);
      const manifest = this.archive.getEntries().find((e) => /(^|\/)manifest.json$/.test(e.entryName));
      if (!manifest) throw new Error(`No manifest in ${location}`);
      this.prefix = manifest.entryName.slice(0, -'manifest.json'.length);
    }

    this.manifest = this.json('manifest.json');
    if (this.manifest.format_version !== 4) throw new Error(`Expected ObjectPacks format 4, got ${this.manifest.format_version}`);
    for (const graph of this.json<Graph[]>('metadata/graphs.json')) this.graphs.set(graph.file, graph);
    const categories = this.json<Record<string, string>>('models/index.json');
    for (const category of Object.keys(categories)) {
      for (const entry of this.json<{ source_path: string; file: string }[]>(categories[category])) {
        const model = this.json<Model>(entry.file);
        if (model.prefab) this.prefabs.set(model.prefab.file, model.prefab);
        const key = entry.source_path.toLowerCase();
        this.models.set(key, [...this.models.get(key) ?? [], model]);
      }
    }

    // Only decode the first value (assets), leaving the very large source-key
    // table untouched. Format 4 serializes { assets, keys } in this order.
    const sources = this.read('metadata/sources.msgpack');
    if (sources[0] !== 0x82) throw new Error('Unexpected source metadata layout');
    const fields = decodeMulti(sources.subarray(1));
    if (fields.next().value !== 'assets') throw new Error('Missing source asset list');
    const assets = fields.next().value as { source: string }[];
    const resources = this.msgpack<Record<string, [number, number, unknown]>>('metadata/resources.msgpack');
    for (const texture of this.json<Texture[]>('textures/index.json')) {
      if (!texture.file) continue;
      const asset = resources[texture.object]?.[1];
      if (asset !== undefined) this.textureSources.set(texture.object, assets[asset].source);
      for (const key of new Set([texture.source_path.toLowerCase(), `texture/${texture.name.toLowerCase()}.dds`])) {
        this.textures.set(key, [...this.textures.get(key) ?? [], texture]);
      }
    }
  }

  read(relative: string): Buffer {
    const clean = posix.normalize(relative);
    if (clean.startsWith('../') || posix.isAbsolute(clean)) throw new Error(`Invalid pack path: ${relative}`);
    if (this.archive) {
      const entry = this.archive.getEntry(this.prefix + clean);
      if (!entry) throw new Error(`Missing pack file: ${clean}`);
      return entry.getData();
    }
    return readFileSync(join(this.location, clean));
  }

  has(relative: string): boolean {
    return this.archive ? !!this.archive.getEntry(this.prefix + relative) : existsSync(join(this.location, relative));
  }

  json<T>(relative: string): T {
    return JSON.parse(this.read(relative).toString('utf8')) as T;
  }

  animationClips(file: string): { name: string; duration: number }[] {
    const cached = this.clipCatalogs.get(file);
    if (cached) return cached;
    const data = this.prefabDocument(file);
    const durations = new Map(this.prefabs.get(file)?.clips.map((clip) => [clip.file, clip.duration]) ?? []);
    // The GLB disambiguates clips with the same name on different bindings.
    // Match durations by file, preserving those exported aliases.
    const clips = Object.entries(data.extras?.clips ?? {}).map(([name, uri]) => ({
      name, duration: durations.get(posix.normalize(posix.join(posix.dirname(file), uri))) ?? 0,
    }));
    this.clipCatalogs.set(file, clips);
    return clips;
  }

  automaticAnimation(file: string): string | null {
    const data = this.prefabDocument(file);
    for (const node of data.nodes ?? []) {
      const animation = node.extras?.animation;
      if (!animation?.enabled || !animation.play_automatically || animation.default === null) continue;
      const uri = animation.clips[animation.default]?.file;
      if (!uri) continue;
      const key = Object.entries(data.extras?.clips ?? {}).find(([, value]) => value === uri)?.[0];
      if (key) return key;
    }
    return null;
  }

  private prefabDocument(file: string): PrefabDocument {
    let data = this.prefabDocuments.get(file);
    if (!data) {
      const bytes = this.read(file);
      data = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as PrefabDocument;
      this.prefabDocuments.set(file, data);
    }
    return data;
  }

  msgpack<T>(relative: string): T {
    return decode(this.read(relative)) as T;
  }

  model(paths: string[]): Model | undefined {
    for (const path of paths) {
      const models = this.models.get(path.toLowerCase())?.filter((m) => m.prefab);
      if (!models?.length) continue;
      return models.sort((a, b) => this.priority(this.graphs.get(a.graph)?.asset.source) - this.priority(this.graphs.get(b.graph)?.asset.source))[0];
    }
    return undefined;
  }

  texture(name: string): string | undefined {
    if (!name || name.toLowerCase() === 'null') return undefined;
    const stem = name.replace(/^texture\//i, '').replace(/\.dds$/i, '').toLowerCase();
    return this.textures.get(`texture/${stem}.dds`)?.sort((a, b) => this.priority(this.textureSources.get(a.object)) - this.priority(this.textureSources.get(b.object)))[0]?.file;
  }

  private priority(source = ''): number {
    // ResourceLocator checks global bundles before searching world tiles.
    const order = ['CharacterCreation', 'Effects', 'CharacterSelection', 'Tutorial', 'CharTexture', 'NpcTexture', 'FutureNano', 'Nano', 'Retro_shared', 'Retro_shared_part2', 'Freearea_shared'];
    const index = order.indexOf(source.replace(/\.resourceFile$/i, ''));
    if (index >= 0) return index;
    const tile = /DongResources_(\d+)_(\d+)/i.exec(source);
    return tile ? 1000 + Number(tile[1]) * 16 + Number(tile[2]) : 100;
  }

  get rigs(): Record<string, Rig> {
    return this.rigCache ??= this.msgpack('models/rigs.msgpack');
  }
}
