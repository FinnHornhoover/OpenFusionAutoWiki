import * as THREE from 'three';
import type { Files } from 'ff-three/world';
import type { AreaPlacement, AreaPopulation, PopulationKind } from '../../../shared/objects';
import { placedModel, type PlacedModel } from './placed-model';

export interface PopulationSelection { name: string; unavailable: boolean; loading: boolean }
export interface PopulationLayer {
  readonly moving: boolean;
  replace(data: AreaPopulation): void;
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
  const markers = new Map<PopulationKind, THREE.Points>();
  const colors = { npcs: 0x52ffff, monsters: 0xff775c, eggs: 0xffdb50 };
  const projected = new THREE.Vector3();
  let cameraPose = '';
  const pointers = new Set<number>();
  let tap: { id: number; x: number; y: number } | undefined;
  let disposed = false, elapsed = 1, selection: AreaPlacement | undefined;
  const notify = (): void => {
    const unavailable = !!selection && (!data.models[selection.model] || failed.has(selection.id));
    selected(selection ? { name: selection.name, unavailable, loading: !unavailable && !loaded.has(selection.id) } : null);
  };
  const rebuild = (): void => {
    for (const [kind, points] of markers) {
      let positions = points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const capacity = data.placements.filter((placement) => placement.kind === kind).length;
      if (positions.count !== capacity) {
        points.geometry.dispose();
        points.geometry = new THREE.BufferGeometry();
        positions = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
        points.geometry.setAttribute('position', positions);
      }
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
  }).sort((a, b) => {
    if (a.id === selection?.id) return -1;
    if (b.id === selection?.id) return 1;
    return camera.position.distanceToSquared(new THREE.Vector3().fromArray(a.position)) - camera.position.distanceToSquared(new THREE.Vector3().fromArray(b.position));
  }).slice(0, matchMedia('(max-width: 600px)').matches ? 16 : 40);
  const refresh = (): void => {
    const nearby = candidates();
    wanted.clear(); nearby.forEach((p) => wanted.add(p.id));
    for (const [id, model] of loaded) if (!wanted.has(id)) { model.root.removeFromParent(); model.dispose(); loaded.delete(id); }
    for (const [id, controller] of pending) if (!wanted.has(id)) controller.abort();
    for (const placement of nearby) {
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
        if (selection?.id === placement.id) notify();
      }).catch((error: unknown) => {
        if (!controller.signal.aborted && !disposed) {
          failed.add(placement.id);
          console.warn(`Area model unavailable: ${placement.name}`, error);
          if (selection?.id === placement.id) notify();
        }
      }).finally(() => { pending.delete(placement.id); if (!disposed) { rebuild(); elapsed = 1; invalidate(); } });
    }
    rebuild();
  };
  const pointerDown = (event: PointerEvent): void => {
    pointers.add(event.pointerId);
    tap = pointers.size === 1 ? { id: event.pointerId, x: event.clientX, y: event.clientY } : undefined;
  };
  const pointerMove = (event: PointerEvent): void => {
    if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 6) tap = undefined;
  };
  const pointerCancel = (event: PointerEvent): void => { pointers.delete(event.pointerId); tap = undefined; };
  const pointerUp = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    const clicked = tap?.id === event.pointerId && !pointers.size && event.button === 0 && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 6;
    tap = undefined;
    if (!clicked) return;
    const rect = canvas.getBoundingClientRect();
    let best = 15 ** 2, match: AreaPlacement | undefined;
    for (const placement of data.placements) {
      if (!enabled.has(placement.kind)) continue;
      projected.fromArray(placement.position);
      projected.y += 1;
      projected.project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const dx = rect.left + (projected.x + 1) / 2 * rect.width - event.clientX, dy = rect.top + (1 - projected.y) / 2 * rect.height - event.clientY;
      const distance = dx * dx + dy * dy;
      if (distance < best) { best = distance; match = placement; }
    }
    selection = match;
    if (match && failed.delete(match.id)) files.forget();
    notify();
    if (match) { focus(new THREE.Vector3().fromArray(match.position)); elapsed = 1; invalidate(); }
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointercancel', pointerCancel);
    signal.removeEventListener('abort', dispose);
    pending.forEach((controller) => controller.abort());
    loaded.forEach((model) => model.dispose());
    markers.forEach((points) => { points.geometry.dispose(); (points.material as THREE.Material).dispose(); });
    group.removeFromParent();
  };
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointercancel', pointerCancel);
  signal.addEventListener('abort', dispose, { once: true });
  rebuild();
  return {
    get moving() { return loaded.size > 0; },
    replace(next) {
      data = next;
      if (selection && !data.placements.some((p) => p.id === selection!.id)) { selection = undefined; notify(); }
      failed.clear();
      refresh();
    },
    toggle(kind, show) { if (show) enabled.add(kind); else enabled.delete(kind); selection = undefined; selected(null); refresh(); },
    update(delta) { elapsed += delta; const pose = [...camera.position, ...camera.quaternion].join(','); if (elapsed > 0.5 || pose !== cameraPose) { elapsed = 0; cameraPose = pose; refresh(); } loaded.forEach((model) => model.update(delta)); },
    dispose,
  };
}
