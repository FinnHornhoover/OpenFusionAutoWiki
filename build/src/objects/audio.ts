import type { AudioBank, AudioRegion, PreviewVariant, SoundEvent, WeaponShot } from '../../../shared/objects.js';
import type { Xdt } from './recipes.js';
import { Pack } from './pack.js';
import { AssetPool } from './pool.js';
import { Matrix4, Quaternion, Vector3 } from 'three';

interface Clip { asset: number; file?: string; supported: boolean }
interface RecordData {
  type: string; asset: number;
  data: { musicDatas?: Region[]; ambientDatas?: Region[]; EvSoundArray?: { Position: { x: number; y: number; z: number }; audio?: string }[] };
}
interface Region { points: { x: number; y: number }[]; bInstanceFlag: number; delay: number; audio?: string }

export class AudioCompiler {
  private bank: AudioBank = { sounds: {}, music: [], ambience: [], emitters: [] };
  private clips: Record<string, Clip> = {};
  private paths: Record<string, number[]> = {};
  private references: Record<string, { variants?: { path: string; objects: number[] }[] }> = {};
  private events: Record<string, SoundEvent[]> = {};
  readonly missing = new Set<string>();

  constructor(private pack: Pack, private pool: AssetPool) {
    if (!pack.has('audio/index.json')) return;
    const index = pack.json<Record<string, string>>('audio/index.json');
    ({ clips: this.clips, paths: this.paths } = pack.msgpack(index.clips));
    this.references = pack.msgpack(index.references);
    this.events = pack.msgpack(index.events);
    const world = pack.msgpack<Record<string, RecordData>>(index.world);
    const tables = Object.values(world).filter((row) => row.type === 'MusicDataStorage');
    const table = tables.find((row) => pack.assetSource(row.asset) === 'main.unity3d') ?? tables[0];
    const regions = (rows: Region[] = []): AudioRegion[] => rows.map((row) => ({
      points: row.points.map((point) => [-point.x, point.y]), instance: !!row.bInstanceFlag,
      delay: Math.max(0, row.delay), sound: row.audio ? this.sound(row.audio) : undefined,
    }));
    this.bank.music = regions(table?.data.musicDatas);
    this.bank.ambience = regions(table?.data.ambientDatas);
    for (const [id, row] of Object.entries(world)) {
      for (const [index, emitter] of (row.data.EvSoundArray ?? []).entries()) {
        const sound = emitter.audio && this.sound(emitter.audio);
        if (sound) this.bank.emitters.push({ id: `${id}/${index}`, sound, position: [-emitter.Position.x, emitter.Position.y, emitter.Position.z], volume: 1, pitch: 1, near: 30, far: 40 });
      }
    }
    this.sources(world);
  }

  private sources(world: Record<string, RecordData>): void {
    interface Source { m_GameObject?: { r: number }; m_audioClip?: { r: number }; m_Enabled?: boolean; m_PlayOnAwake?: boolean; Loop?: boolean; m_Volume?: number; m_Pitch?: number; MinDistance?: number; MaxDistance?: number }
    const sources = Object.entries(world).filter(([, row]) => { const data = row.data as Source; return row.type === 'AudioSource' && data.Loop && data.m_PlayOnAwake && data.m_Enabled !== false && data.m_audioClip?.r !== undefined; });
    if (!sources.length) return;
    const transforms = new Map<number, { matrix: Matrix4; parent?: number; scene: boolean }>();
    for (const entry of this.pack.json<{ file: string; asset: { scene: boolean } }[]>('metadata/graphs.json')) {
      const graph = this.pack.msgpack<{ nodes: Uint8Array; external_parents: [number, number][] }>(entry.file);
      const nodes = Buffer.from(graph.nodes), external = new Map(graph.external_parents);
      for (let offset = 0; offset < nodes.length; offset += 60) {
        const id = nodes.readUInt32LE(offset), parent = nodes.readInt32LE(offset + 4), go = nodes.readUInt32LE(offset + 8);
        const values = Array.from({ length: 10 }, (_, i) => nodes.readFloatLE(offset + 16 + i * 4));
        const matrix = new Matrix4().compose(new Vector3(...values.slice(0, 3)), new Quaternion(...values.slice(3, 7)), new Vector3(...values.slice(7, 10)));
        const record = { matrix, parent: parent >= 0 ? nodes.readUInt32LE(parent * 60) : external.get(id), scene: entry.asset.scene };
        transforms.set(id, record); if (go !== 0xffffffff) transforms.set(go, record);
      }
    }
    const matrix = (id: number, seen = new Set<number>()): Matrix4 | undefined => {
      const node = transforms.get(id); if (!node || seen.has(id)) return undefined;
      seen.add(id); const parent = node.parent === undefined ? undefined : matrix(node.parent, seen);
      return parent ? parent.multiply(node.matrix) : node.matrix.clone();
    };
    for (const [id, row] of sources) {
      const data = row.data as Source, clip = this.clips[data.m_audioClip!.r!], go = data.m_GameObject?.r;
      if (go === undefined || !transforms.get(go)?.scene || !clip?.supported || !clip.file?.endsWith('.ogg')) continue;
      const transform = matrix(go); if (!transform) continue;
      const point = new Vector3().setFromMatrixPosition(transform), key = `source/${id}`;
      this.bank.sounds[key] = [this.pool.add(this.pack, clip.file)];
      const far = Math.max(1, data.MaxDistance ?? 40);
      this.bank.emitters.push({ id: key, sound: key, position: [-point.x, point.y, point.z], volume: Math.max(0, data.m_Volume ?? 1), pitch: Math.max(0.1, data.m_Pitch ?? 1), near: Math.min(far, data.MinDistance ?? 30), far });
    }
  }

