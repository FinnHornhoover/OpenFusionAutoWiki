import type { WeaponShot } from '../../../shared/objects.js';
import type { ParticleRecipe } from '../../../shared/particles.js';
import type { Pack, Prefab, Resources } from './pack.js';
import type { AssetPool } from './pool.js';
import { ParticleCatalog } from './particles.js';
import { SceneDocument } from './scene-document.js';

interface Bullet {
  m_iParticleScript: number; m_iFireScript: number;
  m_fBulletModelScale: number; m_fFireModelScale: number;
  m_fMaxTimer: number; m_fHideTime: number; m_strFireLink: string;
  m_iSuccScript: number; m_fSuccModelScale: number;
}
interface PrefabDocument {
  nodes: { name?: string; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[]; extras?: { source_object?: number } }[];
  scene?: number;
  scenes: { nodes: number[] }[];
}
interface EffectRecord {
  type: string;
  asset: number;
  data: Parameters<ParticleCatalog['add']>[2] & { m_GameObject?: { r: number }; nifObject?: { r: number } };
}

export class WeaponEffects {
  readonly missing = new Set<string>();
  private bullets: Bullet[];
  private materials: Resources;
  private effects = new Map<number, EffectRecord['data']>();
  private compiled = new Map<string, Promise<{ model: string; duration: number } | undefined>>();
  private particles: ParticleCatalog;
  private renderers = new Map<number, number[]>();

  constructor(private pack: Pack, private pool: AssetPool) {
    const world = pack.msgpack<Record<string, EffectRecord & { data: { m_pBulletData?: Bullet[] } }>>('areas/world.msgpack');
    const records = Object.values(world);
    for (const [id, record] of Object.entries(world)) {
      const go = record.data.m_GameObject?.r;
      if (record.type === 'ParticleRenderer' && go !== undefined) this.renderers.set(go, [...this.renderers.get(go) ?? [], Number(id)]);
    }
    const tables = records.filter((r) => r.type === 'BulletTableScript');
    // BulletContainer keeps its preassigned table before loading a bundle copy.
    const table = tables.find((r) => pack.assetSource(r.asset) === 'main.unity3d')
      ?? tables.find((r) => pack.assetSource(r.asset) === 'Effects.resourceFile') ?? tables[0];
    this.bullets = table?.data.m_pBulletData ?? [];
    for (const r of records) if (r.type === 'EffectEmitterController' && r.data.m_GameObject) this.effects.set(r.data.m_GameObject.r, r.data);
    this.materials = pack.msgpack('metadata/materials.msgpack');
    this.particles = new ParticleCatalog(pack, this.materials);
  }

  private effect(id: number, scale: number, trailTimes?: number): Promise<{ model: string; duration: number } | undefined> {
    if (id < 0 || !(scale > 0)) return Promise.resolve(undefined);
    const key = `${id}:${scale}:${trailTimes ?? ''}`;
    let pending = this.compiled.get(key);
    if (!pending) {
      pending = this.compile(id, scale, trailTimes);
      this.compiled.set(key, pending);
    }
    return pending;
  }

