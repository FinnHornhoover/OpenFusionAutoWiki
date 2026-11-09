import * as THREE from 'three';
import type { ParticleAnimator, ParticleBase, ParticleCurve, ParticleEmitter, ParticleVector } from '../../../shared/particles';

export function curveValue(curve: ParticleCurve | undefined, time: number, fallback: number): number {
  const keys = curve?.m_Curve;
  if (!keys?.length) return fallback;
  if (time <= keys[0].time) return keys[0].value;
  if (time >= keys[keys.length - 1].time) return keys[keys.length - 1].value;
  const i = keys.findIndex((key) => key.time > time), a = keys[i - 1], b = keys[i], duration = b.time - a.time;
  if (!Number.isFinite(a.outSlope) || !Number.isFinite(b.inSlope)) return a.value;
  const t = (time - a.time) / duration, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * a.value + (t3 - 2 * t2 + t) * duration * a.outSlope + (-2 * t3 + 3 * t2) * b.value + (t3 - t2) * duration * b.inSlope;
}

export function random(seed: number): () => number {
  let state = seed | 0;
  return () => { state = state + 0x6d2b79f5 | 0; let t = Math.imul(state ^ state >>> 15, 1 | state); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export const vector = (value: ParticleVector): THREE.Vector3 => new THREE.Vector3(value.x, value.y, value.z);

export function emission(emitter: ParticleEmitter, rnd: () => number): { position: THREE.Vector3; velocity: THREE.Vector3 } {
  const position = new THREE.Vector3(), type = emitter.m_iGenType;
  if (type === 0 || type === 1) {
    const y = rnd() * 2 - 1, angle = rnd() * Math.PI * 2, radius = Math.sqrt(1 - y * y) * emitter.randomPosition;
    position.set(Math.cos(angle) * radius, y * emitter.randomPosition, Math.sin(angle) * radius);
    if (type === 0) position.multiplyScalar(rnd());
  } else if (type === 2) {
    position.set((rnd() - 0.5) * emitter.plane.x, (rnd() - 0.5) * emitter.plane.y, (rnd() - 0.5) * emitter.plane.z);
  } else {
    const angle = rnd() * Math.PI * 2, radius = emitter.plane.x + (emitter.plane.z - emitter.plane.x) * rnd();
    const a = Math.cos(angle) * radius, b = Math.sin(angle) * radius;
    if ([3, 6, 9].includes(type)) position.set(0, a, b);
    else if ([4, 7, 10].includes(type)) position.set(a, b, 0);
    else position.set(a, 0, b);
  }
  const velocity = new THREE.Vector3();
  if ([1, 6, 7, 8].includes(type)) velocity.copy(position).normalize().negate();
  else if ([9, 10, 11].includes(type)) velocity.copy(position).normalize();
  // Quaternion.Euler uses Z, X, Y in Unity; velocity rotation precedes reflection.
  const angle = (): number => (rnd() * 2 - 1) * emitter.randomAngle * Math.PI;
  const rotated = vector(emitter.initVelocity).applyEuler(new THREE.Euler(angle(), angle(), angle(), 'YXZ'));
  for (const axis of ['x', 'y', 'z'] as const) velocity[axis] += rotated[axis] * (Math.abs(emitter.initVelocity[axis]) < 0.01 ? emitter.initVelocity[axis] : 1);
  velocity.multiplyScalar(rnd() * 2 * (1 - emitter.randomVelocity));
  position.x *= -1; velocity.x *= -1;
  return { position, velocity };
}

export function particleColor(animator: ParticleAnimator, age: number): number[] {
  if (!animator['Does Animate Color?']) return [1, 1, 1, 1];
  const index = Math.min(3, Math.floor(age * 4)), t = age * 4 - index;
  const colors = animator as unknown as Record<string, { rgba?: number }>;
  const a = colors[`colorAnimation[${index}]`]?.rgba ?? 0xffffffff, b = colors[`colorAnimation[${index + 1}]`]?.rgba ?? 0xffffffff;
  return [0, 8, 16, 24].map((shift) => ((a >>> shift & 255) * (1 - t) + (b >>> shift & 255) * t) / 255);
}

export interface ParticleSystem {
  root: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  update(delta: number, camera?: THREE.Camera, drift?: THREE.Vector3): void;
  dispose(): void;
}

export class ParticlePose {
  readonly position = new THREE.Vector3();
  readonly rotation = new THREE.Quaternion();
  readonly matrix = new THREE.Matrix4();
  private local = new THREE.Vector3();

  constructor(private recipe: ParticleBase, readonly parent: THREE.Object3D) {}

  update(time: number): boolean {
    const { effect, keys } = this.recipe, length = Math.abs(effect.maxTimer);
    const clock = effect.disableUpdate || !length ? 0 : effect.maxTimer > 0 ? Math.min(time, length) : time % length;
    let active = true;
    this.local.set(0, 0, 0);
    if (keys.length) {
      let index = 0;
      while (index < keys.length - 1 && keys[index].time * length < clock) index++;
      const a = keys[Math.max(0, index - 1)], b = keys[index];
      const t = index && length > 0 && b.time > a.time ? THREE.MathUtils.clamp((clock / length - a.time) / (b.time - a.time), 0, 1) : 0;
      this.local.copy(vector(a.translate)).lerp(vector(b.translate), t); this.local.x *= -1;
      active = a.genType !== 0;
    }
    this.parent.updateWorldMatrix(true, false);
    this.position.copy(this.local).applyMatrix4(this.parent.matrixWorld);
    this.parent.getWorldQuaternion(this.rotation);
    this.matrix.copy(this.parent.matrixWorld).setPosition(this.position);
    return active && (effect.disableUpdate || effect.maxTimer <= 0 || time <= effect.maxTimer);
  }
}