  sound(key: string): string | undefined {
    key = key.replace(/\\/g, '/').toLowerCase();
    if (this.bank.sounds[key]) return key;
    const variants = this.references[key]?.variants ?? [{ path: key, objects: this.paths[key] ?? [] }];
    const files = variants.flatMap((variant) => {
      const candidates = variant.objects.map((id) => this.clips[id]).filter((clip) => clip?.supported && clip.file?.endsWith('.ogg'));
      candidates.sort((a, b) => this.pack.priority(this.pack.assetSource(a.asset)) - this.pack.priority(this.pack.assetSource(b.asset)));
      return candidates[0]?.file ? [this.pool.add(this.pack, candidates[0].file)] : [];
    });
    if (!files.length) { this.missing.add(key); return undefined; }
    this.bank.sounds[key] = files;
    return key;
  }

  weapon(variant: PreviewVariant, row: Record<string, string | number>, xdt: Xdt): void {
    const table = xdt.m_pWeaponItemTable?.m_pItemSoundData ?? [];
    const valid = (name: string): boolean => !!name && !/null|\.\.\./i.test(name);
    const normal = (): NonNullable<WeaponShot['sounds']> => {
      const sound = table[Number(row.m_iSound1)];
      const first = String(sound?.m_pstrSoundString1 ?? '');
      return [70, 15, 15].flatMap((weight, index) => {
        let name = String(sound?.[`m_pstrSoundString${index + 1}`] ?? '');
        if (!valid(name)) name = first;
        const key = valid(name) ? this.sound(`sound/${name}`) : undefined;
        return key ? [{ key, weight }] : [];
      });
    };
    for (const shot of variant.weaponShots ?? []) {
      if (shot.impactSound) shot.impactSound = this.sound(shot.impactSound);
      if (shot.label !== 'Battery') { shot.sounds = normal(); continue; }
      // The client uses only the first entry for battery attacks. Preserve
      // explicit silence, but use the normal swing if a named clip is absent.
      const name = String(table[Number(row.m_iSound2)]?.m_pstrSoundString1 ?? '');
      if (!valid(name)) { shot.sounds = []; continue; }
      const key = this.sound(`sound/${name}`);
      shot.sounds = key ? [{ key, weight: 100 }] : normal();
    }
  }

  variant(variant: PreviewVariant): void {
    const names = [...variant.animations?.map((clip) => clip.name) ?? [], ...Object.values(variant.weaponAttack ?? {}).filter((name): name is string => !!name)];
    for (const part of [variant.model, ...variant.parts ?? []]) {
      for (const object of this.pack.animationObjects(part.model, part === variant.model ? names : part.autoAnimation ? [part.autoAnimation] : [])) {
        for (const event of this.events[object] ?? []) if (event.audio) this.sound(event.audio);
      }
    }
  }

  save(): string | undefined {
    if (!this.pack.has('audio/index.json')) return undefined;
    return this.pool.store('audio/banks', Buffer.from(JSON.stringify(this.bank)), 'json');
  }
}
