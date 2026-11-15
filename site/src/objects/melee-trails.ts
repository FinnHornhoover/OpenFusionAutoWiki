import * as THREE from 'three';
import type { MeleeTrail } from '../../../shared/objects';
import { disposeTexture, type LoadedModel } from './assets';

interface Playback { name: string; time: number; duration: number; endTime?: number }

interface Ribbon {
  top: THREE.Object3D;
  bottom: THREE.Object3D;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  history: { top: THREE.Vector3; bottom: THREE.Vector3 }[];
}

// Unity's Vector3.Slerp interpolates direction and magnitude independently.
function slerp(from: THREE.Vector3, to: THREE.Vector3, amount: number, target: THREE.Vector3, axis: THREE.Vector3): THREE.Vector3 {
  const a = from.length(), b = to.length();
  if (a < 1e-8 || b < 1e-8) return target.lerpVectors(from, to, amount);
  const dot = THREE.MathUtils.clamp(from.dot(to) / (a * b), -1, 1);
  if (dot > 0.9995) return target.lerpVectors(from, to, amount);
  const angle = Math.acos(dot), length = THREE.MathUtils.lerp(a, b, amount);
  if (dot < -0.9995) {
    axis.set(Math.abs(from.x) < Math.abs(from.y) ? 1 : 0, Math.abs(from.x) < Math.abs(from.y) ? 0 : 1, 0).cross(from).normalize();
    return target.copy(from).multiplyScalar(Math.cos(angle * amount) / a).addScaledVector(axis, Math.sin(angle * amount)).multiplyScalar(length);
  }
  return target.copy(from).multiplyScalar(Math.sin((1 - amount) * angle) / (Math.sin(angle) * a))
    .addScaledVector(to, Math.sin(amount * angle) / (Math.sin(angle) * b)).multiplyScalar(length);
}

export class MeleeTrails {
  readonly count: number;
  private name = '';
  private time = 0;
  private disposed = false;
  private top = new THREE.Vector3();
  private bottom = new THREE.Vector3();
  private center = new THREE.Vector3();
  private edge = new THREE.Vector3();
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private sampledTop = new THREE.Vector3();
  private sampledBottom = new THREE.Vector3();
  private inverse = new THREE.Matrix4();

  private constructor(private actor: THREE.Object3D, private ribbons: Ribbon[], private texture: THREE.Texture, private material: THREE.ShaderMaterial) {
    this.count = ribbons.length;
  }

  static async create(actor: THREE.Object3D, weapon: LoadedModel, recipe: MeleeTrail, baseUrl: string, signal: AbortSignal): Promise<MeleeTrails | undefined> {
    const points = new Map<number, THREE.Object3D>();
    for (const [index, node] of weapon.data.nodes.entries()) {
      const match = /stag.*?(\d{2})$/i.exec(node.name ?? ''), object = weapon.nodes.get(index);
      if (!match || !object) continue;
      let parent: THREE.Object3D | null = object;
      while (parent && parent !== actor) parent = parent.parent;
      if (parent) points.set(Number(match[1]), object);
    }
    const pairs = [...points].filter(([index]) => index % 2 === 1 && points.has(index + 1));
    if (!pairs.length) return undefined;

    const response = await fetch(`${baseUrl}/${recipe.texture}`, { signal });
    if (!response.ok) throw new Error(`Melee trail download failed (${response.status})`);
    const image = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    if (signal.aborted) { image.close(); signal.throwIfAborted(); }
    const texture = new THREE.Texture(image);
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = recipe.wrap === 1 ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    texture.magFilter = recipe.filter === 0 ? THREE.NearestFilter : THREE.LinearFilter;
    texture.minFilter = recipe.filter === 0 ? THREE.NearestFilter : recipe.filter === 2 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    texture.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      name: 'ff:sword-trail',
      uniforms: { map: { value: texture }, tint: { value: new THREE.Vector4().fromArray(recipe.color) }, uvST: { value: new THREE.Vector4().fromArray(recipe.uv) } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      vertexShader: `
        attribute vec4 trailColor;
        uniform vec4 uvST;
        varying vec2 vUv;
        varying vec4 vColor;
        void main() {
          vUv = vec2(uv.x * uvST.x + uvST.z, 1.0 - (uv.y * uvST.y + uvST.w));
          vColor = trailColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D map;
        uniform vec4 tint;
        varying vec2 vUv;
        varying vec4 vColor;
        void main() {
          gl_FragColor = 2.0 * vColor * tint * texture2D(map, vUv);
          gl_FragColor.a = clamp(gl_FragColor.a, 0.0, 1.0);
          if (gl_FragColor.a <= 0.0) discard;
        }`,
    });
    const ribbons: Ribbon[] = [];
    try {
      for (const [index, top] of pairs) {
        const geometry = new THREE.BufferGeometry(), uv = new Float32Array(120), colors = new Float32Array(240), indices: number[] = [];
        for (let i = 0; i < 30; i++) {
          uv.set([(i + 1) / 30, 0, (i + 1) / 30, 1], i * 4);
          colors.fill(i === 29 ? 1 : 0.5, i * 8, i * 8 + 4);
          if (i < 29) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(180), 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geometry.setAttribute('trailColor', new THREE.BufferAttribute(colors, 4));
        geometry.setIndex(indices);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `melee-trail-${index}`; mesh.frustumCulled = false; mesh.visible = false;
        actor.add(mesh);
        ribbons.push({ top, bottom: points.get(index + 1)!, mesh, history: Array.from({ length: 30 }, () => ({ top: new THREE.Vector3(), bottom: new THREE.Vector3() })) });
      }
      return new MeleeTrails(actor, ribbons, texture, material);
    } catch (error) {
      ribbons.forEach(({ mesh }) => { mesh.removeFromParent(); mesh.geometry.dispose(); });
      material.dispose(); disposeTexture(texture); throw error;
    }
  }

