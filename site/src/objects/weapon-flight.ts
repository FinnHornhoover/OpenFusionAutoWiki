import * as THREE from 'three';
import type { WeaponShot } from '../../../shared/objects';

export class WeaponFlight {
  readonly position = new THREE.Vector3();
  readonly rotation = new THREE.Quaternion();
  readonly endpoint = new THREE.Vector3();
  private start = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private time = 0;
  private ground = 0;

  constructor(readonly shot: WeaponShot, origin: THREE.Vector3, forward: THREE.Vector3, muzzle: THREE.Vector3 | undefined) {
    const flight = shot.flight;
    this.ground = origin.y + 0.2;
    this.endpoint.copy(origin).addScaledVector(forward, flight.kind === 'ordinary' ? flight.range : flight.speed);
    if (flight.kind === 'ordinary') {
      this.endpoint.y = origin.y + 1;
      this.start.copy(muzzle ?? origin.clone().add(new THREE.Vector3(0, 0.8, 0)));
    } else if (flight.kind === 'rocket') {
      this.start.copy(muzzle ?? origin);
      this.endpoint.y = this.start.y;
    } else {
      this.start.copy(origin).add(new THREE.Vector3(0, 0.8, 0));
    }
    let direction = this.endpoint.clone().sub(this.start).normalize();
    if (!direction.lengthSq()) direction.copy(forward);
    if (flight.kind !== 'ordinary' && flight.retrobution) {
      this.start.addScaledVector(direction, 0.3);
      // Unity's lateral offset is reflected with the exported X axis.
      if (flight.kind === 'grenade') this.start.add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize(), 0.195);
      direction = this.endpoint.clone().sub(this.start).normalize();
    }
    this.position.copy(this.start);
    if (flight.kind === 'ordinary') {
      this.rotation.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), direction.clone().negate(), new THREE.Vector3(0, 1, 0)));
    } else {
      const yaw = Math.atan2(direction.x, direction.z) + Math.PI;
      const pitch = flight.retrobution ? Math.atan2(direction.y, Math.hypot(direction.x, direction.z)) : 0;
      this.rotation.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
      this.velocity.copy(direction).multiplyScalar(flight.speed);
      if (flight.kind === 'grenade') this.velocity.y = flight.verticalSpeed + (flight.retrobution ? this.velocity.y : 0);
    }
  }

  advance(delta: number): void {
    const flight = this.shot.flight;
    const end = Math.min(flight.duration, this.time + delta);
    if (flight.kind === 'ordinary') {
      this.position.lerpVectors(this.start, this.endpoint, flight.duration > 0 ? end / flight.duration : 1);
    } else if (flight.kind === 'rocket') {
      this.position.addScaledVector(this.velocity, end - this.time);
    } else {
      // Solve floor contacts so bouncing does not depend on render rate.
      let remaining = end - this.time;
      while (remaining > 1e-9) {
        if (this.position.y <= this.ground && Math.abs(this.velocity.y) < 0.02) {
          this.velocity.y = 0; this.position.addScaledVector(this.velocity, remaining); this.position.y = this.ground; break;
        }
        const hit = (this.velocity.y + Math.sqrt(this.velocity.y ** 2 + 2 * 9.8 * Math.max(0, this.position.y - this.ground))) / 9.8;
        const step = Math.min(remaining, hit);
        this.position.addScaledVector(this.velocity, step);
        this.position.y -= 0.5 * 9.8 * step * step;
        this.velocity.y -= 9.8 * step;
        if (step >= hit) { this.position.y = this.ground; this.velocity.y = Math.abs(this.velocity.y) * 0.8; }
        remaining -= step;
      }
    }
    this.time = end;
  }
}
