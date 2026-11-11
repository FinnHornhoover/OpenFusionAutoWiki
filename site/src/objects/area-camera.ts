import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function focusPopulation(point: THREE.Vector3, camera: THREE.PerspectiveCamera, orbit: OrbitControls, roots: THREE.Object3D[]): void {
  orbit.target.copy(point).add(new THREE.Vector3(0, 1.5, 0));
  const ray = new THREE.Raycaster(), direction = new THREE.Vector3();
  const obstacles: THREE.Object3D[] = [];
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.visible && !object.userData.ffSkip && !object.userData.ffGrass && !object.userData.ffEffect) obstacles.push(object);
    });
  }
  let bestDistance = 0;
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
    direction.set(Math.sin(angle), 0.35, -Math.cos(angle)).normalize();
    ray.set(orbit.target, direction); ray.far = 18;
    const hit = ray.intersectObjects(obstacles, false)[0];
    const distance = Math.max(1, Math.min(18, (hit?.distance ?? 19) - 1));
    if (distance > bestDistance) { bestDistance = distance; camera.position.copy(orbit.target).addScaledVector(direction, distance); }
  }
  orbit.update();
}
