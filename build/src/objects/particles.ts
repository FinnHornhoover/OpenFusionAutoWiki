import type { BillboardParticleRecipe, NativeParticleEmitter, ParticleAnimator, ParticleBase, ParticleEffectSettings, ParticleEmitter, ParticleRecipe, ParticleRenderer, ParticleScriptKey, ParticleTrail } from '../../../shared/particles.js';
import type { Pack, Resources } from './pack.js';
import type { SceneDocument } from './scene-document.js';

interface Component { m_Enabled?: boolean; m_GameObject?: { r: number | null }; m_Materials?: { r: number | null }[] }
interface WorldRecord { type: string; data: Component }
interface Prototype {
  emitter?: ParticleEmitter; renderer?: ParticleRenderer & Component; animator?: ParticleAnimator;
  trail?: ParticleTrail; trailRenderer?: Component; native?: NativeParticleEmitter; meshEmitter?: boolean;
}
interface Effect extends ParticleEffectSettings {
  particles?: { particlePrefab?: { r: number | null }; scriptKeys: ParticleScriptKey[] }[];
}

export class ParticleCatalog {
  private prototypes = new Map<number, Prototype>();
  private renderers = new Map<number, number>();

  constructor(private pack: Pack, private materials: Resources = pack.msgpack('metadata/materials.msgpack')) {
    for (const [id, record] of Object.entries(pack.msgpack<Record<string, WorldRecord>>('areas/world.msgpack'))) {
      const go = record.data.m_GameObject?.r;
      if (go == null) continue;
      const prototype = this.prototypes.get(go) ?? {};
      if (record.type === 'ParticleEmitterController') prototype.emitter = record.data as unknown as ParticleEmitter;
      else if (record.type === 'ParticleRenderer') { prototype.renderer = record.data as unknown as ParticleRenderer & Component; this.renderers.set(Number(id), go); }
      else if (record.type === 'ParticleAnimator') prototype.animator = record.data as unknown as ParticleAnimator;
      else if (record.type === 'ParticleTrailController') prototype.trail = record.data as unknown as ParticleTrail;
      else if (record.type === 'TrailRenderer') prototype.trailRenderer = record.data;
      else if (record.type === 'EllipsoidParticleEmitter' || record.type === 'MeshParticleEmitter') { prototype.native = record.data as unknown as NativeParticleEmitter; prototype.meshEmitter = record.type === 'MeshParticleEmitter'; }
      else continue;
      this.prototypes.set(go, prototype);
    }
  }

  private async material(document: SceneDocument, id: number | null | undefined, source: number): Promise<number | undefined> {
    const raw = id == null ? undefined : this.materials[id]?.[2];
    const shader = (raw?.m_Shader as { r?: number } | undefined)?.r;
    const name = shader === undefined ? undefined : this.pack.resources[shader]?.[2].name;
    if (!name || !/^VFX_TextureRotate(?:_Additive)?$/.test(name) && !/blend(?:Invdestcolor|Invdestalpha|Invsrccolor|Invsrcalpha|Srccolor|Srcalpha|Destcolor|Destalpha|One|Zero)(?:Invdestcolor|Invdestalpha|Invsrccolor|Invsrcalpha|Srccolor|Srcalpha|Destcolor|Destalpha|One|Zero)/i.test(name)) {
      document.missing.add(`Particle ${source}: material/shader unavailable or unsupported`);
      return undefined;
    }
    return document.material(id);
  }

  private store(document: SceneDocument, recipe: ParticleRecipe): void {
    ((document.extras.particles ??= []) as ParticleRecipe[]).push(recipe);
    document.stats.particles++;
  }

  private async controlled(document: SceneDocument, node: number, id: number, source: Prototype, effect: Effect, keys: ParticleScriptKey[]): Promise<void> {
    const emitter = source.emitter;
    if (!emitter || emitter.m_Enabled === false) return;
    const base: Omit<ParticleBase, 'material'> = { node, keys, effect: { maxTimer: effect.maxTimer, disableUpdate: effect.disableUpdate, conformToScale: effect.conformToScale, TrailTimes: effect.TrailTimes, longestLifeTime: effect.longestLifeTime }, seed: id };
    if (emitter.m_iGenType === 12) {
      const trail = source.trail, spacing = effect.TrailTimes ?? trail?.fTimes;
      if (!trail || !source.trailRenderer) { document.missing.add(`Particle ${id}: trail metadata unavailable`); return; }
      if (!(emitter.numberPerGeneration >= 2) || !(spacing! > 0)) { document.missing.add(`Particle ${id}: invalid trail settings`); return; }
      const material = await this.material(document, source.trailRenderer.m_Materials?.[0]?.r, id);
      if (material !== undefined) this.store(document, { ...base, kind: 'trail', emitter, trail, material });
      return;
    }
    const { renderer, animator } = source;
    if (!renderer || !animator) { document.missing.add(`Particle ${id}: renderer/animator metadata unavailable`); return; }
    if (!Number.isInteger(emitter.m_iGenType) || emitter.m_iGenType < 0 || emitter.m_iGenType > 11 || ![0, 4, 5].includes(renderer.m_StretchParticles)) { document.missing.add(`Particle ${id}: unsupported emitter/billboard mode`); return; }
    if (!(emitter.lifeTime > 0) || !(emitter.numberPerGeneration > 0)) return;
    const material = await this.material(document, renderer.m_Materials?.[0]?.r, id);
    if (material === undefined) return;
    const recipe: BillboardParticleRecipe = { ...base, kind: 'billboard', emitter, renderer, animator, material };
    this.store(document, recipe);
  }

  async add(document: SceneDocument, node: number, effect: Effect): Promise<void> {
    if (!this.prototypes.size) {
      if (effect.particles?.length) document.missing.add('Particle emitters require ObjectPacks particle metadata');
      return;
    }
    for (const entry of effect.particles ?? []) {
      const id = entry.particlePrefab?.r;
      if (id == null) continue;
      const source = this.prototypes.get(id);
      if (!source?.emitter) { document.missing.add(`Particle ${id}: emitter metadata unavailable`); continue; }
      await this.controlled(document, node, id, source, effect, entry.scriptKeys ?? []);
    }
  }

  async direct(document: SceneDocument, node: number, renderer: number): Promise<void> {
    const go = this.renderers.get(renderer), source = go === undefined ? undefined : this.prototypes.get(go);
    if (!source) { document.missing.add(`Particle renderer ${renderer}: metadata unavailable`); return; }
    const effect: Effect = { maxTimer: 0, disableUpdate: true, conformToScale: false };
    if (source.emitter) {
      if (source.emitter.bTimer && source.emitter.emit) await this.controlled(document, node, go!, source, effect, []);
      return;
    }
    const native = source.native;
    if (!native?.m_Enabled || !native.m_Emit || !source.renderer || !source.animator) return;
    if (source.renderer.m_Enabled === false || !(native.maxEnergy > 0)) return;
    if (![0, 4, 5].includes(source.renderer.m_StretchParticles)) { document.missing.add(`Particle ${go}: unsupported billboard mode`); return; }
    const material = await this.material(document, source.renderer.m_Materials?.[0]?.r, go!);
    if (material === undefined) return;
    let mesh: number | undefined;
    if (source.meshEmitter) {
      const id = native.m_Mesh?.r;
      mesh = id == null ? undefined : await document.geometry(id, []);
      if (mesh === undefined) { document.missing.add(`Particle ${go}: emission mesh unavailable`); return; }
    }
    this.store(document, { kind: 'native', node, mesh, material, native, renderer: source.renderer, animator: source.animator, keys: [], effect, seed: go! });
  }
}
