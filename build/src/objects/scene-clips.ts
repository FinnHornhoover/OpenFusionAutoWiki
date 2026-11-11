import type { Pack, Prefab } from './pack.js';
import type { SceneDocument } from './scene-document.js';

export interface AnimationBinding {
  transform: number;
  default_clip: number | null;
  settings: { m_Enabled: boolean; m_PlayAutomatically: boolean };
  targets: [number, number][];
}
export interface FloatCurve {
  node?: number;
  renderer_nodes?: number[];
  input?: number;
  output?: number;
  [field: string]: unknown;
}
export interface SampledDocument {
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; target?: number; byteStride?: number }[];
  accessors?: { bufferView: number; [field: string]: unknown }[];
  animations?: { channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[]; extras?: { float_curves?: Record<string, FloatCurve> } }[];
  extras?: { material_clips?: { float_curves?: Record<string, FloatCurve> }[] };
}
interface PrefabNode { extras?: { source_transform?: number; source_node?: number } }

export class SceneClips {
  readonly bindings: Record<string, AnimationBinding>;
  private samples = new Map<string, { prefab: Prefab; clip: Prefab['clips'][number] }>();
  private nodes = new Map<string, PrefabNode[]>();

  constructor(private pack: Pack) {
    this.bindings = pack.msgpack('animations/bindings.msgpack');
    for (const prefab of Object.values(pack.json<Record<string, Prefab>>('models/prefabs/index.json'))) {
      for (const clip of prefab.clips) {
        const file = pack.resources[clip.object]?.[2].file;
        if (file && !this.samples.has(file)) this.samples.set(file, { prefab, clip });
      }
    }
  }

  async add(document: SceneDocument, id: number, transforms: Map<number, number>, renderers: Map<number, number[]>): Promise<void> {
    const binding = this.bindings[id];
    if (!binding?.settings.m_Enabled || !binding.settings.m_PlayAutomatically || binding.default_clip == null) return;
    const hash = this.pack.resources[binding.default_clip]?.[2].file;
    const sample = hash && this.samples.get(hash);
    if (!sample) { document.missing.add(`Unsampled scene clip: ${binding.default_clip}`); return; }
    let nodes = this.nodes.get(sample.prefab.file);
    if (!nodes) {
      const bytes = this.pack.read(sample.prefab.file);
      nodes = (JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as { nodes: PrefabNode[] }).nodes;
      this.nodes.set(sample.prefab.file, nodes);
    }
    const source = this.bindings[sample.clip.binding];
    const paths = new Map(source.targets.map(([path, transform]) => [transform, path]));
    const targets = new Map(binding.targets);
    const mapping = new Map<number, number>();
    for (const [index, node] of nodes.entries()) {
      const transform = node.extras?.source_transform;
      if (transform === undefined) continue;
      const path = paths.get(transform);
      const target = transform === source.transform ? binding.transform : path === undefined ? undefined : targets.get(path);
      const scene = target === undefined ? undefined : transforms.get(target);
      if (scene !== undefined) mapping.set(index, scene);
    }
    for (const [index, node] of nodes.entries()) {
      if (node.extras?.source_node !== undefined && mapping.has(node.extras.source_node)) mapping.set(index, mapping.get(node.extras.source_node)!);
    }
    const materialTargets = new Map<number, number[]>();
    for (const [index, target] of mapping) if (renderers.has(target)) materialTargets.set(index, renderers.get(target)!);
    document.animation(sample.clip.file, mapping, sample.clip.duration, `scene-${id}`, materialTargets);
  }
}
