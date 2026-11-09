import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { previewOrbitControls } from './orbit-controls';
import { createEnvironment } from 'ff-three';
import type { AnimationChoice, ModelPart, PreviewVariant } from '../../../shared/objects';
import { animationChoices, preferredAnimation } from '../../../shared/animations.js';
import { compose, disposeTexture, disposeGltf, dressModel, loadModel, type LoadedModel } from './assets';
import { vehicleEffects, type VehicleEffects } from './vehicle-effects';
import { weaponEffects, type WeaponPlayback } from './weapon-effects';
import { ModelAnimation } from './animation';

export interface Viewer {
  animations: AnimationChoice[];
  hasMotion: boolean;
  selected: string;
  hasVehicleTrails: boolean;
  trails(show: boolean): void;
  play(name: string): Promise<void>;
  fire(index: number): Promise<void>;
  pause(paused: boolean): void;
  seek(time: number): void;
  reset(): void;
  getView(): ViewState;
  dispose(): void;
}

export interface ViewState {
  position: [number, number, number];
  target: [number, number, number];
}

export interface PlaybackState {
  time: number;
  duration: number;
  paused: boolean;
}

interface ViewerOptions {
  paused?: boolean;
  view?: ViewState;
  onPlayback?: (state: PlaybackState) => void;
}

