import sharp from 'sharp';
import { posix } from 'node:path';
import { Pack, type Resources } from './pack.js';
import { AssetPool } from './pool.js';
import { terrainGeometry, type TerrainData } from './terrain.js';
import { grassLayers } from './grass.js';
import { skinAttributes, storedBind } from './scene-skin.js';
import { Matrix4 } from 'three';
import type { SampledDocument, FloatCurve } from './scene-clips.js';

type Entry<T> = [string | { name: string }, T];
interface SavedProperties {
  m_Colors?: Entry<Record<string, number>>[];
  m_Floats?: Entry<number>[];
  m_TexEnvs?: Entry<{ m_Texture?: { r: number | null }; m_Scale: { x: number; y: number }; m_Offset: { x: number; y: number } }>[];
}
interface GeometryDocument {
  buffers: { uri: string; byteLength: number }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; target?: number; byteStride?: number }[];
  accessors: { bufferView: number; [field: string]: unknown }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number; material?: number }[] }[];
}
export interface SceneNode {
  name: string;
  translation: number[];
  rotation: number[];
  scale: number[];
  children?: number[];
  mesh?: number;
  skin?: number;
  extras?: Record<string, unknown>;
}
const keyOf = (entry: string | { name: string }): string => typeof entry === 'string' ? entry : entry.name;