  clear(): void {
    this.name = ''; this.time = 0;
    this.ribbons.forEach(({ mesh }) => { mesh.visible = false; });
  }

  update(clips: Playback[]): void {
    if (this.disposed) return;
    const clip = clips.find(({ name, time, duration, endTime }) => /attack|stickwhillwind/i.test(name) && duration > 0 && time < Math.min(duration, endTime ?? duration));
    if (!clip) { this.clear(); return; }
    const reset = clip.name !== this.name || clip.time < this.time;
    this.name = clip.name; this.time = clip.time;
    this.actor.updateWorldMatrix(true, true);
    this.inverse.copy(this.actor.matrixWorld).invert();

    for (const { top, bottom, mesh, history } of this.ribbons) {
      top.getWorldPosition(this.top).applyMatrix4(this.inverse);
      bottom.getWorldPosition(this.bottom).applyMatrix4(this.inverse);
      if (reset) {
        history.forEach((sample) => { sample.top.copy(this.top); sample.bottom.copy(this.bottom); });
        mesh.visible = false;
        continue;
      }
      const dot = this.from.subVectors(this.top, history[29].top).dot(this.to.subVectors(history[29].top, history[28].top));
      const append = (a: THREE.Vector3, b: THREE.Vector3): void => {
        const sample = history.shift()!; sample.top.copy(a); sample.bottom.copy(b); history.push(sample);
      };
      for (let step = 1; step < 5; step++) {
        this.edge.subVectors(history[29].top, history[29].bottom);
        this.center.addVectors(history[29].top, this.top).multiplyScalar(0.5).addScaledVector(this.edge, -(1.5 - dot));
        this.from.subVectors(history[29].top, this.center); this.to.subVectors(this.top, this.center);
        slerp(this.from, this.to, step * 0.2, this.sampledTop, this.axis).add(this.center);
        this.center.addVectors(history[29].bottom, this.bottom).multiplyScalar(0.5).addScaledVector(this.edge, -(2 - dot));
        this.from.subVectors(history[29].bottom, this.center); this.to.subVectors(this.bottom, this.center);
        slerp(this.from, this.to, step * 0.2, this.sampledBottom, this.axis).add(this.center);
        append(this.sampledTop, this.sampledBottom);
      }
      append(this.top, this.bottom);
      const positions = mesh.geometry.getAttribute('position');
      history.forEach((sample, i) => { positions.setXYZ(i * 2, sample.top.x, sample.top.y, sample.top.z); positions.setXYZ(i * 2 + 1, sample.bottom.x, sample.bottom.y, sample.bottom.z); });
      positions.needsUpdate = true;
      mesh.visible = true;
    }
  }

  follow(): void {
    if (this.disposed || !this.name) return;
    this.actor.updateWorldMatrix(true, true);
    this.inverse.copy(this.actor.matrixWorld).invert();
    for (const { top, bottom, mesh } of this.ribbons) {
      if (!mesh.visible) continue;
      top.getWorldPosition(this.top).applyMatrix4(this.inverse);
      bottom.getWorldPosition(this.bottom).applyMatrix4(this.inverse);
      const positions = mesh.geometry.getAttribute('position');
      positions.setXYZ(58, this.top.x, this.top.y, this.top.z);
      positions.setXYZ(59, this.bottom.x, this.bottom.y, this.bottom.z);
      positions.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ribbons.forEach(({ mesh }) => { mesh.removeFromParent(); mesh.geometry.dispose(); });
    this.material.dispose(); disposeTexture(this.texture);
  }
}
