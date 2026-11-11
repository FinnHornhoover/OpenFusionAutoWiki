import * as THREE from 'three';
import type { BillboardParticleRecipe, NativeParticleRecipe, ParticleRecipe } from '../../../shared/particles';
import type { ParticleMesh } from './particle-mesh';
import { ParticlePose, curveValue, emission, particleColor, random, vector, type ParticleSystem } from './particle-values';

interface Alive { position: THREE.Vector3; velocity: THREE.Vector3; age: number; life: number; size: number }

export function particleCapacity(recipe: ParticleRecipe): number {
  if (recipe.kind === 'trail') return Math.max(2, Math.min(256, Math.trunc(recipe.emitter.numberPerGeneration)));
  if (recipe.kind === 'native') return Math.max(1, Math.ceil(recipe.native.maxEmission * (recipe.native.m_OneShot ? 1 : recipe.native.maxEnergy) + 1));
  return Math.max(1, Math.ceil(recipe.emitter.lifeTime * Math.max(0, recipe.emitter.generationsPerSecond)) * Math.ceil(recipe.emitter.numberPerGeneration) + Math.ceil(recipe.emitter.numberPerGeneration));
}

export function billboardSystem(recipe: BillboardParticleRecipe | NativeParticleRecipe, parent: THREE.Object3D, material: THREE.ShaderMaterial, capacity: number, sourceMesh?: ParticleMesh): ParticleSystem {
  const { renderer, animator, effect } = recipe;
  const emitter = recipe.kind === 'billboard' ? recipe.emitter : undefined, native = recipe.kind === 'native' ? recipe.native : undefined;
  const localSpace = !!native && !native['Simulate in Worldspace?'];
  const quad = new THREE.PlaneGeometry(1, 1), geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(quad.getIndex()!.clone());
  geometry.setAttribute('position', quad.getAttribute('position').clone());
  geometry.setAttribute('uv', quad.getAttribute('uv').clone()); quad.dispose();
  for (const [key, components] of [['center', 3], ['dimensions', 2], ['particleColor', 4], ['angle', 1], ['rectangle', 4]] as const) {
    geometry.setAttribute(key, new THREE.InstancedBufferAttribute(new Float32Array(capacity * components), components).setUsage(THREE.DynamicDrawUsage));
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'particles'; mesh.userData.ffEffect = true; mesh.frustumCulled = false; mesh.renderOrder = 3;
  geometry.instanceCount = 0; material.uniforms.billboard.value = renderer.m_StretchParticles;
  material.uniforms.maxSize.value = renderer.m_MaxParticleSize ?? 10;
  const alive: Alive[] = [], rnd = random(recipe.seed), force = vector(animator.force); force.x *= -1;
  const pose = new ParticlePose(recipe, parent), cameraPosition = new THREE.Vector3(), worldPosition = new THREE.Vector3(), lastOrigin = new THREE.Vector3(), inheritedVelocity = new THREE.Vector3(), worldScale = new THREE.Vector3();
  const between = (a: number, b: number): number => a + (b - a) * rnd();
  const spawn = (): void => {
    if (emitter) {
      const p = emission(emitter, rnd);
      alive.push({ position: p.position.add(pose.position), velocity: p.velocity.applyQuaternion(pose.rotation), age: 0, life: emitter.lifeTime, size: emitter.initialSize });
      return;
    }
    if (!native) return;
    const y = rnd() * 2 - 1, angle = rnd() * Math.PI * 2, ring = Math.sqrt(1 - y * y), min = THREE.MathUtils.clamp(native.m_MinEmitterRange ?? 0, 0, 1), radius = Math.cbrt(between(min ** 3, 1));
    const sampled = sourceMesh?.sample(rnd, native.m_InterpolateTriangles !== false, !!native.m_Systematic);
    const ellipsoid = native.m_Ellipsoid ?? { x: 0, y: 0, z: 0 };
    const position = sampled?.position ?? new THREE.Vector3(-Math.cos(angle) * ring * radius * ellipsoid.x, y * radius * ellipsoid.y, Math.sin(angle) * ring * radius * ellipsoid.z);
    const velocity = vector(native.localVelocity), world = vector(native.worldVelocity), tangent = vector(native.tangentVelocity);
    velocity.x *= -1; world.x *= -1; tangent.y *= -1; tangent.z *= -1;
    velocity.add(new THREE.Vector3(-between(-native.rndVelocity.x, native.rndVelocity.x), between(-native.rndVelocity.y, native.rndVelocity.y), between(-native.rndVelocity.z, native.rndVelocity.z)));
    velocity.add(tangent.cross(position));
    if (sampled) velocity.addScaledVector(sampled.normal, between(native.m_MinNormalVelocity ?? 0, native.m_MaxNormalVelocity ?? 0));
    if (localSpace) velocity.add(world.applyQuaternion(pose.rotation.clone().invert()));
    else { position.applyMatrix4(pose.matrix); velocity.applyQuaternion(pose.rotation).add(world).addScaledVector(inheritedVelocity, native.emitterVelocityScale); }
    alive.push({ position, velocity, age: 0, life: Math.max(1e-6, between(native.minEnergy, native.maxEnergy)), size: between(native.minSize, native.maxSize) });
  };
  pose.update(0); lastOrigin.copy(pose.position);
  let time = 0, timer = 2, emissionCarry = 0, burst = false;
  const update = (delta: number, camera?: THREE.Camera, drift?: THREE.Vector3): void => {
    time += delta; material.uniforms.time.value = time;
    const emitting = pose.update(time);
    inheritedVelocity.copy(pose.position).sub(lastOrigin).multiplyScalar(delta ? 1 / delta : 0); lastOrigin.copy(pose.position);
    if (!animator.stopSimulation) for (let i = alive.length - 1; i >= 0; i--) {
      const p = alive[i]; p.age += delta;
      if (p.age >= p.life) { alive[i] = alive[alive.length - 1]; alive.pop(); continue; }
      p.velocity.addScaledVector(force, delta).multiplyScalar(Math.pow(Math.max(0, animator.damping), delta));
      p.position.addScaledVector(p.velocity, delta);
      if (drift && !localSpace) p.position.addScaledVector(drift, delta);
    }
    let births = 0;
    if (emitter) {
      timer += delta * emitter.generationsPerSecond;
      if (timer >= 1) { timer = 0; if (emitting) births = Math.ceil(emitter.numberPerGeneration); }
    } else if (native && emitting) {
      if (native.m_OneShot) { if (!burst) { births = Math.round(between(native.minEmission, native.maxEmission)); burst = true; } }
      else { emissionCarry += delta * between(native.minEmission, native.maxEmission); births = Math.floor(emissionCarry); emissionCarry -= births; }
    }
    for (let i = 0; i < births && alive.length < capacity; i++) spawn();
    // Keep simulation time and long-lived particles when their renderer is culled.
    if (camera && camera.getWorldPosition(cameraPosition).distanceToSquared(pose.position) > 200 ** 2) { geometry.instanceCount = 0; return; }
    const centers = geometry.getAttribute('center') as THREE.InstancedBufferAttribute, dimensions = geometry.getAttribute('dimensions') as THREE.InstancedBufferAttribute;
    const colors = geometry.getAttribute('particleColor') as THREE.InstancedBufferAttribute, angles = geometry.getAttribute('angle') as THREE.InstancedBufferAttribute, rectangles = geometry.getAttribute('rectangle') as THREE.InstancedBufferAttribute;
    if (localSpace) parent.getWorldScale(worldScale);
    const scale = effect.conformToScale ? parent.scale.x : localSpace ? Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z)) : 1, uv = renderer['UV Animation'];
    const columns = Math.max(1, uv['x Tile']), rows = Math.max(1, uv['y Tile']);
    for (const [i, p] of alive.entries()) {
      const age = p.age / p.life;
      const baseWidth = Math.max(0, curveValue(renderer.m_WidthCurve, age, p.size + animator.sizeGrow * p.age));
      const width = baseWidth * scale, height = Math.max(0, curveValue(renderer.m_HeightCurve, age, baseWidth)) * scale;
      const frames = emitter?.textureKeys.length || columns * rows;
      const frame = Math.floor(age * uv.cycles * frames) % frames, color = particleColor(animator, age), rectangle = emitter?.textureKeys[frame];
      worldPosition.copy(p.position); if (localSpace) worldPosition.applyMatrix4(pose.matrix);
      centers.setXYZ(i, worldPosition.x, worldPosition.y, worldPosition.z); dimensions.setXY(i, width, height); colors.setXYZW(i, color[0], color[1], color[2], color[3]);
      angles.setX(i, THREE.MathUtils.degToRad(curveValue(renderer.m_RotationCurve, age, 0)));
      if (rectangle) rectangles.setXYZW(i, rectangle.x, rectangle.y, rectangle.width, rectangle.height);
      else rectangles.setXYZW(i, frame % columns / columns, 1 - (Math.floor(frame / columns) + 1) / rows, 1 / columns, 1 / rows);
    }
    for (const name of ['center', 'dimensions', 'particleColor', 'angle', 'rectangle']) geometry.getAttribute(name).needsUpdate = true;
    geometry.instanceCount = alive.length;
  };
  const life = emitter?.lifeTime ?? native!.maxEnergy;
  const warmup = effect.prewarm === false ? 0 : effect.maxTimer <= 0 && !native?.m_OneShot ? Math.min(life, 8) : 1 / 30;
  for (let t = 0; t < warmup; t += 1 / 30) update(1 / 30);
  return { root: mesh, update, dispose() { geometry.dispose(); material.dispose(); } };
}