export async function mountViewer(container: HTMLElement, variant: PreviewVariant, baseUrl: string, parentSignal: AbortSignal, options: ViewerOptions = {}): Promise<Viewer> {
  const controller = new AbortController();
  const signal = AbortSignal.any([parentSignal, controller.signal]);
  signal.throwIfAborted();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D preview. Drag to rotate; scroll to zoom.');
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  const controls = previewOrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  const env = createEnvironment();
  const models: LoadedModel[] = [];
  const textures = new Set<THREE.Texture>();
  const animations: ModelAnimation[] = [];
  let vehicle: VehicleEffects | undefined;
  let weapon: WeaponPlayback | undefined;
  let firePromise: Promise<void> | undefined;
  let fireOnce = false;
  let attackWindup = 0;
  let fireWait: { done(): boolean; resolve(): void; reject(error: unknown): void } | undefined;
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
      signal.removeEventListener('abort', dispose);
      controller.abort();
      fireWait?.reject(new DOMException('Aborted', 'AbortError')); fireWait = undefined;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      intersection?.disconnect();
      controls.dispose();
      document.removeEventListener('visibilitychange', visibility);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
    // A decode already in progress may finish after cancellation. Revisit
    // resources on that path so late materials/textures are released too.
    vehicle?.dispose();
    weapon?.dispose();
    animations.forEach((animation) => animation.dispose());
    models.forEach((model) => { model.dressing?.dispose(); disposeGltf(model.gltf); });
    for (const texture of textures) disposeTexture(texture);
  };
  signal.addEventListener('abort', dispose, { once: true });

  const load = async (key: string): Promise<LoadedModel> => {
    const model = await loadModel(new URL(`${baseUrl}/${key}`, location.href).href, signal);
    if (disposed) { disposeGltf(model.gltf); throw new DOMException('Aborted', 'AbortError'); }
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
    signal.throwIfAborted();
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
      signal.throwIfAborted();
      if (part.mount === 'vehicle') vehicles.push({ part, model: garment });
      else await attach(garment, part);
    }
    const context = variant.animationContext ?? { kind: variant.gender ? 'avatar' : 'creature' };
    const choices = variant.animations ?? animationChoices(Object.keys(actor.data.extras?.clips ?? {}).map((name) => ({ name, duration: 1 })), context);
    const animation = new ModelAnimation(actor, loadClip, actor.gltf.scene, [...new Set([...choices.map((choice) => choice.name), ...Object.values(variant.weaponAttack ?? {}).filter((name): name is string => !!name)])]);
    animations.push(animation);
    let selected = preferredAnimation(choices, context, variant.idle);
    const vehicleMovement = (): number => {
      if (!context.vehicle || choices.find((choice) => choice.name === selected)?.group !== 'Movement') return 0;
      return /runback|swimback/.test(selected) ? -1 : 1;
    };
    if (selected) await animation.play(selected);
    if (variant.height !== undefined) await animation.proportions('height', variant.height);
    if (variant.shape !== undefined) await animation.proportions('shape', variant.shape);
    animation.update(0);
    for (const vehicle of vehicles) await attach(vehicle.model, vehicle.part);
    if (disposed || signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const hasMotion = !!variant.weaponShots?.length || animations.some((item) => item.playback.duration > 0) || models.some((model) =>
      model.dressing?.meshes.some((mesh) => ['fusion', 'water', 'vfx'].includes(mesh.userData.ffInfo?.family)));

    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(actor.gltf.scene);
    if (bounds.isEmpty()) throw new Error('No visible geometry available');
    const actorHeight = bounds.getSize(new THREE.Vector3()).y;
    const viewDistance = actorHeight * 1.3;
    if (variant.weaponShots?.length) {
      const destination = actor.gltf.scene.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, actorHeight * 0.5, viewDistance));
      bounds.expandByPoint(destination);
      const equipped = models.find((model) => model.url === new URL(`${baseUrl}/${variant.parts?.find((part) => part.slot === 'weapon')?.model}`, location.href).href);
      let fallback: THREE.Object3D | undefined;
      const findMount = (name: string): THREE.Object3D | undefined => {
        for (const model of [...models].reverse()) {
          const index = model.data.nodes.findIndex((node) => node.name?.toLowerCase() === name.toLowerCase());
          const node = model.nodes.get(index);
          if (!node) continue;
          let parent: THREE.Object3D | null = node;
          while (parent && parent !== actor.gltf.scene) parent = parent.parent;
          if (parent) return node;
        }
        if (!equipped || !/^gtag01$/i.test(name)) return undefined;
        if (fallback) return fallback;
        const root = equipped.nodes.get(0);
        if (!root) return undefined;
        root.updateWorldMatrix(true, true);
        const inverse = root.matrixWorld.clone().invert(), box = new THREE.Box3(), point = new THREE.Vector3();
        for (const mesh of equipped.dressing?.meshes ?? []) {
          mesh.updateWorldMatrix(true, false);
          const transform = inverse.clone().multiply(mesh.matrixWorld), positions = mesh.geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) box.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(transform));
        }
        if (box.isEmpty()) return undefined;
        const forward = new THREE.Vector3(0, 0, 1).transformDirection(actor.gltf.scene.matrixWorld).transformDirection(inverse);
        const tip = new THREE.Ray(box.getCenter(new THREE.Vector3()), forward).intersectBox(box, new THREE.Vector3());
        if (!tip) return undefined;
        fallback = new THREE.Object3D(); fallback.name = 'preview-muzzle'; fallback.position.copy(tip); root.add(fallback);
        return fallback;
      };
      weapon = weaponEffects(scene, actor.gltf.scene, variant.weaponShots, findMount, baseUrl, env, camera, signal, equipped?.nodes.get(0));
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.1);
    const fitDistance = (): number => {
      const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      return (Math.max(size.y / (2 * halfFov), size.x / (2 * halfFov * camera.aspect)) + size.z / 2) * 1.15;
    };
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    let lastFit = fitDistance();
    const reset = (): void => {
      lastFit = fitDistance();
      controls.target.copy(center);
      camera.position.set(center.x + (weapon || variant.vehicleEffects?.length ? lastFit * 0.55 : 0), center.y + radius * 0.08, center.z + lastFit);
      camera.near = radius / 1000;
      camera.far = radius * 100;
      camera.updateProjectionMatrix();
      controls.minDistance = radius * 0.3;
      controls.maxDistance = radius * 8;
      controls.update();
      renderer.render(scene, camera);
    };
    reset();
    if (options.view) {
      controls.target.fromArray(options.view.target);
      camera.position.fromArray(options.view.position);
      const distance = camera.position.distanceTo(controls.target);
      controls.minDistance = Math.min(controls.minDistance, distance);
      controls.maxDistance = Math.max(controls.maxDistance, distance);
      controls.update();
      renderer.render(scene, camera);
    }
    if (variant.vehicleEffects?.length) {
      vehicle = await vehicleEffects(vehicles.map((entry) => entry.model), variant.vehicleEffects, actor.gltf.scene, actorHeight * 3, baseUrl, env, camera, signal);
      if (disposed || signal.aborted) { vehicle.dispose(); throw new DOMException('Aborted', 'AbortError'); }
    }
    const waitForFire = (done: () => boolean): Promise<void> => {
      if (disposed) return Promise.reject(new DOMException('Aborted', 'AbortError'));
      if (done()) return Promise.resolve();
      return new Promise((resolve, reject) => { fireWait = { done, resolve, reject }; });
    };
    const assertLive = (): void => { if (disposed) throw new DOMException('Aborted', 'AbortError'); };
    const fire = async (index: number): Promise<void> => {
      const shot = variant.weaponShots?.[index];
      if (!weapon || !shot) return;
      const saved = { name: selected, time: animation.playback.time, paused };
      const attachedTimes = animations.map((item) => item.playback.time);
      const attack = variant.weaponAttack ?? {};
      const moving = choices.find((choice) => choice.name === selected)?.group === 'Movement';
      const full = /stand|ready/.test(selected) || !attack.upper ? attack.full : undefined;
      paused = true; report();

      try {
        await animation.prepare([full, attack.upper, attack.ready, saved.name].filter((name): name is string => !!name));
        assertLive();
        await weapon.fire(index);
        assertLive();
        if (full) {
          await animation.play(full, 0.15);
          animation.speed = shot.cooldown > 0 && shot.cooldown < animation.playback.duration ? shot.cooldown / animation.playback.duration : 1;
        }
        if (attack.upper) {
          const duration = await animation.clipDuration(attack.upper);
          const speed = shot.cooldown > 0 && shot.cooldown < duration ? shot.cooldown / duration * 0.9 : 1;
          await animation.playUpper(attack.upper, speed);
        }
        assertLive();
        fireOnce = !!full;
        // Longer pistol launch delays belong before recoil, not inside it.
        attackWindup = context.weapon === 'pistol' && shot.flight.kind === 'ordinary' ? Math.max(0, shot.flight.delay - 0.1) : 0;
        paused = false; previous = 0; invalidate();
        await waitForFire(() => (!full || animation.playback.time >= animation.playback.duration) && animation.upperPlayback.time >= animation.upperPlayback.duration);
        assertLive();

        paused = true;
        animation.stopUpper(0.15);
        animation.speed = 1;
        if (!moving && attack.ready) await animation.play(attack.ready, 0.15);
        assertLive();
        fireOnce = false;
        paused = false; previous = 0; invalidate();
        await waitForFire(() => !weapon!.active);
      } finally {
        fireOnce = false;
        attackWindup = 0;
        animation.speed = 1;
        animation.stopUpper();
        if (!disposed) {
          weapon.clear(); paused = true;
          try {
            if (saved.name) await animation.play(saved.name);
            assertLive();
            animation.seek(saved.time);
            animations.forEach((item, i) => { if (item !== animation) item.seek(attachedTimes[i]); });
          } finally {
            if (!disposed) { paused = saved.paused; previous = 0; report(); invalidate(); }
          }
        }
      }
    };
    const report = (): void => options.onPlayback?.({ ...animation.playback, paused });
    const seek = (time: number): void => {
      weapon?.clear();
      animation.seek(time);
      for (const item of animations) if (item !== animation) item.seek(item.playback.duration > 0 ? time % item.playback.duration : 0);
      env.time.value = animation.playback.time;
      previous = 0;
      report();
    };
    const advance = (delta: number): void => {
      const attackDelta = delta - Math.min(delta, attackWindup);
      attackWindup = Math.max(0, attackWindup - delta);
      for (const item of animations) {
        if (item === animation) item.update(fireOnce ? attackDelta : delta, !fireOnce, attackDelta);
        else item.update(delta);
      }
      env.time.value += delta;
      vehicle?.update(delta, vehicleMovement());
      weapon?.update(delta);
    };
    const draw = (time: number): void => {
      if (disposed) return;
      frame = 0;
      const delta = previous ? Math.min((time - previous) / 1000, 0.1) : 0;
      previous = time;
      if (!paused) {
        // Split launch and hit events so animation sampling does not depend on frame rate.
        let remaining = delta;
        for (let events = 0; events < 4; events++) {
          const event = weapon?.eventIn;
          if (event === undefined || event > remaining) break;
          advance(event); remaining = Math.max(0, remaining - event);
        }
        advance(remaining);
        if (fireWait?.done()) { const waiting = fireWait; fireWait = undefined; waiting.resolve(); }
      } else { vehicle?.update(0, vehicleMovement()); weapon?.update(0); }
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
      hasVehicleTrails: !!vehicle?.count, trails: (show) => { vehicle?.visible(show); invalidate(); },
      animations: choices, get selected() { return selected; }, hasMotion,
      fire: (index) => {
        if (!firePromise) firePromise = fire(index).finally(() => { firePromise = undefined; });
        return firePromise;
      },
      play: async (name) => {
        if (firePromise) return;
        const changed = await animation.play(name);
        if (changed) { selected = name; seek(0); invalidate(); }
      },
      seek: (time) => { if (!firePromise) { seek(time); invalidate(); } },
      pause: (value) => {
        if (firePromise) return;
        paused = value;
        previous = 0;
        report();
        invalidate();
      },
      getView: () => ({ position: camera.position.toArray(), target: controls.target.toArray() }),
      reset, dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
