import * as THREE from 'three';
import { clipFromGltf } from 'ff-three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { LoadedModel } from './assets';
import { textureRotation } from './materials';

interface FloatCurve {
  input: number;
  output: number;
  node?: number;
  renderer_nodes?: number[];
  attribute?: string;
  times?: number[];
  values?: (number | null)[];
}

interface ClipData {
  animations?: { extras?: { duration?: number; float_curves?: Record<string, FloatCurve> } }[];
  extras?: {
    clip?: { duration?: number };
    material_clips?: { duration?: number; float_curves?: Record<string, FloatCurve> }[];
  };
}

interface MaterialTrack {
  times: ArrayLike<number>;
  values: ArrayLike<number>;
  bindings: MaterialBinding[];
}

interface MaterialBinding {
  key: string;
  baseline: number;
  apply: (value: number) => void;
}

interface DecodedClip {
  clip: THREE.AnimationClip;
  materials: MaterialTrack[];
  duration: number;
}

interface LayerChannel {
  object: THREE.Object3D;
  property: 'position' | 'quaternion' | 'scale';
  interpolant: THREE.Interpolant;
  base: number[];
}

interface AnimationLayer {
  decoded: DecodedClip;
  channels: LayerChannel[];
  time: number;
  age: number;
  speed: number;
  fade: number;
  ending?: { time: number; duration: number };
}

export function sample(times: ArrayLike<number>, values: ArrayLike<number>, time: number): number {
  if (times.length === 1 || time <= times[0]) return values[0];
  if (time >= times[times.length - 1]) return values[values.length - 1];
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid; else hi = mid;
  }
  const ratio = (time - times[lo]) / (times[hi] - times[lo] || 1);
  return values[lo] + (values[hi] - values[lo]) * ratio;
}

function materialBinding(material: THREE.ShaderMaterial, attribute: string): MaterialBinding | undefined {
  const uniforms = material.uniforms;
  const outline = material.name === 'ff:outline';
  if (outline && !/^(_FatFactor|_OutlineColor\.[rgba])$/.test(attribute)) return undefined;
  if (!outline && attribute.startsWith('_OutlineColor.')) return undefined;
  const color = /^(_\w+)\.([rgba])$/.exec(attribute);
  if (color) {
    const keys = color[1] === '_Color' ? ['matColor', 'color'] : color[1] === '_Emission' ? ['matEmission', 'emission'] : color[1] === '_OutlineColor' ? ['color'] : color[1] === '_AmbColor' ? ['matAmb'] : [color[1]];
    const uniform = keys.map((key) => uniforms[key]).find(Boolean);
    const component = 'rgba'.indexOf(color[2]);
    if (uniform?.value instanceof THREE.Vector4 || uniform?.value instanceof THREE.Vector3 && component < 3) {
      return { key: `${material.uuid}/${keys.find((key) => uniforms[key] === uniform)}/${component}`, baseline: uniform.value.getComponent(component), apply: (v) => uniform.value.setComponent(component, v) };
    }
  }
  const offset = /^(_MainTex|_MainTex2|_MaskTex)\.(offset|scale)\.([xy])$/.exec(attribute);
  const st = offset && ({ _MainTex: 'uvST', _MainTex2: 'uvST2', _MaskTex: 'maskST' } as Record<string, string>)[offset[1]];
  if (offset && st && uniforms[st]) {
    const component = (offset[2] === 'offset' ? 2 : 0) + (offset[3] === 'y' ? 1 : 0);
    return { key: `${material.uuid}/${st}/${component}`, baseline: uniforms[st].value.getComponent(component), apply: (v) => uniforms[st].value.setComponent(component, v) };
  }
  if (attribute === '_MainTex.rotation') {
    const rotation = textureRotation(material);
    if (rotation) return { key: `${material.uuid}/textureRotation`, baseline: THREE.MathUtils.radToDeg(rotation.value), apply: (v) => { rotation.value = THREE.MathUtils.degToRad(v); } };
  }
  if (attribute === '_FatFactor' && uniforms.push) {
    const outline = material.name === 'ff:outline' ? Number(material.userData.ffOutline ?? 0) : 0;
    return { key: `${material.uuid}/push`, baseline: uniforms.push.value - outline, apply: (v) => { uniforms.push.value = outline + v; } };
  }
  if (typeof uniforms[attribute]?.value === 'number') {
    return { key: `${material.uuid}/${attribute}`, baseline: uniforms[attribute].value, apply: (v) => { uniforms[attribute].value = v; } };
  }
  return undefined;
}

export class ModelAnimation {
  readonly names: string[];
  private mixer: THREE.AnimationMixer;
  private action?: THREE.AnimationAction;
  private fading?: { action: THREE.AnimationAction; remaining: number };
  private layer?: AnimationLayer;
  speed = 1;
  private materials: MaterialTrack[] = [];
  private time = 0;
  private duration = 0;
  private generation = 0;
  private disposed = false;
  private bindings = new Map<string, MaterialBinding>();
  private decoded = new Map<string, Promise<DecodedClip>>();