  private async nativeParticles(document: SceneDocument, prefab: Prefab, lifetime?: number): Promise<void> {
    const bytes = this.pack.read(prefab.file);
    const source = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as PrefabDocument;
    if (!source.nodes.some((node) => this.renderers.has(node.extras?.source_object ?? -1))) return;

    const offset = document.nodes.length;
    for (const node of source.nodes) document.nodes.push({
      name: node.name ?? '', translation: node.translation ?? [0, 0, 0], rotation: node.rotation ?? [0, 0, 0, 1], scale: node.scale ?? [1, 1, 1],
      children: node.children?.map((index) => offset + index),
    });
    // EffectEmitterController instantiates the NIF at its own world pose.
    Object.assign(document.nodes[offset], { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
    document.nodes[0].children = (source.scenes[source.scene ?? 0]?.nodes ?? [0]).map((index) => offset + index);
    const before = ((document.extras.particles ?? []) as ParticleRecipe[]).length;
    for (const [index, node] of source.nodes.entries()) {
      for (const renderer of this.renderers.get(node.extras?.source_object ?? -1) ?? []) await this.particles.direct(document, offset + index, renderer);
    }
    for (const particle of ((document.extras.particles ?? []) as ParticleRecipe[]).slice(before)) particle.lifetime = lifetime;
  }

  private async compile(id: number, scale: number, trailTimes?: number): Promise<{ model: string; duration: number } | undefined> {
    const model = this.pack.model([`prefabs/particle/effectscripts/es[${id}].prefab`]);
    const effect = model && this.effects.get(model.object);
    if (!effect) { this.missing.add(`weapon-effect:${id}`); return undefined; }
    const doc = new SceneDocument(this.pack, this.pool, this.materials, new Map());
    doc.nodes.push({ name: `ES[${id}]`, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [scale, scale, scale] });
    doc.roots.push(0);
    await this.particles.add(doc, 0, { ...effect, conformToScale: true, TrailTimes: trailTimes ?? effect.TrailTimes });
    if (effect.nifObject?.r != null) {
      const prefab = this.pack.prefab(effect.nifObject.r);
      const before = doc.stats.particles;
      if (prefab) await this.nativeParticles(doc, prefab, !effect.disableUpdate && effect.maxTimer > 0 ? effect.maxTimer : undefined);
      if (prefab && Object.keys(prefab.renderers).length) {
        this.pool.add(this.pack, prefab.file);
        const animations = this.pack.automaticAnimations(prefab.file);
        this.pool.stageAnimations(this.pack, prefab.file, animations);
        doc.extras.effects = [{ node: 0, model: prefab.file, animations, lifetime: !effect.disableUpdate && effect.maxTimer > 0 ? effect.maxTimer : undefined }];
        doc.stats.effects++;
      } else if (doc.stats.particles === before) this.missing.add(`weapon-effect-model:${id}`);
    }
    const particles = (doc.extras.particles ?? []) as ParticleRecipe[];
    for (const particle of particles) particle.effect.prewarm = false;
    for (const gap of doc.missing) this.missing.add(`weapon-effect:${id}:${gap}`);
    if (!doc.stats.particles && !doc.stats.effects) return undefined;
    const lifetime = Math.max(0, ...particles.map((p) => p.kind === 'native' ? p.native.maxEnergy : p.emitter.lifeTime));
    const duration = Math.max(lifetime, Math.max(0, effect.maxTimer) + Math.max(0, effect.longestLifeTime ?? 0));
    return { model: doc.save(), duration: Math.max(duration, 0.1) };
  }

  async vehicle(name: string, file: string): Promise<{ model: string; mount: string }[]> {
    const bytes = this.pack.read(file);
    const source = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as PrefabDocument;
    const retrobution = this.pack.manifest.build === 'retrobution';
    const tags = retrobution ? /^tag0[1-4]$/i : /^tag0[12]$/i;
    const mounts = source.nodes.flatMap((node) => tags.test(node.name ?? '') ? [node.name!] : []);
    if (!mounts.length) return [];
    const id = name === 'vehicle_hoverboard' ? 835 : name === 'vehicle_cloud' || retrobution && name === 'vehicle_hoverboard2' ? 836 : 15;
    const effect = await this.effect(id, 1, 1.5);
    return effect ? mounts.map((mount) => ({ mount, model: effect.model })) : [];
  }

  async shots(row: Record<string, string | number>): Promise<WeaponShot[]> {
    if (!this.bullets.length) return [];
    const choices = [['Standard', Number(row.m_iEffect1)], ['Battery', Number(row.m_iEffect2)]] as const;
    const shots: WeaponShot[] = [];
    for (const [label, id] of choices) {
      if (label === 'Battery' && (!id || id === Number(row.m_iEffect1))) continue;
      const bullet = this.bullets[id];
      if (!bullet) { this.missing.add(`weapon-bullet:${id}`); continue; }
      const targetMode = Number(row.m_iTargetMode), warhead = targetMode === 5 || targetMode === 6;
      const [fire, projectile, impact] = await Promise.all([
        warhead ? undefined : this.effect(bullet.m_iFireScript, bullet.m_fFireModelScale),
        this.effect(bullet.m_iParticleScript, bullet.m_fBulletModelScale),
        this.effect(bullet.m_iSuccScript, bullet.m_fSuccModelScale * (warhead ? 1 : 1.3)),
      ]);
      const common = { duration: Math.max(0, Number(row.m_iDurationTime) * 0.1), speed: Math.max(0, Number(row.m_iAtkRange) * 0.01), retrobution: this.pack.manifest.build === 'retrobution' };
      const flight: WeaponShot['flight'] = targetMode === 5 ? { kind: 'rocket', ...common }
        : targetMode === 6 ? { kind: 'grenade', ...common, verticalSpeed: Number(row.m_iDeliverTime) * 0.5, weaponModel: common.retrobution && bullet.m_iParticleScript === 31 }
          : { kind: 'ordinary', delay: Math.max(0, bullet.m_fHideTime), duration: Math.max(0, bullet.m_fMaxTimer), range: Math.max(0, Number(row.m_iAtkRange) * 0.01) };
      shots.push({ label, bullet: id, targetMode, equipType: Number(row.m_iEquipType), cooldown: Math.max(0, Number(row.m_iDelayTime) * 0.1), link: bullet.m_strFireLink, fire, projectile, impact,
        flight,
      });
    }
    return shots;
  }
}
