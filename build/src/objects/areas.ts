import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AreaPreviewRecipe } from '../../../shared/objects.js';
import { DATA_OUT } from '../paths.js';
import { log } from '../log.js';
import { Pack, type Resources } from './pack.js';
import { AssetPool } from './pool.js';
import { SceneDocument } from './scene-document.js';
import { SceneClips } from './scene-clips.js';
import { Matrix4, Quaternion, Vector3 } from 'three';

interface SceneEntry { file: string; asset: { source: string } }
interface Area { id: string; x: number; y: number; width: number; height: number }
interface Pointer { r: number | null }
interface SceneGraph {
  names: string[];
  nodes: Uint8Array;
  node_stride: number;
  renderers: [number, number, number, number | null, { m_Enabled?: boolean; m_Materials?: Pointer[]; m_TerrainData?: Pointer; m_Bones?: Pointer[] }][];
  animations: number[];
  settings: [number, number, Record<string, unknown>][];
}
interface Tile { file: string; missing: string[]; stats: SceneDocument['stats'] }

export class AreaCompiler {
  private scenes = new Map<string, SceneEntry>();
  private tiles = new Map<string, Promise<Tile>>();
  private pngs = new Map<string, Promise<string>>();
  private materials: Resources;
  private clips: SceneClips;

  constructor(private pack: Pack, private pool: AssetPool) {
    for (const scene of pack.json<{ scenes: SceneEntry[] }>('areas/index.json').scenes) {
      const match = /Map_(\d+)_(\d+)\.unity3d$/i.exec(scene.asset.source);
      if (match) this.scenes.set(`${Number(match[1])}_${Number(match[2])}`, scene);
    }
    this.materials = pack.msgpack('metadata/materials.msgpack');
    this.clips = new SceneClips(pack);
  }

