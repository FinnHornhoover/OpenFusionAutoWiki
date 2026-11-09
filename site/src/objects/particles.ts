import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { ParticleRecipe } from '../../../shared/particles';
import type { ParticleSystem } from './particle-values';
import { billboardSystem, particleCapacity } from './particle-system';
import { trailSystem } from './particle-trail';
import { particleMaterial } from './particle-material';
import { ParticleMesh } from './particle-mesh';
import { disposeTree, disposeTexture } from './assets';
import { effectTextures } from './effect-material';
import { VFX_SHADERS } from '../../../shared/shaders.js';

export interface ParticleBudget { remaining: number; systems?: number }

export async function sceneParticles(gltf: GLTF, signal: AbortSignal, budget: ParticleBudget, preserveAlpha = true): Promise<{ roots: THREE.Object3D[]; update(delta: number, camera?: THREE.Camera, drift?: THREE.Vector3): void; dispose(): void }> {
  const recipes = (gltf.parser.json.extras?.particles ?? []) as ParticleRecipe[], systems: ParticleSystem[] = [];
  if (!recipes.length) return { roots: [], update() {}, dispose() {} };
  const nodes = new Map<number, THREE.Object3D>();
  gltf.scene.traverse((object) => { const index = gltf.parser.associations.get(object)?.nodes; if (index !== undefined && !nodes.has(index)) nodes.set(index, object); });
  const textures = new Set<THREE.Texture>(), meshes = new Set<THREE.Object3D>();
  const lifetimes = new Map<ParticleSystem, number>();
  budget.systems ??= 160;
  let used = 0, systemCount = 0, accumulator = 0, age = 0, disposed = false;
  const dispose = (): void => { if (disposed) return; disposed = true; budget.remaining += used; budget.systems! += systemCount; systems.forEach((s) => { s.root.removeFromParent(); s.dispose(); }); textures.forEach(disposeTexture); meshes.forEach((root) => disposeTree(root)); };
  try {
    for (const recipe of recipes) {
      signal.throwIfAborted();
      const parent = nodes.get(recipe.node);
      if (!parent || budget.remaining <= 0 || !budget.systems) continue;
      const capacity = Math.min(512, budget.remaining, particleCapacity(recipe));
      if (recipe.kind === 'trail' && capacity < 2) continue;
      const data = gltf.parser.json.materials[recipe.material], index = data.extras?.textures?._MainTex?.index;
      const texture = index === undefined ? null : await gltf.parser.getDependency('texture', index) as THREE.Texture;
      if (texture) { texture.colorSpace = THREE.NoColorSpace; textures.add(texture); }
      const extraTextures = VFX_SHADERS.includes(data.extras?.shader) ? await effectTextures(data.extras, gltf.parser) : {};
      for (const texture of Object.values(extraTextures)) if (texture) textures.add(texture);
      let sourceMesh: ParticleMesh | undefined;
      if (recipe.kind === 'native' && recipe.mesh !== undefined) {
        const root = await gltf.parser.getDependency('mesh', recipe.mesh) as THREE.Object3D;
        meshes.add(root); sourceMesh = new ParticleMesh(root);
      }
      const material = particleMaterial(data, texture, recipe.kind === 'trail', preserveAlpha, extraTextures);
      let item: ParticleSystem;
      try { item = recipe.kind === 'trail' ? trailSystem(recipe, parent, material, capacity) : billboardSystem(recipe, parent, material, capacity, sourceMesh); } catch (error) { material.dispose(); throw error; }
      budget.remaining -= capacity; budget.systems--; used += capacity; systemCount++; systems.push(item); gltf.scene.add(item.root);
      if (recipe.lifetime !== undefined) lifetimes.set(item, recipe.lifetime);
    }
    signal.throwIfAborted();
    return {
      roots: systems.map((s) => s.root),
      update(delta, camera, drift) { age += delta; for (const [system, lifetime] of lifetimes) system.root.visible = age < lifetime; if (!delta) systems.forEach((s) => s.update(0, camera, drift)); accumulator += Math.min(delta, 0.1); while (accumulator >= 1 / 30) { systems.forEach((s) => s.update(1 / 30, camera, drift)); accumulator -= 1 / 30; } },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
