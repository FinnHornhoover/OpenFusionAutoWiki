import type { Camera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function previewOrbitControls(camera: Camera, canvas: HTMLCanvasElement): OrbitControls {
  const controls = new OrbitControls(camera, canvas);
  const pointers = new Set<number>();
  const document = canvas.ownerDocument;
  let blocked = false, restoreEnabled = true;

  const reset = (): void => {
    // Public lifecycle methods clear OrbitControls' gesture state and document listeners.
    controls.disconnect();
    controls.connect(canvas);
  };
  const down = (event: PointerEvent): void => {
    if (!controls.enabled && !blocked) return;
    pointers.add(event.pointerId);
    canvas.setPointerCapture(event.pointerId);
  };
  const end = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size || blocked || event.type !== 'pointerup') {
      reset();
      if (pointers.size && !blocked) {
        restoreEnabled = controls.enabled;
        blocked = true;
        controls.enabled = false;
      }
      if (!pointers.size && blocked) { controls.enabled = restoreEnabled; blocked = false; }
    }
  };
  const leave = (event: PointerEvent): void => { if (!canvas.hasPointerCapture(event.pointerId)) end(event); };
  const interrupt = (): void => {
    if (!pointers.size) return;
    const captured = [...pointers];
    pointers.clear();
    reset();
    if (blocked) controls.enabled = restoreEnabled;
    blocked = false;
    for (const id of captured) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  const visibility = (): void => { if (document.hidden) interrupt(); };

  canvas.addEventListener('pointerdown', down, true);
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('pointerleave', leave);
  window.addEventListener('blur', interrupt);
  document.addEventListener('visibilitychange', visibility);

  const dispose = controls.dispose.bind(controls);
  controls.dispose = (): void => {
    canvas.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointerup', end, true);
    document.removeEventListener('pointercancel', end, true);
    canvas.removeEventListener('lostpointercapture', end);
    canvas.removeEventListener('pointerleave', leave);
    window.removeEventListener('blur', interrupt);
    document.removeEventListener('visibilitychange', visibility);
    const captured = [...pointers];
    pointers.clear();
    dispose();
    for (const id of captured) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  return controls;
}
