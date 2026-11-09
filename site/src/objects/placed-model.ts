import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { loadGlb, type Files } from 'ff-three/world';
import type { PreviewVariant } from '../../../shared/objects';
import { preferredAnimation } from '../../../shared/animations.js';
import { compose, disposeTexture, disposeTree, dressModel, prepareModel, type LoadedModel } from './assets';
import { ModelAnimation } from './animation';

export interface PlacedModel {
  root: THREE.Object3D;
  update(delta: number): void;
  dispose(): void;
}

export async function placedModel(variant: PreviewVariant, baseUrl: string, env: Record<string, THREE.IUniform>, signal: AbortSignal, files: Files): Promise<PlacedModel> {
  const models: LoadedModel[] = [], textures = new Set<THREE.Texture>(), players: ModelAnimation[] = [];
  const clips = new Map<string, Promise<GLTF>>();
  const releases: (() => void)[] = [];
  const dispose = (): void => {
    players.forEach((p) => p.dispose());
    models.forEach((m) => { m.dressing?.dispose(); disposeTree(m.gltf.scene); });
    textures.forEach(disposeTexture);
    releases.splice(0).forEach((release) => release());
  };
  const load = async (file: string): Promise<LoadedModel> => {
    signal.throwIfAborted();
    const url = new URL(`${baseUrl}/${file}`, location.href).href;
    const loaded = await loadGlb(url, files);
    releases.push(loaded.release);
    const model = prepareModel(loaded.gltf, url);
    models.push(model);
    signal.throwIfAborted();
    return model;
  };
  const loadClip = (url: string): Promise<GLTF> => {
    let clip = clips.get(url);
    if (!clip) {
      clip = loadGlb(url, files).then((loaded) => { releases.push(loaded.release); return loaded.gltf; });
      clips.set(url, clip);
    }
    return clip;
  };
  try {
    const actor = await load(variant.model.model);
    actor.gltf.scene.scale.setScalar(variant.scale ?? 1);
    await dressModel(actor, variant.model, variant, baseUrl, env, textures, true);
    for (const part of variant.parts ?? []) {
      const item = await load(part.model);
      await dressModel(item, part, variant, baseUrl, env, textures, true);
      compose(actor, item, part, variant);
      if (part.mode === 'attached' && part.autoAnimation) {
        const player = new ModelAnimation(item, loadClip, actor.gltf.scene, [part.autoAnimation]);
        players.push(player);
        await player.play(part.autoAnimation);
      }
    }
    const choices = variant.animations ?? [];
    const player = new ModelAnimation(actor, loadClip, actor.gltf.scene, choices.map((c) => c.name));
    players.push(player);
    const idle = preferredAnimation(choices, variant.animationContext ?? { kind: 'creature' }, variant.idle);
    if (idle) await player.play(idle);
    if (variant.height !== undefined) await player.proportions('height', variant.height);
    if (variant.shape !== undefined) await player.proportions('shape', variant.shape);
    signal.throwIfAborted();
    return { root: actor.gltf.scene, update(delta) { players.forEach((p) => p.update(delta)); }, dispose };
  } catch (error) { dispose(); throw error; }
}
