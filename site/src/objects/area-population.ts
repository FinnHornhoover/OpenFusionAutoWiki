import * as THREE from 'three';
import type { Files } from 'ff-three/world';
import type { AreaPlacement, AreaPopulation, PopulationKind } from '../../../shared/objects';
import { placedModel, type PlacedModel } from './placed-model';

export interface PopulationSelection { name: string; unavailable: boolean }
export interface PopulationLayer {
  toggle(kind: PopulationKind, show: boolean): void;
  update(delta: number): void;
  dispose(): void;
}

export function areaPopulation(data: AreaPopulation, scene: THREE.Scene, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, baseUrl: string, env: Record<string, THREE.IUniform>, signal: AbortSignal, files: Files, invalidate: () => void, focus: (point: THREE.Vector3) => void, selected: (value: PopulationSelection | null) => void): PopulationLayer {
  const enabled = new Set<PopulationKind>(['npcs', 'monsters', 'eggs']);
  const group = new THREE.Group();
  scene.add(group);
  const loaded = new Map<string, PlacedModel>(), pending = new Map<string, AbortController>(), failed = new Set<string>();
  const wanted = new Set<string>();
  const limit = matchMedia('(max-width: 600px)').matches ? 16 : 40;
  const markers = new Map<PopulationKind, THREE.Points>();
  const colors = { npcs: 0x52ffff, monsters: 0xff775c, eggs: 0xffdb50 };
  const projected = new THREE.Vector3();
  let cameraPose = '';
  let disposed = false, elapsed = 1, selection: AreaPlacement | undefined, down = [0, 0];
  const rebuild = (): void => {
    for (const [kind, points] of markers) {
      const positions = points.geometry.getAttribute('position') as THREE.BufferAttribute;
      let count = 0;
      for (const placement of data.placements) if (placement.kind === kind && !loaded.has(placement.id)) {
        positions.setXYZ(count++, placement.position[0], placement.position[1] + 1, placement.position[2]);
      }
      points.geometry.setDrawRange(0, count);
      positions.needsUpdate = true;
      points.geometry.computeBoundingSphere();
      points.visible = enabled.has(kind);
    }
    invalidate();
  };
  for (const kind of enabled) {
    const material = new THREE.PointsMaterial({ color: colors[kind], size: 7, sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0.9 });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.placements.filter((p) => p.kind === kind).length * 3), 3));
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 10;
    markers.set(kind, points);
    group.add(points);
  }
  const candidates = (): AreaPlacement[] => data.placements.filter((p) => {
    if (!enabled.has(p.kind) || !data.models[p.model] || failed.has(p.id)) return false;
    projected.fromArray(p.position);
    if (projected.distanceToSquared(camera.position) > 140 ** 2) return false;
    projected.project(camera);
    return Math.abs(projected.x) < 1.15 && Math.abs(projected.y) < 1.15 && projected.z > -1 && projected.z < 1;
  }).sort((a, b) => camera.position.distanceToSquared(new THREE.Vector3().fromArray(a.position)) - camera.position.distanceToSquared(new THREE.Vector3().fromArray(b.position))).slice(0, limit);
  const refresh = (): void => {
    wanted.clear(); candidates().forEach((p) => wanted.add(p.id));
    for (const [id, model] of loaded) if (!wanted.has(id)) { model.root.removeFromParent(); model.dispose(); loaded.delete(id); }
    for (const [id, controller] of pending) if (!wanted.has(id)) controller.abort();
    for (const placement of data.placements) {
      if (pending.size >= 2) break;
      if (!wanted.has(placement.id) || loaded.has(placement.id) || pending.has(placement.id)) continue;
      const controller = new AbortController();
      pending.set(placement.id, controller);
      void placedModel(data.models[placement.model], baseUrl, env, controller.signal, files).then((model) => {
        if (disposed || controller.signal.aborted || !wanted.has(placement.id)) { model.dispose(); return; }
        model.root.position.fromArray(placement.position);
        model.root.rotation.y = placement.yaw;
        group.add(model.root);
        loaded.set(placement.id, model);
      }).catch((error: unknown) => {
        if (!controller.signal.aborted && !disposed) {
          failed.add(placement.id);
          console.warn(`Area model unavailable: ${placement.name}`, error);
          if (selection?.id === placement.id) selected({ name: placement.name, unavailable: true });
        }
      }).finally(() => { pending.delete(placement.id); if (!disposed) { rebuild(); elapsed = 1; invalidate(); } });
    }
    rebuild();
  };
  const pointerDown = (event: PointerEvent): void => { down = [event.clientX, event.clientY]; };
  const pointerUp = (event: PointerEvent): void => {
    if (event.button !== 0 || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 6) return;
    const rect = canvas.getBoundingClientRect();
    let best = 15 ** 2, match: AreaPlacement | undefined;
    for (const placement of data.placements) {
      if (!enabled.has(placement.kind)) continue;
      projected.fromArray(placement.position).project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const dx = rect.left + (projected.x + 1) / 2 * rect.width - event.clientX, dy = rect.top + (1 - projected.y) / 2 * rect.height - event.clientY;
      const distance = dx * dx + dy * dy;
      if (distance < best) { best = distance; match = placement; }
    }
    selection = match;
    selected(match ? { name: match.name, unavailable: !data.models[match.model] || failed.has(match.id) } : null);
    if (match) focus(new THREE.Vector3().fromArray(match.position));
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointerup', pointerUp);
    signal.removeEventListener('abort', dispose);
    pending.forEach((controller) => controller.abort());
    loaded.forEach((model) => model.dispose());
    markers.forEach((points) => { points.geometry.dispose(); (points.material as THREE.Material).dispose(); });
    group.removeFromParent();
  };
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointerup', pointerUp);
  signal.addEventListener('abort', dispose, { once: true });
  rebuild();
  return {
    toggle(kind, show) { if (show) enabled.add(kind); else enabled.delete(kind); selection = undefined; selected(null); refresh(); },
    update(delta) { elapsed += delta; const pose = [...camera.position, ...camera.quaternion].join(','); if (elapsed > 0.5 || pose !== cameraPose) { elapsed = 0; cameraPose = pose; refresh(); } loaded.forEach((model) => model.update(delta)); },
    dispose,
  };
}
