import * as THREE from 'three';
import { createFiles, loadGlb, setUpScene, type SceneSetup } from 'ff-three/world';
import type { WeaponShot } from '../../../shared/objects';
import { sceneMotion, type SceneMotion } from './scene-motion';
import { disposeTree } from './assets';
import { WeaponFlight } from './weapon-flight';

interface Effect {
  root: THREE.Group;
  setup: SceneSetup;
  motion: SceneMotion;
  release(): void;
  kind: 'muzzle' | 'projectile' | 'impact';
  duration: number;
  borrowed: THREE.Object3D[];
}
export interface WeaponPlayback {
  readonly active: boolean;
  readonly eventIn: number | undefined;
  fire(index: number): Promise<void>;
  update(delta: number): void;
  clear(): void;
  dispose(): void;
}

export function weaponEffects(scene: THREE.Scene, actor: THREE.Object3D, shots: WeaponShot[], findMount: (name: string) => THREE.Object3D | undefined, baseUrl: string, env: Record<string, THREE.IUniform>, camera: THREE.Camera, signal: AbortSignal, equipped?: THREE.Object3D): WeaponPlayback {
  const files = createFiles({ concurrency: 4, fetchBytes: async (url: string) => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Weapon effect download failed (${response.status})`);
    return response.arrayBuffer();
  } });
  const effects: Effect[] = [], origin = new THREE.Vector3(), forward = new THREE.Vector3(), rotation = new THREE.Quaternion();
  let controller: AbortController | undefined, generation = 0, elapsed = 0, current: WeaponShot | undefined, disposed = false;
  let flight: WeaponFlight | undefined, impactAt: number | undefined;

  const remove = (effect: Effect): void => {
    effect.borrowed.forEach((root) => root.removeFromParent());
    effect.root.removeFromParent(); effect.motion.dispose(); effect.setup.dispose(); disposeTree(effect.setup.root); effect.release();
  };
  const clear = (): void => {
    generation++; controller?.abort(); controller = undefined; effects.splice(0).forEach(remove);
    current = undefined; flight = undefined; impactAt = undefined;
  };
  const dispose = (): void => { if (disposed) return; disposed = true; clear(); files.forget(); signal.removeEventListener('abort', dispose); };
  signal.addEventListener('abort', dispose, { once: true });

  const launch = (shot: WeaponShot): void => {
    actor.updateWorldMatrix(true, true);
    actor.getWorldPosition(origin);
    forward.set(0, 0, 1).transformDirection(actor.matrixWorld);
    const mount = shot.flight.kind === 'grenade' ? undefined : findMount(shot.flight.kind === 'rocket' ? 'Gtag01' : shot.link);
    flight = new WeaponFlight(shot, origin, forward, mount?.getWorldPosition(new THREE.Vector3()));
    if (mount) mount.getWorldQuaternion(rotation); else rotation.copy(flight.rotation);
    for (const effect of effects) {
      effect.root.position.copy(flight.position);
      effect.root.quaternion.copy(effect.kind === 'muzzle' ? rotation : flight.rotation);
    }
  };

  return {
    get active() { return current !== undefined; },
    get eventIn() {
      if (!current) return undefined;
      const delay = current.flight.kind === 'ordinary' ? current.flight.delay : 0;
      if (!flight) return Math.max(0, delay - elapsed);
      return impactAt === undefined ? Math.max(0, delay + current.flight.duration - elapsed) : undefined;
    },
    async fire(index) {
      clear(); signal.throwIfAborted();
      if (disposed) throw new DOMException('Aborted', 'AbortError');
      const shot = shots[index];
      if (!shot) return;
      const version = generation, pending = new AbortController(); controller = pending;
      try {
        for (const [kind, entry] of [['muzzle', shot.fire], ['projectile', shot.projectile], ['impact', shot.impact]] as const) {
          if (!entry) continue;
          const url = new URL(`${baseUrl}/${entry.model}`, location.href).href, loaded = await loadGlb(url, files);
          if (version !== generation || signal.aborted) { disposeTree(loaded.gltf.scene); loaded.release(); throw new DOMException('Aborted', 'AbortError'); }
          let setup: SceneSetup | undefined, motion: SceneMotion | undefined;
          const root = new THREE.Group(); root.name = `weapon-${kind}`; root.visible = false;
          try {
            setup = await setUpScene(loaded.gltf, { env, grass: false, animate: true });
            pending.signal.throwIfAborted();
            root.add(setup.root); scene.add(root); root.updateMatrixWorld(true);
            motion = await sceneMotion(loaded.gltf, setup, url, baseUrl, env, files, pending.signal, camera, { remaining: 2000, systems: 24 }, false);
            pending.signal.throwIfAborted();
            const effect: Effect = { root, setup, motion, release: loaded.release, kind, duration: entry.duration, borrowed: [] };
            if (kind === 'projectile' && shot.flight.kind === 'grenade' && shot.flight.weaponModel && equipped) {
              let old: THREE.Mesh | undefined;
              for (const child of motion.effects) child.traverse((node) => { if (!old && node instanceof THREE.Mesh) old = node; });
              if (old?.parent) {
                const holder = new THREE.Group(), replacement = equipped.clone(true);
                holder.name = 'thrown-weapon'; holder.position.copy(old.position); holder.quaternion.copy(old.quaternion); holder.scale.copy(old.scale).multiplyScalar(0.1);
                replacement.position.set(0, 0, 0); replacement.quaternion.identity(); replacement.scale.setScalar(25);
                holder.add(replacement); old.parent.add(holder); old.visible = false; effect.borrowed.push(holder);
              }
            }
            effects.push(effect);
          } catch (error) { root.removeFromParent(); motion?.dispose(); setup?.dispose(); disposeTree(loaded.gltf.scene); loaded.release(); throw error; }
        }
        current = shot; elapsed = 0;
      } catch (error) { if (generation === version) { clear(); files.forget(); } throw error; }
    },
    update(delta) {
      if (!current) return;
      const delay = current.flight.kind === 'ordinary' ? current.flight.delay : 0;
      const before = Math.max(0, elapsed - delay);
      elapsed += delta;
      const time = elapsed - delay;
      if (time < 0) return;
      if (!flight) launch(current);
      const path = flight!;
      path.advance(Math.max(0, Math.min(time, current.flight.duration) - before));
      if (time >= current.flight.duration && impactAt === undefined) {
        impactAt = current.flight.duration;
        for (const effect of effects) if (effect.kind === 'impact') { effect.root.position.copy(path.position); effect.root.quaternion.identity(); }
      }
      let active = impactAt === undefined;
      for (const effect of effects) {
        const age = effect.kind === 'impact' ? impactAt === undefined ? -1 : time - impactAt : time;
        effect.root.visible = age >= 0 && (effect.kind === 'projectile' ? impactAt === undefined : age <= effect.duration);
        if (!effect.root.visible) continue;
        active = true;
        if (effect.kind === 'projectile') effect.root.position.copy(path.position);
        const step = Math.max(0, age - Math.max(0, effect.kind === 'impact' ? before - (impactAt ?? 0) : before));
        effect.root.updateMatrixWorld(true); effect.motion.update(step);
      }
      if (!active) clear();
    },
    clear, dispose,
  };
}