  async build(slug: string): Promise<number> {
    const areas = Object.values(JSON.parse(readFileSync(join(DATA_OUT, slug, 'areas', '0.json'), 'utf8')) as Record<string, Area>);
    const output: Record<string, AreaPreviewRecipe> = {};
    const diagnostics: Record<string, string[]> = {};
    const stats: Record<string, SceneDocument['stats']> = {};
    let lastLog = Date.now();
    for (const [index, area] of areas.entries()) {
      if (!(area.width > 0 && area.height > 0)) continue;
      const tiles: string[] = [], missing: string[] = [];
      for (let x = Math.floor(area.x / 51200); x < Math.ceil((area.x + area.width) / 51200); x++) {
        for (let y = Math.floor(area.y / 51200); y < Math.ceil((area.y + area.height) / 51200); y++) {
          const key = `${x}_${y}`, scene = this.scenes.get(key);
          if (!scene) { missing.push(key); continue; }
          let tile = this.tiles.get(key);
          if (!tile) { tile = this.compile(scene); this.tiles.set(key, tile); }
          const compiled = await tile;
          tiles.push(compiled.file);
          if (compiled.missing.length) diagnostics[key] = compiled.missing;
          stats[key] = compiled.stats;
        }
      }
      if (tiles.length) output[area.id] = { id: area.id, bounds: [-(area.x + area.width) / 100, area.y / 100, -area.x / 100, (area.y + area.height) / 100], tiles, missing };
      else diagnostics[area.id] = ['No available map tiles'];
      if (Date.now() - lastLog > 5000) { log.info(`${slug}: area previews ${index + 1}/${areas.length}`); lastLog = Date.now(); }
    }
    const directory = join(DATA_OUT, slug, 'previews', 'areas');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, '0.json'), JSON.stringify(output));
    writeFileSync(join(directory, 'coverage.json'), JSON.stringify({ areas: Object.keys(output).length, tiles: this.tiles.size, stats, diagnostics }));
    return Object.keys(output).length;
  }

  private async compile(scene: SceneEntry): Promise<Tile> {
    const graph = this.pack.msgpack<SceneGraph>(scene.file);
    if (graph.node_stride !== 60) throw new Error(`Unexpected scene node stride: ${scene.file}`);
    const raw = Buffer.from(graph.nodes);
    const document = new SceneDocument(this.pack, this.pool, this.materials, this.pngs);
    const transforms = new Map<number, number>();
    const objects = new Map<number, number>();
    const parents: number[] = [], enabled: boolean[] = [];
    for (let offset = 0; offset < raw.length; offset += 60) {
      const index = document.nodes.length;
      transforms.set(raw.readUInt32LE(offset), index);
      objects.set(raw.readUInt32LE(offset + 8), index);
      parents.push(raw.readInt32LE(offset + 4));
      enabled.push(!!(raw.readUInt32LE(offset + 56) & 1));
      const vector = (start: number, count: number): number[] => Array.from({ length: count }, (_, i) => raw.readFloatLE(offset + start + i * 4));
      const position = vector(16, 3), rotation = new Quaternion().fromArray(vector(28, 4)).normalize().toArray();
      position[0] *= -1; rotation[1] *= -1; rotation[2] *= -1;
      document.nodes.push({ name: graph.names[raw.readUInt32LE(offset + 12)], translation: position, rotation, scale: vector(44, 3) });
    }
    for (const [index, parent] of parents.entries()) {
      if (parent < 0) document.roots.push(index);
      else (document.nodes[parent].children ??= []).push(index);
    }
    const active = (index: number): boolean => enabled[index] && (parents[index] < 0 || active(parents[index]));
    const worlds: Matrix4[] = [];
    const world = (index: number): Matrix4 => {
      if (worlds[index]) return worlds[index];
      const node = document.nodes[index];
      const local = new Matrix4().compose(new Vector3().fromArray(node.translation), new Quaternion().fromArray(node.rotation).normalize(), new Vector3().fromArray(node.scale));
      return worlds[index] = parents[index] < 0 ? local : world(parents[index]).clone().multiply(local);
    };
    document.nodes.forEach((_, index) => world(index));
    const renderers = new Map<number, number[]>();
    for (const [renderer, kind, transform, mesh, attributes] of graph.renderers) {
      const index = transforms.get(transform);
      if (index === undefined || !active(index) || attributes.m_Enabled === false) continue;
      if (kind === 23 && mesh != null) document.nodes[index].mesh = await document.geometry(mesh, attributes.m_Materials ?? []);
      else if (kind === 154 && attributes.m_TerrainData?.r != null) document.nodes[index].mesh = await document.terrain(attributes.m_TerrainData.r);
      else if (kind === 137 && mesh != null) {
        try {
          const joints = (attributes.m_Bones ?? []).map((pointer) => pointer.r == null ? undefined : transforms.get(pointer.r));
          if (!joints.length || joints.some((joint) => joint === undefined)) throw new Error('Renderer bones are missing from scene');
          const result = await document.skin(mesh, attributes.m_Materials ?? [], index, joints as number[], worlds);
          if (result) {
            const node = document.nodes.push({ name: `renderer_${renderer}`, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], ...result, extras: { renderer, source_node: index } }) - 1;
            document.roots.push(node);
            const targets = renderers.get(index) ?? [];
            targets.push(node);
            renderers.set(index, targets);
          }
        } catch (error) { document.missing.add(`Skin ${renderer}: ${error instanceof Error ? error.message : error}`); }
      }
    }
    for (const [, kind, settings] of graph.settings) {
      const rgba = (key: string): number[] => {
        const value = settings[key] as Record<string, number> | undefined;
        return ['r', 'g', 'b', 'a'].map((channel) => value?.[channel] ?? 1);
      };
      if (kind === 104) document.settings.render_settings = { ambient: rgba('m_AmbientLight') };
      if (settings.world_type === 'DongColorSetup' || settings.fogColor && settings.skyColor) {
        document.settings.colors = { fog: rgba('fogColor'), sky: rgba('skyColor'), light: rgba('lightColor'), fog_depth: settings.fogDepth ?? 0 };
      }
    }
    const components = new Map<number, number>();
    for (const [id, , settings] of graph.settings) {
      const object = (settings.m_GameObject as Pointer | undefined)?.r;
      const node = object == null ? undefined : objects.get(object);
      if (node !== undefined) components.set(id, node);
    }
    for (const [id, , settings] of graph.settings) {
      const node = components.get(id), type = settings.world_type;
      if (node === undefined || type !== 'Waypoint' && !active(node)) continue;
      if (type === 'EpPlatformTrigger' || type === 'Waypoint') {
        const fields = { ...settings };
        for (const name of ['head', 'tail', 'next', 'prev']) {
          const ref = (fields[name] as Pointer | undefined)?.r;
          fields[name] = ref == null || !components.has(ref) ? null : { node: components.get(ref) };
        }
        const extras = document.nodes[node].extras ??= {};
        const scripts = (extras.scripts ??= []) as unknown[];
        scripts.push({ script: type, enabled: settings.m_Enabled !== false, fields });
        if (type === 'EpPlatformTrigger' && settings.velocity) document.stats.platforms++;
      }
      if (type === 'EffectEmitterController' && settings.m_Enabled !== false) {
        const id = (settings.nifObject as Pointer | undefined)?.r;
        if (id != null) {
          const prefab = this.pack.prefab(id);
          if (prefab && Object.keys(prefab.renderers).length) {
            this.pool.add(this.pack, prefab.file);
            const animations = this.pack.automaticAnimations(prefab.file);
            this.pool.stageAnimations(this.pack, prefab.file, animations);
            ((document.extras.effects ??= []) as unknown[]).push({ node, model: prefab.file, animations });
            document.stats.effects++;
          } else document.missing.add(`Effect prefab has no renderer: ${id}`);
        }
        if ((settings.particles as unknown[] | undefined)?.length) document.missing.add('Particle emitters require ObjectPacks particle metadata');
      }
    }
    for (const id of graph.animations ?? []) {
      const binding = this.clips.bindings[id];
      const node = binding && transforms.get(binding.transform);
      if (node !== undefined && active(node)) await this.clips.add(document, id, transforms, renderers);
    }
    return { file: document.save(), missing: [...document.missing].sort(), stats: document.stats };
  }
}