export class SceneDocument {
  readonly nodes: SceneNode[] = [];
  readonly roots: number[] = [];
  readonly missing = new Set<string>();
  readonly settings: Record<string, unknown> = {};
  readonly extras: Record<string, unknown> = {};
  readonly stats = { skins: 0, clips: 0, platforms: 0, effects: 0, grass: 0, particles: 0 };
  private buffers: GeometryDocument['buffers'] = [];
  private views: GeometryDocument['bufferViews'] = [];
  private accessors: GeometryDocument['accessors'] = [];
  private meshes: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material: number; mode?: number }[] }[] = [];
  private materials: Record<string, unknown>[] = [];
  private images: Record<string, unknown>[] = [];
  private textures: Record<string, unknown>[] = [];
  private samplers: Record<string, unknown>[] = [];
  private textureIds = new Map<string, number>();
  private materialIds = new Map<number, number>();
  private geometryIds = new Map<string, number>();
  private skins: { joints: number[]; inverseBindMatrices: number }[] = [];
  private animations: Record<string, unknown>[] = [];
  private materialClips: Record<string, unknown>[] = [];
  private automatic: Record<string, unknown>[] = [];

  constructor(private pack: Pack, private pool: AssetPool, private materialSource: Resources, private pngs: Map<string, Promise<string>>) {}

  animation(file: string, nodes: Map<number, number>, duration: number, name: string, renderers = new Map<number, number[]>()): void {
    const bytes = this.pack.read(file), length = bytes.readUInt32LE(12);
    const source = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as SampledDocument;
    const buffers = (source.buffers ?? []).map((buffer) => {
      const path = buffer.uri ? posix.normalize(posix.join(posix.dirname(file), buffer.uri)) : this.pool.store('models/buffers', bytes.subarray(28 + length, 28 + length + bytes.readUInt32LE(20 + length)), 'bin');
      if (buffer.uri) this.pool.add(this.pack, path);
      return this.buffers.push({ uri: posix.relative('areas/tiles', path), byteLength: buffer.byteLength }) - 1;
    });
    const views = (source.bufferViews ?? []).map((view) => this.views.push({ ...view, buffer: buffers[view.buffer] }) - 1);
    const accessors = (source.accessors ?? []).map((accessor) => this.accessors.push({ ...accessor, bufferView: views[accessor.bufferView] }) - 1);
    const curves = (input: Record<string, FloatCurve> = {}): Record<string, FloatCurve> => {
      const result: Record<string, FloatCurve> = {};
      for (const [key, curve] of Object.entries(input)) {
        const source = curve.renderer_nodes?.length ? curve.renderer_nodes : curve.node === undefined ? [] : [curve.node];
        const targets = [...new Set(source.flatMap((target) => renderers.get(target) ?? (nodes.has(target) ? [nodes.get(target)!] : [])))];
        if (!targets.length) { this.missing.add(`Unresolved material track: ${name}:${key}`); continue; }
        result[key] = { ...curve, node: targets[0], renderer_nodes: targets, input: curve.input === undefined ? undefined : accessors[curve.input], output: curve.output === undefined ? undefined : accessors[curve.output] };
      }
      return result;
    };
    const record: Record<string, unknown> = { duration, name };
    if (source.animations?.length) {
      const animation = source.animations[0];
      const channels = animation.channels.flatMap((channel) => {
        const node = nodes.get(channel.target.node);
        if (node === undefined) { this.missing.add(`Unresolved transform track: ${name}:${channel.target.node}`); return []; }
        return [{ ...channel, target: { ...channel.target, node } }];
      });
      if (channels.length) record.animation = this.animations.push({ name, channels, samplers: animation.samplers.map((s) => ({ ...s, input: accessors[s.input], output: accessors[s.output] })), extras: { duration, float_curves: curves(animation.extras?.float_curves) } }) - 1;
      else record.material_clip = this.materialClips.push({ duration, float_curves: curves(animation.extras?.float_curves) }) - 1;
    } else record.material_clip = this.materialClips.push({ duration, float_curves: curves(source.extras?.material_clips?.[0]?.float_curves) }) - 1;
    this.automatic.push(record);
    this.stats.clips++;
  }

  private accessor(values: Float32Array | Uint16Array, components: number): number {
    const file = this.pool.store('models/buffers', Buffer.from(values.buffer, values.byteOffset, values.byteLength), 'bin');
    const buffer = this.buffers.push({ uri: posix.relative('areas/tiles', file), byteLength: values.byteLength }) - 1;
    const bufferView = this.views.push({ buffer, byteLength: values.byteLength }) - 1;
    return this.accessors.push({ bufferView, componentType: values instanceof Uint16Array ? 5123 : 5126, type: components === 16 ? 'MAT4' : components === 1 ? 'SCALAR' : `VEC${components}`, count: values.length / components }) - 1;
  }

  async skin(id: number, materials: { r: number | null }[], owner: number, joints: number[], worlds: Matrix4[]): Promise<{ mesh: number; skin: number } | undefined> {
    const base = await this.geometry(id, materials);
    if (base === undefined) return undefined;
    const source = this.pack.resources[id][2];
    const file = source.skin_data as string | undefined;
    if (!file) throw new Error(`Missing skin data for mesh ${id}`);
    const raw = this.pack.msgpack<Parameters<typeof skinAttributes>[0]>(file);
    const weights = skinAttributes(raw, source.vertices as number, joints.length);
    const js = this.accessor(weights.joints, 4), ws = this.accessor(weights.weights, 4);
    const matrices = new Float32Array(joints.length * 16);
    for (const [i, joint] of joints.entries()) {
      let matrix = storedBind(raw, joints.length, i);
      if (!matrix) {
        if (Math.abs(worlds[joint].determinant()) < 1e-12) throw new Error(`Singular joint transform: ${joint}`);
        matrix = worlds[joint].clone().invert().multiply(worlds[owner]);
      }
      matrices.set(matrix.elements, i * 16);
    }
    const skin = this.skins.push({ joints, inverseBindMatrices: this.accessor(matrices, 16) }) - 1;
    const mesh = this.meshes.push({ primitives: this.meshes[base].primitives.map((p) => ({ ...p, attributes: { ...p.attributes, JOINTS_0: js, WEIGHTS_0: ws } })) }) - 1;
    this.stats.skins++;
    return { mesh, skin };
  }

  private async texture(id: number | null | undefined, png = false): Promise<number | null> {
    if (id == null) return null;
    const source = this.pack.resources[id]?.[2];
    if (!source?.file) { this.missing.add(`texture:${id}`); return null; }
    let file = source.file;
    if (png) {
      let converted = this.pngs.get(file);
      if (!converted) {
        converted = sharp(this.pack.read(file)).png().toBuffer().then((bytes) => this.pool.store('textures', bytes, 'png'));
        this.pngs.set(file, converted);
      }
      file = await converted;
    } else this.pool.add(this.pack, file);
    const key = `${file}/${source.settings?.m_WrapMode}/${source.settings?.m_FilterMode}`;
    const cached = this.textureIds.get(key);
    if (cached !== undefined) return cached;
    const index = this.textures.length;
    const wrap = source.settings?.m_WrapMode === 1 ? 33071 : 10497;
    const nearest = source.settings?.m_FilterMode === 0;
    this.samplers.push({ wrapS: wrap, wrapT: wrap, magFilter: nearest ? 9728 : 9729, minFilter: nearest ? 9728 : 9987 });
    this.images.push({ uri: posix.relative('areas/tiles', file), mimeType: png ? 'image/png' : 'image/webp' });
    this.textures.push(png ? { sampler: index, source: index } : { sampler: index, extensions: { EXT_texture_webp: { source: index } } });
    this.textureIds.set(key, index);
    return index;
  }

  async material(id: number | null | undefined): Promise<number> {
    if (id != null && this.materialIds.has(id)) return this.materialIds.get(id)!;
    const raw = id == null ? undefined : this.materialSource[id]?.[2];
    const shaderId = (raw?.m_Shader as { r: number | null } | undefined)?.r;
    const shader = shaderId == null ? undefined : this.pack.resources[shaderId]?.[2];
    const saved = (raw?.m_SavedProperties ?? {}) as SavedProperties;
    const defaults = (shader?.default_properties ?? {}) as SavedProperties;
    const colors: Record<string, number[]> = {};
    const floats: Record<string, number> = {};
    const textures: Record<string, unknown> = {};
    const pbr: Record<string, unknown> = { metallicFactor: 0, roughnessFactor: 1 };
    for (const [key, value] of [...defaults.m_Colors ?? [], ...saved.m_Colors ?? []]) colors[keyOf(key)] = ['r', 'g', 'b', 'a'].map((channel) => value[channel]);
    for (const [key, value] of [...defaults.m_Floats ?? [], ...saved.m_Floats ?? []]) floats[keyOf(key)] = value;
    for (const [key, value] of [...defaults.m_TexEnvs ?? [], ...saved.m_TexEnvs ?? []]) {
      const name = keyOf(key), textureId = value.m_Texture?.r, index = await this.texture(textureId);
      textures[name] = { texture: textureId == null ? null : this.pack.resources[textureId]?.[2].name, object: textureId, scale: [value.m_Scale?.x ?? 1, value.m_Scale?.y ?? 1], offset: [value.m_Offset?.x ?? 0, value.m_Offset?.y ?? 0], ...(index == null ? {} : { index }) };
      if (name === '_MainTex' && index != null) pbr.baseColorTexture = { index };
    }
    if (colors._Color) pbr.baseColorFactor = colors._Color;
    const shaderName = /^Shader #/.test(shader?.name ?? '') && typeof shader?.declared_name === 'string' && shader.declared_name ? shader.declared_name : shader?.name ?? '';
    const material: Record<string, unknown> = {
      name: raw?.m_Name ?? 'default', pbrMetallicRoughness: pbr,
      extras: { object: id, shader: shaderName, colors, floats, textures },
      doubleSided: shaderName.toLowerCase().includes('culloff'),
    };
    if (/test|cutout/i.test(shaderName)) { material.alphaMode = 'MASK'; material.alphaCutoff = floats._Cutoff ?? 0.5; }
    else if (/blend/i.test(shaderName)) material.alphaMode = 'BLEND';
    const index = this.materials.push(material) - 1;
    if (id != null) this.materialIds.set(id, index);
    return index;
  }

  async geometry(id: number, materials: { r: number | null }[]): Promise<number | undefined> {
    const source = this.pack.resources[id]?.[2];
    if (!source?.file) { this.missing.add(`mesh:${id}`); return undefined; }
    if (source.source_empty) return undefined;
    const key = `${id}/${materials.map((m) => m.r).join(',')}`;
    if (this.geometryIds.has(key)) return this.geometryIds.get(key);
    const bytes = this.pack.read(source.file);
    const geometry = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as GeometryDocument;
    const bufferBase = this.buffers.length, viewBase = this.views.length, accessorBase = this.accessors.length;
    for (const buffer of geometry.buffers) {
      const file = posix.normalize(posix.join(posix.dirname(source.file), buffer.uri));
      this.pool.add(this.pack, file);
      this.buffers.push({ ...buffer, uri: posix.relative('areas/tiles', file) });
    }
    this.views.push(...geometry.bufferViews.map((view) => ({ ...view, buffer: bufferBase + view.buffer })));
    this.accessors.push(...geometry.accessors.map((accessor) => ({ ...accessor, bufferView: viewBase + accessor.bufferView })));
    const primitives: SceneDocument['meshes'][number]['primitives'] = [];
    for (const [i, primitive] of geometry.meshes[0].primitives.entries()) {
      primitives.push({
        ...primitive,
        attributes: Object.fromEntries(Object.entries(primitive.attributes).map(([name, index]) => [name, accessorBase + index])),
        indices: primitive.indices === undefined ? undefined : accessorBase + primitive.indices,
        material: await this.material(materials[Math.min(primitive.material ?? i, materials.length - 1)]?.r),
      });
    }
    const index = this.meshes.push({ name: source.name, primitives }) - 1;
    this.geometryIds.set(key, index);
    return index;
  }

  async terrain(id: number, grass = true): Promise<number | undefined> {
    const source = this.pack.resources[id]?.[2];
    if (!source) { this.missing.add(`terrain:${id}`); return undefined; }
    const terrain = source as unknown as TerrainData;
    const data = terrainGeometry(this.pack, terrain);
    const attributes: Record<string, number> = {};
    for (const [name, values, components] of [['POSITION', data.positions, 3], ['NORMAL', data.normals, 3], ['TEXCOORD_0', data.uvs, 2], ['indices', data.indices, 1]] as const) {
      const file = this.pool.store('areas/terrain', Buffer.from(values.buffer), 'bin');
      const buffer = this.buffers.push({ uri: posix.relative('areas/tiles', file), byteLength: values.byteLength }) - 1;
      const view = this.views.push({ buffer, byteLength: values.byteLength, target: name === 'indices' ? 34963 : 34962 }) - 1;
      const accessor: GeometryDocument['accessors'][number] = { bufferView: view, componentType: name === 'indices' ? 5125 : 5126, count: values.length / components, type: components === 1 ? 'SCALAR' : `VEC${components}` };
      if (name === 'POSITION') {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < data.positions.length; i++) { min[i % 3] = Math.min(min[i % 3], data.positions[i]); max[i % 3] = Math.max(max[i % 3], data.positions[i]); }
        accessor.min = min;
        accessor.max = max;
      }
      attributes[name] = this.accessors.push(accessor) - 1;
    }
    const splats = await Promise.all(terrain.m_SplatDatabase.m_Splats.map(async (s) => ({ texture: await this.texture(s.texture.r, true), tile_size: [s.tileSize.x, s.tileSize.y], tile_offset: [s.tileOffset?.x ?? 0, s.tileOffset?.y ?? 0] })));
    const controls = await Promise.all(terrain.m_SplatDatabase.m_AlphaTextures.map((p) => this.texture(p.r, true)));
    if (!controls.length) {
      const png = await sharp(Buffer.from([255, 0, 0, 0]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
      const file = this.pool.store('textures', png, 'png');
      const index = this.textures.length;
      this.images.push({ uri: posix.relative('areas/tiles', file), mimeType: 'image/png' });
      this.samplers.push({ wrapS: 33071, wrapT: 33071, magFilter: 9729, minFilter: 9729 });
      this.textures.push({ sampler: index, source: index });
      controls.push(index);
    }
    const lightmap = await this.texture(terrain.m_Lightmap?.r);
    const details = grass ? await this.details(terrain) : undefined;
    const material = this.materials.push({ name: terrain.m_Name, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 }, extras: { terrain: { splats, controls, lightmap, details } } }) - 1;
    const { indices, ...meshAttributes } = attributes;
    return this.meshes.push({ primitives: [{ attributes: meshAttributes, indices, material }] }) - 1;
  }

  private async details(terrain: TerrainData): Promise<Record<string, unknown> | undefined> {
    const db = terrain.m_DetailDatabase;
    if (!db?.m_DetailPrototypes.length) return undefined;
    const layers = grassLayers(this.pack, db), resolution = db.m_PatchCount * db.m_PatchSamples;
    const prototypes: Record<string, unknown>[] = [];
    const color = (value: Record<string, number>): number[] => ['r', 'g', 'b', 'a'].map((k) => value[k]);
    for (const [index, p] of db.m_DetailPrototypes.entries()) {
      const layer = layers.get(index);
      if (!layer) continue;
      if (p.usePrototypeMesh) { this.missing.add('Mesh grass prototype: ' + index); continue; }
      const png = await sharp(layer, { raw: { width: resolution, height: resolution, channels: 1 } }).flip().png().toBuffer();
      const file = this.pool.store('textures', png, 'png'), texture = this.textures.length;
      this.images.push({ uri: posix.relative('areas/tiles', file), mimeType: 'image/png' });
      this.samplers.push({ wrapS: 33071, wrapT: 33071, magFilter: 9728, minFilter: 9728 });
      this.textures.push({ sampler: texture, source: texture });
      prototypes.push({ density: texture, texture: await this.texture(p.prototypeTexture?.r), use_mesh: false, min_width: p.minWidth, max_width: p.maxWidth, min_height: p.minHeight, max_height: p.maxHeight, noise_spread: p.noiseSpread, bend_factor: p.bendFactor, healthy_color: color(p.healthyColor), dry_color: color(p.dryColor), lightmap_factor: p.lightmapFactor ?? 1 });
      this.stats.grass += layer.reduce((a, b) => a + b, 0);
    }
    return { resolution, prototypes, waving_grass: { tint: color((db.m_WavingGrassTint ?? db.WavingGrassTint)!), strength: db.m_WavingGrassStrength, amount: db.m_WavingGrassAmount, speed: db.m_WavingGrassSpeed } };
  }

  save(): string {
    const document = { asset: { version: '2.0', generator: 'FFWiki area adapter' }, scene: 0, scenes: [{ nodes: this.roots, extras: this.settings }], nodes: this.nodes, meshes: this.meshes, materials: this.materials, buffers: this.buffers, bufferViews: this.views, accessors: this.accessors, textures: this.textures, images: this.images, samplers: this.samplers };
    Object.assign(document, { extensionsUsed: ['EXT_texture_webp'], extensionsRequired: ['EXT_texture_webp'] });
    const { particles, ...baselineStats } = this.stats;
    Object.assign(document, { skins: this.skins, ...(this.animations.length ? { animations: this.animations } : {}), extras: { ...this.extras, material_clips: this.materialClips, automatic_clips: this.automatic, stats: particles ? this.stats : baselineStats } });
    const json = Buffer.from(JSON.stringify(document));
    const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
    json.copy(padded);
    const header = Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length, 8);
    header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    return this.pool.store('areas/tiles', Buffer.concat([header, padded]), 'glb');
  }
}
