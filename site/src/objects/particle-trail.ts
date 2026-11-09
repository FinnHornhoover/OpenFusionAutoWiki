import * as THREE from 'three';
import type { TrailParticleRecipe } from '../../../shared/particles';
import { ParticlePose, type ParticleSystem } from './particle-values';

export function trailSystem(recipe: TrailParticleRecipe, parent: THREE.Object3D, material: THREE.ShaderMaterial, capacity: number): ParticleSystem {
  const length = Math.max(2, Math.min(256, capacity, Math.trunc(recipe.emitter.numberPerGeneration)));
  const geometry = new THREE.BufferGeometry(), positions = new THREE.BufferAttribute(new Float32Array(length * 6), 3).setUsage(THREE.DynamicDrawUsage);
  const colors = new THREE.BufferAttribute(new Float32Array(length * 8), 4), uv = new THREE.BufferAttribute(new Float32Array(length * 4), 2).setUsage(THREE.DynamicDrawUsage);
  const indices: number[] = [], factors = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const value = Math.min(i, length - 2) / (length - 1); factors[i] = 1 - (i + 1) / length;
    colors.setXYZW(i * 2, value, value, value, value); colors.setXYZW(i * 2 + 1, value, value, value, value);
    if (i < length - 1) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
  }
  geometry.setAttribute('position', positions); geometry.setAttribute('uv', uv); geometry.setAttribute('particleColor', colors); geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'particle-trail'; mesh.userData.ffEffect = true; mesh.frustumCulled = false; mesh.renderOrder = 3;
  const pose = new ParticlePose(recipe, parent); pose.update(0);
  const history = Array.from({ length }, () => pose.position.clone()), previous = pose.position.clone(), point = new THREE.Vector3(), axis = new THREE.Vector3(), right = new THREE.Vector3(), side = new THREE.Vector3(), cameraPosition = new THREE.Vector3();
  let time = 0, accumulator = 0;
  const add = (point: THREE.Vector3): void => {
    for (let i = 0; i < length - 1; i++) history[i].copy(history[i + 1]);
    history[length - 1].copy(point);
    if (recipe.trail.bUVScroll) { const first = factors[0]; factors.copyWithin(0, 1); factors[length - 1] = first; }
  };
  const tick = (delta: number, drift?: THREE.Vector3): void => {
    time += delta; material.uniforms.time.value = time; pose.update(time);
    if (drift) for (const point of history) point.addScaledVector(drift, delta);
    previous.copy(history[length - 1]);
    const spacing = recipe.effect.TrailTimes ?? recipe.trail.fTimes;
    const steps = Math.max(1, Math.ceil(1 / spacing)), start = Math.max(1, steps - length + 1);
    if (recipe.trail.bUVScroll && start > 1) { const copy = factors.slice(); for (let i = 0; i < length; i++) factors[i] = copy[(i + start - 1) % length]; }
    for (let i = start; i < steps; i++) add(point.copy(previous).lerp(pose.position, Math.min(1, i * spacing)));
    add(pose.position);
  };
  const update = (delta: number, camera?: THREE.Camera, drift?: THREE.Vector3): void => {
    accumulator += delta;
    while (accumulator >= 1 / 30) { tick(1 / 30, drift); accumulator -= 1 / 30; }
    const dead = recipe.effect.maxTimer > 0 && !recipe.effect.disableUpdate && time > recipe.effect.maxTimer + (recipe.effect.longestLifeTime ?? recipe.emitter.lifeTime);
    const distant = camera && camera.getWorldPosition(cameraPosition).distanceToSquared(pose.position) > 200 ** 2;
    if (dead || distant) { geometry.setDrawRange(0, 0); return; }
    geometry.setDrawRange(0, indices.length);
    axis.copy(pose.position).sub(previous).normalize();
    if (camera) right.setFromMatrixColumn(camera.matrixWorld, 0); else right.set(1, 0, 0);
    const scale = parent.scale.x, height = recipe.emitter.initialSize * scale * (recipe.effect.conformToScale ? scale : 1);
    for (let i = 0; i < length; i++) {
      // Reflection reverses the source controller's rotation around the trail axis.
      side.copy(right);
      if (axis.lengthSq()) side.applyAxisAngle(axis, -(i / (length - 1) * Math.PI * 2 + time * Math.PI * 4));
      side.multiplyScalar(height * 0.5);
      point.copy(history[i]).add(side); positions.setXYZ(i * 2, point.x, point.y, point.z);
      // The source ribbon closes its last edge to a point on the positive side.
      point.copy(history[i]); if (i === length - 1) point.add(side); else point.sub(side);
      positions.setXYZ(i * 2 + 1, point.x, point.y, point.z);
      uv.setXY(i * 2, factors[i], 0); uv.setXY(i * 2 + 1, factors[i], 1);
    }
    positions.needsUpdate = true; uv.needsUpdate = true;
  };
  if (recipe.effect.prewarm !== false && recipe.effect.maxTimer < 0) for (let t = 0; t < Math.min(-recipe.effect.maxTimer, 8); t += 1 / 30) tick(1 / 30);
  update(0);
  return { root: mesh, update, dispose() { geometry.dispose(); material.dispose(); } };
}
