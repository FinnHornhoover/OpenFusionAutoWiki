import * as THREE from 'three';

interface Triangle { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; na: THREE.Vector3; nb: THREE.Vector3; nc: THREE.Vector3; end: number }

export class ParticleMesh {
  private triangles: Triangle[] = [];
  private positions?: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  private normals?: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  private area = 0;
  private cursor = 0;

  constructor(root: THREE.Object3D) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry, positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
      this.positions ??= positions; this.normals ??= normals;
      const indices = geometry.getIndex(), count = indices?.count ?? positions.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const ids = [0, 1, 2].map((j) => indices ? indices.getX(i + j) : i + j);
        const [a, b, c] = ids.map((id) => new THREE.Vector3().fromBufferAttribute(positions, id));
        const normal = b.clone().sub(a).cross(c.clone().sub(a)), area = normal.length() * 0.5;
        if (!area) continue;
        this.area += area; normal.normalize();
        const [na, nb, nc] = ids.map((id) => normals ? new THREE.Vector3().fromBufferAttribute(normals, id).normalize() : normal.clone());
        this.triangles.push({ a, b, c, na, nb, nc, end: this.area });
      }
    });
    if (!this.positions?.count) throw new Error('Particle emission mesh has no vertices');
  }

  sample(rnd: () => number, interpolate: boolean, systematic: boolean): { position: THREE.Vector3; normal: THREE.Vector3 } {
    if (!interpolate || !this.triangles.length) {
      const index = systematic ? this.cursor++ % this.positions!.count : Math.floor(rnd() * this.positions!.count);
      return { position: new THREE.Vector3().fromBufferAttribute(this.positions!, index), normal: this.normals ? new THREE.Vector3().fromBufferAttribute(this.normals, index).normalize() : new THREE.Vector3(0, 1, 0) };
    }
    let triangle: Triangle;
    if (systematic) triangle = this.triangles[this.cursor++ % this.triangles.length];
    else {
      const area = rnd() * this.area;
      let lo = 0, hi = this.triangles.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (this.triangles[mid].end < area) lo = mid + 1; else hi = mid; }
      triangle = this.triangles[lo];
    }
    const s = Math.sqrt(rnd()), u = 1 - s, v = s * rnd(), w = s - v;
    return {
      position: triangle.a.clone().multiplyScalar(u).addScaledVector(triangle.b, v).addScaledVector(triangle.c, w),
      normal: triangle.na.clone().multiplyScalar(u).addScaledVector(triangle.nb, v).addScaledVector(triangle.nc, w).normalize(),
    };
  }
}
