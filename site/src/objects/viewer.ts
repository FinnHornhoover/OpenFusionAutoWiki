import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEnvironment } from 'ff-three';
import type { AnimationChoice, ModelPart, PreviewVariant } from '../../../shared/objects';
import { animationChoices, preferredAnimation } from '../../../shared/animations.js';
import { compose, disposeTexture, disposeTree, dressModel, loadModel, type LoadedModel } from './assets';
import { ModelAnimation } from './animation';

const LOOP_DELAY = 0.2;

export interface Viewer {
  animations: AnimationChoice[];
  hasMotion: boolean;
  selected: string;
  play(name: string): Promise<void>;
  pause(paused: boolean): void;
  seek(time: number): void;
  reset(): void;
  dispose(): void;
}

export interface PlaybackState {
  time: number;
  duration: number;
  paused: boolean;
}

interface ViewerOptions {
  paused?: boolean;
  onPlayback?: (state: PlaybackState) => void;
}

export async function mountViewer(container: HTMLElement, variant: PreviewVariant, baseUrl: string, signal: AbortSignal, options: ViewerOptions = {}): Promise<Viewer> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D preview. Drag to rotate; scroll to zoom.');
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  const env = createEnvironment();
  const models: LoadedModel[] = [];
  const textures = new Set<THREE.Texture>();
  const animations: ModelAnimation[] = [];
  let disposed = false;
  let paused = options.paused ?? false;
  let lastReported = 0;
  let visible = true;
  let frame = 0;
  let previous = 0;
  let resize: ResizeObserver | undefined;
  let intersection: IntersectionObserver | undefined;
  let visibility = (): void => {};
  const clipCache = new Map<string, Promise<GLTF>>();
  const loader = new GLTFLoader();

  const dispose = (): void => {
    if (!disposed) {
      disposed = true;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      intersection?.disconnect();
      controls.dispose();
      document.removeEventListener('visibilitychange', visibility);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      signal.removeEventListener('abort', dispose);
    }
    // A decode already in progress may finish after cancellation. Revisit
    // resources on that path so late materials/textures are released too.
    animations.forEach((animation) => animation.dispose());
    models.forEach((model) => { model.dressing?.dispose(); disposeTree(model.gltf.scene); });
    for (const texture of textures) disposeTexture(texture);
  };
  signal.addEventListener('abort', dispose, { once: true });

  const load = async (key: string): Promise<LoadedModel> => {
    const model = await loadModel(new URL(`${baseUrl}/${key}`, location.href).href, signal);
    if (disposed) { disposeTree(model.gltf.scene); throw new DOMException('Aborted', 'AbortError'); }
    models.push(model);
    return model;
  };
  const loadClip = (url: string): Promise<GLTF> => {
    let promise = clipCache.get(url);
    if (!promise) {
      promise = fetch(url, { signal }).then(async (response) => {
        if (!response.ok) throw new Error(`Animation download failed (${response.status})`);
        return loader.parseAsync(await response.arrayBuffer(), new URL('.', url).href);
      }).catch((error: unknown) => { clipCache.delete(url); throw error; });
      clipCache.set(url, promise);
    }
    return promise;
  };

  try {
    const actor = await load(variant.model.model);
    actor.gltf.scene.scale.setScalar(variant.scale ?? 1);
    await dressModel(actor, variant.model, variant, baseUrl, env, textures);
    scene.add(actor.gltf.scene);
    const vehicles: { part: ModelPart; model: LoadedModel }[] = [];
    const attach = async (garment: LoadedModel, part: ModelPart): Promise<void> => {
      compose(actor, garment, part, variant);
      if (part.mode === 'attached' && part.autoAnimation !== null) {
        const animation = new ModelAnimation(garment, loadClip, actor.gltf.scene);
        animations.push(animation);
        const name = part.autoAnimation ?? animation.names.find((n) => n === 'nif-default') ?? animation.names[0];
        if (name) await animation.play(name);
      }
    };
    for (const part of variant.parts ?? []) {
      const garment = await load(part.model);
      await dressModel(garment, part, variant, baseUrl, env, textures);
      if (part.mount === 'vehicle') vehicles.push({ part, model: garment });
      else await attach(garment, part);
    }
    const context = variant.animationContext ?? { kind: variant.gender ? 'avatar' : 'creature' };
    const choices = variant.animations ?? animationChoices(Object.keys(actor.data.extras?.clips ?? {}).map((name) => ({ name, duration: 1 })), context);
    const animation = new ModelAnimation(actor, loadClip, actor.gltf.scene, choices.map((choice) => choice.name));
    animations.push(animation);
    const selected = preferredAnimation(choices, context, variant.idle);
    if (selected) await animation.play(selected);
    if (variant.height !== undefined) await animation.proportions('height', variant.height);
    if (variant.shape !== undefined) await animation.proportions('shape', variant.shape);
    animation.update(0);
    for (const vehicle of vehicles) await attach(vehicle.model, vehicle.part);
    if (disposed || signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const hasMotion = animations.some((item) => item.playback.duration > 0) || models.some((model) =>
      model.dressing?.meshes.some((mesh) => ['fusion', 'water'].includes(mesh.userData.ffInfo?.family)));

    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(actor.gltf.scene);
    if (bounds.isEmpty()) throw new Error('No visible geometry available');
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.1);
    const fitDistance = (): number => {
      const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      return (Math.max(size.y / (2 * halfFov), size.x / (2 * halfFov * camera.aspect)) + size.z / 2) * 1.15;
    };
    let lastFit = fitDistance();
    const reset = (): void => {
      lastFit = fitDistance();
      controls.target.copy(center);
      camera.position.set(center.x, center.y + radius * 0.08, center.z + lastFit);
      camera.near = radius / 1000;
      camera.far = radius * 100;
      camera.updateProjectionMatrix();
      controls.minDistance = radius * 0.3;
      controls.maxDistance = radius * 8;
      controls.update();
      renderer.render(scene, camera);
    };
    reset();
    const report = (): void => options.onPlayback?.({ ...animation.playback, paused });
    const seek = (time: number): void => {
      animation.seek(time);
      for (const item of animations) if (item !== animation) item.seek(item.playback.duration > 0 ? time % item.playback.duration : 0);
      env.time.value = animation.playback.time;
      previous = 0;
      report();
    };
    const draw = (time: number): void => {
      if (disposed) return;
      frame = 0;
      const delta = previous ? Math.min((time - previous) / 1000, 0.1) : 0;
      previous = time;
      if (!paused) {
        animations.forEach((item) => item.update(delta, item === animation ? LOOP_DELAY : 0));
        env.time.value += delta;
      }
      renderer.render(scene, camera);
      if (time - lastReported >= 100 || paused) { report(); lastReported = time; }
      if (visible && !document.hidden && !paused && hasMotion) frame = requestAnimationFrame(draw);
    };
    const invalidate = (): void => { if (!frame && !disposed) frame = requestAnimationFrame(draw); };
    controls.addEventListener('change', invalidate);
    resize = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const nextFit = fitDistance();
      camera.position.sub(controls.target).multiplyScalar(nextFit / lastFit).add(controls.target);
      lastFit = nextFit;
      controls.update();
      invalidate();
    });
    resize.observe(container);
    intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; previous = 0; if (visible) invalidate(); });
    intersection.observe(container);
    visibility = (): void => { previous = 0; if (!document.hidden) invalidate(); };
    document.addEventListener('visibilitychange', visibility);
    invalidate();
    report();
    return {
      animations: choices, selected, hasMotion,
      play: (name) => animation.play(name).then((changed) => { if (changed) { seek(0); invalidate(); } }),
      seek: (time) => { seek(time); invalidate(); },
      pause: (value) => {
        paused = value;
        previous = 0;
        report();
        invalidate();
      },
      reset, dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