  constructor(readonly model: LoadedModel, private loadClip: (url: string) => Promise<GLTF>, private root: THREE.Object3D = model.gltf.scene, allowed?: string[]) {
    this.names = allowed ?? Object.keys(model.data.extras?.clips ?? {}).filter((name) => !/^(height|shape)(?:_Add)?$/i.test(name)).sort();
    this.mixer = new THREE.AnimationMixer(root);
  }

  private decode(name: string): Promise<DecodedClip> {
    let promise = this.decoded.get(name);
    if (!promise) {
      promise = this.readClip(name).catch((error: unknown) => { this.decoded.delete(name); throw error; });
      this.decoded.set(name, promise);
    }
    return promise;
  }

  private async readClip(name: string): Promise<DecodedClip> {
    const uri = this.model.data.extras?.clips?.[name];
    if (!uri) throw new Error(`Unknown animation: ${name}`);
    const gltf = await this.loadClip(new URL(uri, this.model.url).href);
    const data = gltf.parser.json as ClipData;
    const extras = data.animations?.[0]?.extras ?? data.extras?.material_clips?.[0];
    const duration = data.extras?.clip?.duration ?? extras?.duration ?? 0;
    const clip = data.animations?.length
      ? await clipFromGltf(gltf.parser, 0, (index) => this.model.nodes.get(index))
      : new THREE.AnimationClip(name, duration, []);
    clip.duration = duration;
    const materials: MaterialTrack[] = [];
    for (const [key, curve] of Object.entries(extras?.float_curves ?? {})) {
      const rawAttribute = curve.attribute ?? key.slice(key.lastIndexOf(':') + 1);
      const slot = /^\[(\d+)\]\./.exec(rawAttribute);
      const attribute = rawAttribute.replace(/^\[\d+\]\./, '');
      const targets = curve.renderer_nodes?.length ? curve.renderer_nodes : curve.node === undefined ? [] : [curve.node];
      const meshes = new Set<THREE.Mesh>();
      for (const index of targets) this.model.nodes.get(index)?.traverse((object) => { if (object instanceof THREE.Mesh) meshes.add(object); });
      // Actor shape curves address the combined renderer's material slots.
      if (!meshes.size && attribute === '_FatFactor') this.model.gltf.scene.traverse((object) => { if (object instanceof THREE.Mesh) meshes.add(object); });
      const bindings: MaterialBinding[] = [];
      for (const mesh of meshes) {
        if (attribute === '_FatFactor' && this.model.data.extras?.kind === 'player' && !mesh.userData.ffWorn && !mesh.parent?.userData.ffWorn) continue;
        if (slot && attribute !== '_FatFactor') {
          const source = mesh.userData.ffSkip ? mesh.parent ?? mesh : mesh;
          const association = this.model.gltf.parser.associations.get(source) as { primitives?: number } | undefined;
          if ((association?.primitives ?? 0) !== Number(slot[1])) continue;
        }
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (material instanceof THREE.ShaderMaterial) {
            const binding = materialBinding(material, attribute);
            if (binding) {
              if (!this.bindings.has(binding.key)) this.bindings.set(binding.key, binding);
              bindings.push(this.bindings.get(binding.key)!);
            }
          }
        }
      }
      if (!bindings.length) continue;
      const times = curve.times ?? (await gltf.parser.getDependency('accessor', curve.input) as THREE.BufferAttribute).array;
      const values = curve.values?.map((v) => v ?? 0) ?? (await gltf.parser.getDependency('accessor', curve.output) as THREE.BufferAttribute).array;
      if (times.length) materials.push({ times, values, bindings });
    }
    return { clip, materials, duration };
  }

  async prepare(names: string[]): Promise<void> {
    await Promise.all([...new Set(names)].map((name) => this.decode(name)));
  }

  async clipDuration(name: string): Promise<number> {
    return (await this.decode(name)).duration;
  }

  async playUpper(name: string, speed = 1, fade = 0.15): Promise<void> {
    const decoded = await this.decode(name);
    if (this.disposed) return;
    this.stopUpper();
    const channels: LayerChannel[] = [];
    for (const track of decoded.clip.tracks) {
      const match = /^(.*)\.(position|quaternion|scale)$/.exec(track.name);
      const object = match && this.root.getObjectByProperty('uuid', match[1]);
      if (!object || !match) continue;
      const property = match[2] as LayerChannel['property'];
      const interpolant = property === 'quaternion' ? new THREE.QuaternionLinearInterpolant(track.times, track.values, 4) : new THREE.LinearInterpolant(track.times, track.values, 3);
      channels.push({ object, property, interpolant, base: object[property].toArray() });
    }
    this.layer = { decoded, channels, time: 0, age: 0, speed, fade };
    this.applyTime(this.time);
  }

  stopUpper(fade = 0): void {
    if (!this.layer) return;
    if (fade > 0) { this.layer.ending = { time: 0, duration: fade }; return; }
    this.restoreUpper();
    this.layer = undefined;
  }

  get upperPlayback(): { time: number; duration: number } {
    return { time: this.layer?.time ?? 0, duration: this.layer?.decoded.duration ?? 0 };
  }

  private restoreUpper(): void {
    for (const channel of this.layer?.channels ?? []) channel.object[channel.property].fromArray(channel.base);
  }

  async play(name: string, fade = 0): Promise<boolean> {
    if (!this.names.includes(name)) throw new Error(`Animation is unavailable for this preview: ${name}`);
    const generation = ++this.generation;
    const decoded = await this.decode(name);
    if (this.disposed || generation !== this.generation) return false;
    for (const binding of this.bindings.values()) binding.apply(binding.baseline);
    if (this.fading) {
      this.fading.action.stop(); this.mixer.uncacheClip(this.fading.action.getClip()); this.fading = undefined;
    }
    const previous = this.action;
    if (previous && fade > 0 && previous.getClip() !== decoded.clip) {
      previous.fadeOut(fade); this.fading = { action: previous, remaining: fade };
    } else if (previous) { previous.stop(); this.mixer.uncacheClip(previous.getClip()); }
    this.action = this.mixer.clipAction(decoded.clip).reset().setEffectiveWeight(1).play();
    if (this.fading) this.action.fadeIn(fade);
    this.action.paused = true;
    this.materials = decoded.materials;
    this.duration = decoded.duration;
    this.time = 0;
    this.seek(0);
    return true;
  }

  async proportions(kind: 'height' | 'shape', value: number): Promise<void> {
    const clips = this.model.data.extras?.clips ?? {};
    if (clips[kind]) {
      const decoded = await this.decode(kind);
      if (this.disposed) return;
      for (const track of decoded.materials) {
        const sampled = sample(track.times, track.values, value * decoded.duration);
        for (const binding of track.bindings) { binding.apply(sampled); binding.baseline = sampled; }
      }
    }
    const name = `${kind}_Add`;
    if (clips[name]) {
      const decoded = await this.decode(name);
      const clip = decoded.clip.clone();
      if (this.disposed) return;
      THREE.AnimationUtils.makeClipAdditive(clip);
      const action = this.mixer.clipAction(clip).play();
      action.time = value * decoded.duration;
      action.paused = true;
      action.clampWhenFinished = true;
    }
  }

  get playback(): { time: number; duration: number } {
    return { time: this.time, duration: this.duration };
  }

  seek(time: number): void {
    this.applyTime(time);
  }

  private applyTime(time: number, delta = 0, layerDelta = delta): void {
    this.restoreUpper();
    this.time = Math.max(0, Math.min(Number.isFinite(time) ? time : 0, this.duration));
    if (this.action) this.action.time = this.time;
    this.mixer.update(delta);
    if (this.fading) {
      this.fading.remaining -= delta;
      if (this.fading.remaining <= 0) { this.fading.action.stop(); this.mixer.uncacheClip(this.fading.action.getClip()); this.fading = undefined; }
    }
    for (const track of this.materials) {
      const value = sample(track.times, track.values, this.time);
      for (const binding of track.bindings) binding.apply(value);
    }
    const layer = this.layer;
    if (layer) {
      layer.age += layerDelta;
      layer.time = Math.min(layer.decoded.duration, layer.time + layerDelta * layer.speed);
      if (layer.ending) layer.ending.time += layerDelta;
      const weight = (layer.fade > 0 ? Math.min(1, layer.age / layer.fade) : 1) * (layer.ending ? Math.max(0, 1 - layer.ending.time / layer.ending.duration) : 1);
      const vector = new THREE.Vector3(), quaternion = new THREE.Quaternion();
      for (const channel of layer.channels) {
        channel.object[channel.property].toArray(channel.base);
        const value = channel.interpolant.evaluate(layer.time);
        if (channel.property === 'quaternion') channel.object.quaternion.slerp(quaternion.fromArray(value), weight);
        else channel.object[channel.property].lerp(vector.fromArray(value), weight);
      }
      for (const track of layer.decoded.materials) for (const binding of track.bindings) binding.apply(binding.baseline + (sample(track.times, track.values, layer.time) - binding.baseline) * weight);
      if (layer.ending && layer.ending.time >= layer.ending.duration) this.stopUpper();
    }
  }

  update(delta: number, loop = true, layerDelta = delta): void {
    if (this.duration <= 0) { this.applyTime(0, delta, layerDelta); return; }
    this.applyTime(loop ? (this.time + delta * this.speed) % this.duration : Math.min(this.time + delta * this.speed, this.duration), delta, layerDelta);
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.stopUpper();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
