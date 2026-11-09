import * as THREE from 'three';
import { loadGlb, setUpScene, type Files, type SceneSetup } from 'ff-three/world';
import { disposeGltf } from './assets';
import { dressFusionMatter, repairWrenchAlpha } from './materials';
import { sceneMotion, type SceneMotion } from './scene-motion';
import type { ParticleBudget } from './particles';

export interface AreaTile {
  setup: SceneSetup;
  motion?: SceneMotion;
  moving: boolean;
  dispose(): void;
}

export async function loadAreaTile(file: string, baseUrl: string, env: Record<string, THREE.IUniform>, files: Files, signal: AbortSignal, camera: THREE.Camera, budget: ParticleBudget, detail: { grass: boolean; effects: boolean } | null): Promise<AreaTile> {
  const url = new URL(`${baseUrl}/${file}`, location.href).href;
  const loaded = await loadGlb(url, files);
  let setup: SceneSetup | undefined, motion: SceneMotion | undefined;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    motion?.dispose(); setup?.dispose(); disposeGltf(loaded.gltf); loaded.release();
  };
  try {
    signal.throwIfAborted();
    setup = await setUpScene(loaded.gltf, { env, grass: detail?.grass ?? false, animate: !!detail });
    signal.throwIfAborted();
    dressFusionMatter(setup.dressing, env);
    repairWrenchAlpha(setup.dressing);
    setup.root.traverse((object) => { if (object instanceof THREE.Mesh && object.material instanceof THREE.ShaderMaterial && object.material.name === 'ff:grass') object.userData.ffGrass = true; });
    if (detail) motion = await sceneMotion(loaded.gltf, setup, url, baseUrl, env, files, signal, camera, budget, true, detail.effects);
    signal.throwIfAborted();
    return { setup, motion, moving: !!motion?.moving || setup.dressing.meshes.some((mesh) => ['water', 'fusion', 'vfx'].includes(mesh.userData.ffInfo?.family)) || !!setup.root.getObjectByName('grass'), dispose };
  } catch (error) { dispose(); throw error; }
}
