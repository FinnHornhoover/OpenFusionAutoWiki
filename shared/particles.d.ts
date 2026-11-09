export interface ParticleVector { x: number; y: number; z: number }
export interface ParticleKey { time: number; value: number; inSlope: number; outSlope: number }
export interface ParticleCurve { m_Curve: ParticleKey[] }
export interface ParticleEmitter {
  m_Enabled?: boolean;
  bTimer?: boolean | number;
  emit?: boolean | number;
  m_iGenType: number;
  numberPerGeneration: number;
  generationsPerSecond: number;
  randomPosition: number;
  randomAngle: number;
  randomVelocity: number;
  lifeTime: number;
  initVelocity: ParticleVector;
  plane: ParticleVector;
  initialSize: number;
  textureKeys: { x: number; y: number; width: number; height: number }[];
}
export interface ParticleAnimator {
  'Does Animate Color?': boolean;
  'colorAnimation[0]'?: { rgba: number };
  'colorAnimation[1]'?: { rgba: number };
  'colorAnimation[2]'?: { rgba: number };
  'colorAnimation[3]'?: { rgba: number };
  'colorAnimation[4]'?: { rgba: number };
  force: ParticleVector;
  rndForce: ParticleVector;
  damping: number;
  sizeGrow: number;
  stopSimulation: boolean;
}
export interface ParticleRenderer {
  m_StretchParticles: number;
  m_MaxParticleSize?: number;
  m_WidthCurve: ParticleCurve;
  m_HeightCurve: ParticleCurve;
  m_RotationCurve: ParticleCurve;
  'UV Animation': { 'x Tile': number; 'y Tile': number; cycles: number };
}
export interface ParticleScriptKey { time: number; translate: ParticleVector; genType: number }
export interface ParticleEffectSettings {
  maxTimer: number; disableUpdate: boolean; conformToScale: boolean;
  prewarm?: boolean;
  TrailTimes?: number;
  longestLifeTime?: number;
}
export interface ParticleTrail { fHeight: number; trailLength: number; fTimes: number; bUVScroll: boolean }
export interface NativeParticleEmitter {
  m_Enabled: boolean; m_Emit: boolean; m_OneShot: boolean;
  minSize: number; maxSize: number; minEnergy: number; maxEnergy: number;
  minEmission: number; maxEmission: number;
  worldVelocity: ParticleVector; localVelocity: ParticleVector; rndVelocity: ParticleVector; tangentVelocity: ParticleVector;
  emitterVelocityScale: number;
  'Simulate in Worldspace?': boolean;
  m_Ellipsoid?: ParticleVector; m_MinEmitterRange?: number;
  m_Mesh?: { r: number | null };
  m_InterpolateTriangles?: boolean; m_Systematic?: boolean;
  m_MinNormalVelocity?: number; m_MaxNormalVelocity?: number;
}
export interface ParticleBase {
  node: number;
  material: number;
  keys: ParticleScriptKey[];
  effect: ParticleEffectSettings;
  seed: number;
  lifetime?: number;
}
export interface BillboardParticleRecipe extends ParticleBase {
  kind: 'billboard';
  emitter: ParticleEmitter;
  animator: ParticleAnimator;
  renderer: ParticleRenderer;
}
export interface TrailParticleRecipe extends ParticleBase {
  kind: 'trail';
  emitter: ParticleEmitter;
  trail: ParticleTrail;
}
export interface NativeParticleRecipe extends ParticleBase {
  kind: 'native';
  mesh?: number;
  native: NativeParticleEmitter;
  animator: ParticleAnimator;
  renderer: ParticleRenderer;
}
export type ParticleRecipe = BillboardParticleRecipe | TrailParticleRecipe | NativeParticleRecipe;
