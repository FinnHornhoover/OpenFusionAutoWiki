import * as THREE from 'three';
import { previewOrbitControls } from './orbit-controls';
import { createEnvironment, applySceneSettings } from 'ff-three';
import type { AreaPopulation, WorldPreviewRecipe, WorldTile } from '../../../shared/objects';
import type { AreaViewer } from './area-viewer';
import { areaPopulation, type PopulationSelection } from './area-population';
import { loadAreaTile, type AreaTile } from './area-tile';
import { streamFiles } from './stream-files';
import { focusPopulation } from './area-camera';

export interface WorldView {
  recipe: WorldPreviewRecipe;
  focus: [number, number];
  populationBase: string;
}

const distance = (tile: WorldTile, x: number, z: number): number => {
  const [x0, z0, x1, z1] = tile.bounds;
  return Math.max(x0 - x, 0, x - x1) ** 2 + Math.max(z0 - z, 0, z - z1) ** 2;
};

export async function mountWorldViewer(container: HTMLElement, view: WorldView, baseUrl: string, signal: AbortSignal, onStatus: (status: string) => void, onSelection: (value: PopulationSelection | null) => void): Promise<AreaViewer> {
  const mobile = matchMedia('(max-width: 600px)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D world map. Drag to rotate, right-drag or use two fingers to pan.');
  container.append(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000);
  const orbit = previewOrbitControls(camera, renderer.domElement);
  orbit.screenSpacePanning = false; orbit.maxPolarAngle = Math.PI * 0.48;
  orbit.minDistance = 5; orbit.maxDistance = mobile ? 800 : 1100;
  const env = createEnvironment();
  const files = streamFiles(signal, (mobile ? 32 : 96) * 1024 * 1024);
  const budget = { remaining: mobile ? 2000 : 6000, systems: mobile ? 32 : 80 };
  const terrain = new Map<string, { tile: AreaTile; population: AreaPopulation }>();
  const pending = new Map<string, AbortController>(), failed = new Set<string>();
  const flags = { scenery: !mobile, grass: false, effects: false };
  let detail: { id: string; key: string; tile: AreaTile } | undefined;
  let wanted: WorldTile[] = [], wantedDetail = '';
  let frame = 0, previous = 0, lastDraw = 0, disposed = false, visible = true, paused = false, dirty = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: ResizeObserver | undefined, intersection: IntersectionObserver | undefined;
  let anchored = true, targetX = NaN, targetZ = NaN;
  let lightingTile = '';
  const population = areaPopulation({ models: {}, placements: [] }, scene, camera, renderer.domElement, baseUrl, env, signal, files, invalidate, (point) => {
    anchored = false; targetX = point.x; targetZ = point.z;
    focusPopulation(point, camera, orbit, [...terrain.values()].map((entry) => entry.tile.setup.root).concat(detail ? [detail.tile.setup.root] : []));
    invalidate();
  }, onSelection);

  function invalidate(): void { dirty = true; if (!frame && !disposed && visible && !document.hidden) frame = requestAnimationFrame(draw); }
  function draw(time: number): void {
    frame = 0;
    if (disposed) return;
    if (dirty || time - lastDraw >= (mobile ? 50 : 32)) {
      const delta = previous ? Math.min((time - previous) / 1000, 0.1) : 0;
      previous = time;
      if (!paused) env.time.value += delta;
      detail?.tile.motion?.update(paused ? 0 : delta);
      population.update(paused ? 0 : delta);
      renderer.render(scene, camera); dirty = false; lastDraw = time;
    }
    if (!frame && !paused && (detail?.tile.moving || population.moving) && visible && !document.hidden) frame = requestAnimationFrame(draw);
  }
  function groundAt(x: number, z: number): number {
    for (const { tile } of terrain.values()) { const y = tile.setup.heightAt(x, z); if (Number.isFinite(y)) return y; }
    return NaN;
  }
  function anchorGround(): void {
    const y = groundAt(orbit.target.x, orbit.target.z);
    if (!anchored || !Number.isFinite(y)) return;
    camera.position.y += y - orbit.target.y; orbit.target.y = y;
  }
  function updatePopulation(): void {
    const models: AreaPopulation['models'] = {}, placements = new Map<string, AreaPopulation['placements'][number]>();
    for (const entry of terrain.values()) {
      Object.assign(models, entry.population.models);
      entry.population.placements.forEach((p) => placements.set(p.id, p));
    }
    population.replace({ models, placements: [...placements.values()] });
  }
  function removeDetail(): void {
    if (!detail) return;
    const entry = terrain.get(detail.id);
    if (entry) entry.tile.setup.root.visible = true;
    scene.remove(detail.tile.setup.root); detail.tile.dispose(); detail = undefined;
  }
  function layers(tile: AreaTile): void {
    tile.setup.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData.terrain) return;
      object.visible = object.userData.ffGrass ? flags.grass : object.userData.ffEffect ? flags.effects : flags.scenery;
    });
    tile.motion?.effects.forEach((root) => { root.visible = flags.effects; });
  }
  function status(): void {
    onStatus(pending.size ? 'Loading nearby terrain and scenery…' : failed.size ? 'Some nearby tiles could not be loaded. Reset view to retry.' : wanted.length ? 'Pan to explore. Details load nearby.' : 'Terrain is unavailable here. Choose an area or keep panning.');
  }
  function lighting(): void {
    const current = wanted[0], entry = current && terrain.get(current.id);
    if (!entry || lightingTile === current.id) return;
    lightingTile = current.id;
    const fog = applySceneSettings(env, entry.tile.setup.settings);
    scene.background = new THREE.Color().fromArray(fog); env.fogDensity.value = 0.0015;
  }
  async function loadTerrain(tile: WorldTile, controller: AbortController): Promise<void> {
    const loaded = await loadAreaTile(tile.terrain, baseUrl, env, files, controller.signal, camera, budget, null);
    try {
      const bytes = await files.get(`${view.populationBase}/${tile.id}.json`);
      const data = JSON.parse(new TextDecoder().decode(bytes)) as AreaPopulation;
      controller.signal.throwIfAborted();
      if (disposed || !wanted.some((entry) => entry.id === tile.id)) { loaded.dispose(); return; }
      terrain.set(tile.id, { tile: loaded, population: data }); scene.add(loaded.setup.root);
      anchorGround();
      lighting();
      if (detail?.id === tile.id) loaded.setup.root.visible = false;
      updatePopulation(); invalidate();
    } catch (error) { loaded.dispose(); throw error; }
  }
  async function loadDetail(tile: WorldTile, key: string, controller: AbortController): Promise<void> {
    const loaded = await loadAreaTile(tile.detail, baseUrl, env, files, controller.signal, camera, budget, { grass: flags.grass, effects: flags.effects });
    if (disposed || controller.signal.aborted || wantedDetail !== key) { loaded.dispose(); return; }
    removeDetail(); detail = { id: tile.id, key, tile: loaded };
    terrain.get(tile.id)!.tile.setup.root.visible = false;
    layers(loaded); scene.add(loaded.setup.root); invalidate();
  }
  function pump(): void {
    if (disposed) return;
    const current = wanted[0];
    const jobs = [
      ...(current && !terrain.has(current.id) ? [{ tile: current, key: current.id, detail: false }] : []),
      ...(current && wantedDetail && terrain.has(current.id) && detail?.key !== wantedDetail ? [{ tile: current, key: wantedDetail, detail: true }] : []),
      ...wanted.filter((tile) => !terrain.has(tile.id)).map((tile) => ({ tile, key: tile.id, detail: false })),
    ];
    for (const job of jobs) {
      if (pending.size >= 2) break;
      if (pending.has(job.key) || failed.has(job.key)) continue;
      const controller = new AbortController(); pending.set(job.key, controller);
      void (job.detail ? loadDetail(job.tile, job.key, controller) : loadTerrain(job.tile, controller)).catch((error: unknown) => {
        if (!controller.signal.aborted && !disposed) { failed.add(job.key); console.warn(`World map tile unavailable: ${job.tile.id}`, error); }
      }).finally(() => { pending.delete(job.key); if (!disposed) { pump(); status(); } });
    }
    status();
  }
  function refresh(): void {
    timer = undefined;
    if (disposed) return;
    const x = orbit.target.x, z = orbit.target.z;
    const centerDistance = (tile: WorldTile): number => ((tile.bounds[0] + tile.bounds[2]) / 2 - x) ** 2 + ((tile.bounds[1] + tile.bounds[3]) / 2 - z) ** 2;
    wanted = view.recipe.tiles.filter((tile) => distance(tile, x, z) < 1100 ** 2).sort((a, b) => centerDistance(a) - centerDistance(b)).slice(0, mobile ? 4 : 9);
    const current = wanted[0];
    wantedDetail = current && distance(current, x, z) === 0 && (flags.scenery || flags.grass || flags.effects) && camera.position.distanceTo(orbit.target) < (mobile ? 600 : 900)
      ? `${current.id}:${flags.grass}:${flags.effects}` : '';
    for (const [key, controller] of pending) if (key !== wantedDetail && !wanted.some((tile) => tile.id === key)) controller.abort();
    for (const key of failed) if (key !== wantedDetail && !wanted.some((tile) => tile.id === key)) failed.delete(key);
    if (detail && detail.key !== wantedDetail) removeDetail();
    for (const [id, entry] of terrain) if (!wanted.some((tile) => tile.id === id)) {
      scene.remove(entry.tile.setup.root); entry.tile.dispose(); terrain.delete(id);
    }
    updatePopulation(); lighting(); pump(); invalidate();
  }
  function change(): void {
    const [x0, z0, x1, z1] = view.recipe.bounds;
    const x = THREE.MathUtils.clamp(orbit.target.x, x0, x1), z = THREE.MathUtils.clamp(orbit.target.z, z0, z1);
    camera.position.x += x - orbit.target.x; camera.position.z += z - orbit.target.z;
    orbit.target.x = x; orbit.target.z = z;
    if (Math.hypot(x - targetX, z - targetZ) > 0.1) anchored = true;
    targetX = x; targetZ = z; anchorGround();
    if (!timer) timer = setTimeout(refresh, 120);
    invalidate();
  }
  function focus(x: number, z: number): void {
    const nearest = [...view.recipe.tiles].sort((a, b) => distance(a, x, z) - distance(b, x, z))[0];
    if (!nearest) return;
    x = THREE.MathUtils.clamp(x, nearest.bounds[0] + 1, nearest.bounds[2] - 1);
    z = THREE.MathUtils.clamp(z, nearest.bounds[1] + 1, nearest.bounds[3] - 1);
    anchored = true; targetX = x; targetZ = z;
    const ground = groundAt(x, z), y = Number.isFinite(ground) ? ground : -62, span = mobile ? 500 : 640;
    orbit.target.set(x, y, z); camera.position.set(x, y + span * 0.7, z - span * 0.7);
    orbit.update(); refresh();
  }
  const visibility = (): void => { previous = 0; if (!document.hidden) invalidate(); };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(frame); clearTimeout(timer);
    observer?.disconnect(); intersection?.disconnect(); document.removeEventListener('visibilitychange', visibility);
    signal.removeEventListener('abort', dispose); pending.forEach((controller) => controller.abort());
    population.dispose(); removeDetail(); terrain.forEach((entry) => entry.tile.dispose()); terrain.clear(); files.dispose();
    orbit.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    if (!view.recipe.tiles.length) throw new Error('No world terrain is available');
    const size = (): void => { renderer.setSize(container.clientWidth || 1, container.clientHeight || 1); camera.aspect = (container.clientWidth || 1) / (container.clientHeight || 1); camera.updateProjectionMatrix(); invalidate(); };
    size();
    const initial = [...view.recipe.tiles].sort((a, b) => distance(a, ...view.focus) - distance(b, ...view.focus))[0];
    wanted = [initial];
    onStatus('Loading terrain…');
    const controller = new AbortController(); pending.set(initial.id, controller);
    await loadTerrain(initial, controller); pending.delete(initial.id); signal.throwIfAborted();
    orbit.addEventListener('change', change);
    focus(...view.focus);
    observer = new ResizeObserver(size); observer.observe(container);
    intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; previous = 0; if (visible) invalidate(); }); intersection.observe(container);
    document.addEventListener('visibilitychange', visibility);
    return {
      focus,
      reset: () => { files.forget(); failed.clear(); focus(orbit.target.x, orbit.target.z); },
      overhead: () => { camera.position.copy(orbit.target).add(new THREE.Vector3(0, mobile ? 600 : 850, -0.01)); orbit.update(); invalidate(); },
      scenery: (show) => { flags.scenery = show; if (detail) layers(detail.tile); refresh(); },
      grass: (show) => { flags.grass = show; refresh(); },
      effects: (show) => { flags.effects = show; refresh(); },
      pause: (value) => { paused = value; previous = 0; invalidate(); },
      population: (kind, show) => population.toggle(kind, show),
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
