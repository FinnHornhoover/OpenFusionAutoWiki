import * as THREE from 'three';
import { streamFiles } from './stream-files';
import { loadGlb, setUpScene, type SceneSetup } from 'ff-three/world';
import type { PreviewVariant } from '../../../shared/objects';
import { disposeGltf, type LoadedModel } from './assets';
import { sceneMotion, type SceneMotion } from './scene-motion';

export interface VehicleEffects {
  readonly count: number;
  visible(show: boolean): void;
  update(delta: number, movement: number): void;
  dispose(): void;
}

export async function vehicleEffects(models: LoadedModel[], entries: NonNullable<PreviewVariant['vehicleEffects']>, actor: THREE.Object3D, speed: number, baseUrl: string, env: Record<string, THREE.IUniform>, camera: THREE.Camera, signal: AbortSignal): Promise<VehicleEffects> {
  const files = streamFiles(signal, 16 * 1024 * 1024);
  const effects: { setup: SceneSetup; release(): void; motion?: SceneMotion }[] = [], drift = new THREE.Vector3(), scale = new THREE.Vector3();
  const budget = { remaining: 2000, systems: 32 };
  let disposed = false, visible = true, movement = 0;
  const show = (): void => { effects.forEach((effect) => { effect.setup.root.visible = visible && movement !== 0; }); };
  const dispose = (): void => {
    if (!disposed) { disposed = true; signal.removeEventListener('abort', dispose); }
    for (const effect of effects) { effect.setup.root.removeFromParent(); effect.motion?.dispose(); effect.setup.dispose(); effect.release(); }
    files.dispose();
  };
  signal.addEventListener('abort', dispose, { once: true });

  try {
    for (const entry of entries) {
      signal.throwIfAborted();
      let parent: THREE.Object3D | undefined;
      for (const model of models) {
        parent = model.nodes.get(model.data.nodes.findIndex((node) => node.name?.toLowerCase() === entry.mount.toLowerCase()));
        if (parent) break;
      }
      if (!parent) continue;
      const url = new URL(`${baseUrl}/${entry.model}`, location.href).href, loaded = await loadGlb(url, files);
      if (disposed || signal.aborted) { disposeGltf(loaded.gltf); loaded.release(); throw new DOMException('Aborted', 'AbortError'); }
      let setup: SceneSetup;
      try { setup = await setUpScene(loaded.gltf, { env, grass: false, animate: true }); }
      catch (error) { disposeGltf(loaded.gltf); loaded.release(); throw error; }
      if (disposed || signal.aborted) { setup.dispose(); disposeGltf(loaded.gltf); loaded.release(); throw new DOMException('Aborted', 'AbortError'); }
      const effect = { setup, release: () => { disposeGltf(loaded.gltf); loaded.release(); }, motion: undefined as SceneMotion | undefined };
      effects.push(effect);
      setup.root.visible = false;
      parent.getWorldScale(scale);
      setup.root.scale.set(1 / scale.x, 1 / scale.y, 1 / scale.z);
      parent.add(setup.root); setup.root.updateMatrixWorld(true);
      effect.motion = await sceneMotion(loaded.gltf, setup, url, baseUrl, env, files, signal, camera, budget, false);
      signal.throwIfAborted();
    }
    return {
      count: effects.length,
      visible(value) { visible = value; show(); },
      update(delta, value) {
        if (disposed) return;
        movement = value; show();
        // Reverse travel for backward clips; standing adds no simulated motion.
        drift.set(0, 0, -1).transformDirection(actor.matrixWorld).multiplyScalar(speed * movement);
        effects.forEach((effect) => effect.motion?.update(delta, drift));
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
