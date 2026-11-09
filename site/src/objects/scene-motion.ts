import * as THREE from 'three';
import type { GLTF, GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { loadGlb, setUpScene, type Files, type SceneSetup } from 'ff-three/world';
import { ModelAnimation } from './animation';
import { sceneParticles, type ParticleBudget } from './particles';
import { type LoadedModel, type ModelData, disposeTree } from './assets';
import { dressEffectAlpha, dressFusionMatter, repairWrenchAlpha } from './materials';

interface Automatic { name: string; duration: number; animation?: number; material_clip?: number }
interface Curve { node?: number; renderer_nodes?: number[] }
interface SceneData extends ModelData {
  animations?: { channels: unknown[]; extras?: { float_curves?: Record<string, Curve> } }[];
  extras?: ModelData['extras'] & {
    automatic_clips?: Automatic[];
    material_clips?: { float_curves?: Record<string, Curve> }[];
    effects?: { node: number; model: string; animations: string[]; lifetime?: number }[];
    stats?: { skins: number; clips: number; grass: number; platforms: number; effects: number };
  };
}
export interface SceneMotion {
  moving: boolean;
  effects: THREE.Object3D[];
  update(delta: number, drift?: THREE.Vector3): void;
  dispose(): void;
}
function loadedModel(gltf: GLTF, url: string): LoadedModel {
  const nodes = new Map<number, THREE.Object3D>();
  gltf.scene.traverse((object) => { const index = gltf.parser.associations.get(object)?.nodes; if (index !== undefined && !nodes.has(index)) nodes.set(index, object); });
  return { gltf, url, nodes, data: gltf.parser.json as ModelData };
}

export async function sceneMotion(gltf: GLTF, setup: SceneSetup, url: string, baseUrl: string, env: Record<string, THREE.IUniform>, files: Files, signal: AbortSignal, camera?: THREE.Camera, particleBudget: ParticleBudget = { remaining: 12000 }, preserveParticleAlpha = true): Promise<SceneMotion> {
  const model = loadedModel(gltf, url), data = gltf.parser.json as SceneData;
  const players: ModelAnimation[] = [], releases: (() => void)[] = [], effects: THREE.Object3D[] = [];
  const platforms = setup.animations;
  const lifetimes: { root: THREE.Object3D; duration: number }[] = [];
  let time = 0;
  const billboards: { object: THREE.Object3D; up: boolean }[] = [];
  const collectBillboards = (source: LoadedModel): void => {
    for (const [index, node] of source.data.nodes.entries()) {
      const mode = /_Billboard(Camera|Up)$/i.exec(node.name ?? '');
      const object = source.nodes.get(index);
      if (mode && object) billboards.push({ object, up: mode[1].toLowerCase() === 'up' });
    }
  };
  collectBillboards(model);
  const facing = new THREE.Quaternion(), parentRotation = new THREE.Quaternion(), forward = new THREE.Vector3(), matrix = new THREE.Matrix4();
  const faceCamera = (): void => {
    if (!camera) return;
    for (const { object, up } of billboards) {
      camera.getWorldQuaternion(facing);
      if (up) {
        camera.getWorldDirection(forward); forward.y = 0;
        if (!forward.lengthSq()) continue;
        facing.setFromRotationMatrix(matrix.lookAt(new THREE.Vector3(), forward, new THREE.Vector3(0, 1, 0)));
      }
      object.parent?.getWorldQuaternion(parentRotation);
      object.quaternion.copy(object.parent ? parentRotation.invert().multiply(facing) : facing);
      object.updateWorldMatrix(false, true);
    }
  };
  let particles: Awaited<ReturnType<typeof sceneParticles>> | undefined;
  const dispose = (): void => { particles?.dispose(); players.forEach((p) => p.dispose()); releases.splice(0).forEach((release) => release()); };
  try {
    dressEffectAlpha(setup.dressing, preserveParticleAlpha);
    const dressed = new Set(setup.dressing.meshes);
    for (const info of data.extras?.automatic_clips ?? []) {
      signal.throwIfAborted();
      const animation = info.animation === undefined ? undefined : data.animations?.[info.animation];
      const material = info.material_clip === undefined ? undefined : data.extras?.material_clips?.[info.material_clip];
      const curves = animation?.extras?.float_curves ?? material?.float_curves ?? {};
      if (!animation?.channels.length && !Object.keys(curves).length) continue;
      const meshes = new Set<THREE.Mesh>();
      for (const curve of Object.values(curves)) for (const index of curve.renderer_nodes ?? (curve.node === undefined ? [] : [curve.node])) {
        model.nodes.get(index)?.traverse((object) => { if (object instanceof THREE.Mesh && dressed.has(object)) meshes.add(object); });
      }
      for (const mesh of meshes) await setup.dressing.unique(mesh);
      const parser = Object.create(gltf.parser) as GLTFParser;
      parser.json = { ...data, animations: animation ? [animation] : undefined, extras: { clip: { duration: info.duration }, material_clips: material ? [material] : [] } };
      parser.getDependency = gltf.parser.getDependency.bind(gltf.parser);
      const bound = { ...model, data: { ...model.data, extras: { ...model.data.extras, clips: { automatic: '#automatic' } } } };
      const player = new ModelAnimation(bound, async () => ({ ...gltf, parser }), gltf.scene, ['automatic']);
      players.push(player);
      await player.play('automatic');
    }
    platforms?.update(0);
    for (const entry of data.extras?.effects ?? []) {
      signal.throwIfAborted();
      const parent = model.nodes.get(entry.node);
      if (!parent) continue;
      const href = new URL(`${baseUrl}/${entry.model}`, location.href).href;
      const effect = await loadGlb(href, files);
      releases.push(effect.release);
      let child: SceneSetup;
      try { child = await setUpScene(effect.gltf, { env, grass: false, animate: false }); }
      catch (error) { disposeTree(effect.gltf.scene); throw error; }
      setup.adopt(child);
      const item = loadedModel(effect.gltf, href);
      collectBillboards(item);
      const root = item.nodes.get(0);
      if (root) { root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1); }
      parent.add(child.root);
      effects.push(child.root);
      if (entry.lifetime !== undefined) lifetimes.push({ root: child.root, duration: entry.lifetime });
      child.root.traverse((object) => { object.userData.ffEffect = true; });
      dressFusionMatter(child.dressing, env); repairWrenchAlpha(child.dressing);
      dressEffectAlpha(child.dressing, preserveParticleAlpha);
      // Animated layers may share a source material but have different UV curves.
      if (entry.animations.length) for (const mesh of child.dressing.meshes) await child.dressing.unique(mesh);
      for (const name of entry.animations) {
        const player = new ModelAnimation(item, async (file) => { const clip = await loadGlb(file, files); releases.push(clip.release); return clip.gltf; }, child.root, [name]);
        players.push(player);
        await player.play(name);
      }
    }
    particles = await sceneParticles(gltf, signal, particleBudget, preserveParticleAlpha);
    effects.push(...particles.roots);
    signal.throwIfAborted();
    return {
      effects,
      moving: particles.roots.length > 0 || (platforms?.platforms ?? 0) > 0 || players.some((p) => p.playback.duration > 0),
      update(delta, drift) { time += delta; for (const player of players) if (player.playback.duration > 0) player.update(delta); platforms?.update(delta); for (const item of lifetimes) item.root.visible = time < item.duration; faceCamera(); particles?.update(delta, camera, drift); },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
