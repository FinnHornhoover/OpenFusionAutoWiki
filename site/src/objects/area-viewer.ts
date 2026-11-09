import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEnvironment, applySceneSettings } from 'ff-three';
import { streamFiles } from './stream-files';
import type { AreaPopulation, AreaPreviewRecipe, PopulationKind } from '../../../shared/objects';
import { loadAreaTile, type AreaTile } from './area-tile';
import { focusPopulation } from './area-camera';
import { areaPopulation, type PopulationLayer, type PopulationSelection } from './area-population';

export interface AreaViewer {
  reset(): void;
  overhead(): void;
  scenery(visible: boolean): void;
  grass(visible: boolean): void;
  effects(visible: boolean): void;
  pause(paused: boolean): void;
  population(kind: PopulationKind, show: boolean): void;
  focus?(x: number, z: number): void;
  dispose(): void;
}

export async function mountAreaViewer(container: HTMLElement, recipe: AreaPreviewRecipe, baseUrl: string, signal: AbortSignal, onStatus: (status: string) => void, populationUrl: string, onSelection: (value: PopulationSelection | null) => void): Promise<AreaViewer> {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', 'Interactive area preview. Drag to rotate, scroll to zoom, or use two fingers to pan.');
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20000);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.screenSpacePanning = false;
  orbit.maxPolarAngle = Math.PI * 0.49;
  orbit.minDistance = 5;
  const env = createEnvironment();
  const smallScreen = matchMedia('(max-width: 600px)').matches;
  const files = streamFiles(signal, (smallScreen ? 32 : 96) * 1024 * 1024, 6);
  const particleBudget = { remaining: smallScreen ? 4000 : 12000, systems: smallScreen ? 64 : 160 };
  const tiles: AreaTile[] = [];
  let disposed = false, visible = true, frame = 0, previous = 0, lastRendered = 0, hasMotion = false;
  let paused = false, forceDraw = true;
  let population: PopulationLayer | undefined;
  let resize: ResizeObserver | undefined, intersection: IntersectionObserver | undefined;
  let visibility = (): void => {};

  const dispose = (): void => {
    if (!disposed) {
      disposed = true;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      intersection?.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      orbit.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      signal.removeEventListener('abort', dispose);
    }
    population?.dispose();
    tiles.forEach((tile) => tile.dispose());
    files.dispose();
  };
  signal.addEventListener('abort', dispose, { once: true });

  try {
    for (const [index, file] of recipe.tiles.entries()) {
      onStatus(`Loading tile ${index + 1} of ${recipe.tiles.length}…`);
      const tile = await loadAreaTile(file, baseUrl, env, files, signal, camera, particleBudget, { grass: true, effects: true });
      tiles.push(tile);
      if (disposed || signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { setup } = tile;
      scene.add(setup.root);
      const fog = applySceneSettings(env, setup.settings);
      scene.background = new THREE.Color().fromArray(fog);
      hasMotion ||= setup.dressing.meshes.some((mesh) => ['water', 'fusion', 'vfx'].includes(mesh.userData.ffInfo?.family));
      hasMotion ||= !!tile.motion?.moving || !!setup.root.getObjectByName('grass');
    }
    if (!tiles.length) throw new Error('No area tiles are available');
    scene.updateMatrixWorld(true);
    const [x0, z0, x1, z1] = recipe.bounds;
    const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
    const groundAt = (px: number, pz: number): number => {
      for (const { setup } of tiles) { const height = setup.heightAt(px, pz); if (Number.isFinite(height)) return height; }
      return -62;
    };
    const ground = groundAt(x, z);
    const span = Math.max(x1 - x0, z1 - z0, 1);
    camera.far = Math.max(20000, span * 12);
    orbit.maxDistance = span * 6;
    env.fogDensity.value = 0.35 / span;
    const size = (): void => {
      const width = container.clientWidth || 1, height = container.clientHeight || 1;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    size();
    const reset = (): void => {
      const distance = span / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(camera.aspect, 1) * 0.65;
      orbit.target.set(x, ground, z);
      camera.position.set(x, ground + distance * 0.8, z - distance);
      orbit.update();
      invalidate();
    };
    const draw = (time: number): void => {
      frame = 0;
      if (disposed) return;
      if (forceDraw || !lastRendered || time - lastRendered >= 32 || !hasMotion) {
        const delta = previous ? Math.min((time - previous) / 1000, 0.1) : 0;
        previous = time;
        if (!paused) { env.time.value += delta; tiles.forEach((tile) => tile.motion?.update(delta)); }
        else tiles.forEach((tile) => tile.motion?.update(0));
        population?.update(paused ? 0 : delta);
        renderer.render(scene, camera);
        lastRendered = time;
        forceDraw = false;
      }
      if (!frame && visible && !document.hidden && hasMotion && !paused) frame = requestAnimationFrame(draw);
    };
    const invalidate = (): void => { forceDraw = true; if (!frame && !disposed) frame = requestAnimationFrame(draw); };
    onStatus('Loading NPC, monster and egg placements…');
    const response = await fetch(populationUrl, { signal });
    if (!response.ok) throw new Error(`Area placements failed (${response.status})`);
    const data = await response.json() as AreaPopulation;
    signal.throwIfAborted();
    population = areaPopulation(data, scene, camera, renderer.domElement, baseUrl, env, signal, files, invalidate, (point) => {
      focusPopulation(point, camera, orbit, tiles.map((tile) => tile.setup.root));
      invalidate();
    }, onSelection);
    hasMotion ||= data.placements.length > 0;
    orbit.addEventListener('change', invalidate);
    reset();
    resize = new ResizeObserver(() => { size(); invalidate(); });
    resize.observe(container);
    intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; previous = 0; if (visible) invalidate(); });
    intersection.observe(container);
    visibility = () => { previous = 0; if (!document.hidden) invalidate(); };
    document.addEventListener('visibilitychange', visibility);
    return {
      reset,
      overhead: () => { orbit.target.set(x, ground, z); camera.position.set(x, ground + span / Math.min(camera.aspect, 1) * 1.4, z - 0.01); orbit.update(); invalidate(); },
      scenery: (show) => {
        for (const { setup } of tiles) setup.root.traverse((object) => { if (object instanceof THREE.Mesh && !object.userData.terrain && !object.userData.ffGrass && !object.userData.ffEffect) object.visible = show; });
        invalidate();
      },
      grass: (show) => { tiles.forEach(({ setup }) => setup.root.traverse((object) => { if (object.userData.ffGrass) object.visible = show; })); invalidate(); },
      effects: (show) => { tiles.forEach(({ motion }) => motion?.effects.forEach((root) => { root.visible = show; })); invalidate(); },
      population: (kind, show) => population?.toggle(kind, show),
      pause: (value) => { paused = value; previous = 0; invalidate(); },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
