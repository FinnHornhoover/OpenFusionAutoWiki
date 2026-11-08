import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { dress, type Dressing } from 'ff-three/materials';
import type { Color, ModelPart, PreviewVariant } from '../../../shared/objects';
import { dressFusionMatter, repairWrenchAlpha } from './materials';

export interface NodeDef {
  name?: string;
  children?: number[];
  skin?: number;
  extras?: { renderer?: number; source_node?: number; actor_bones?: number[] };
}

export interface ModelData {
  nodes: NodeDef[];
  skins?: { extras?: { actor_bones?: { m?: number[]; f?: number[] } } }[];
  extras?: { clips?: Record<string, string>; kind?: string };
}

export interface LoadedModel {
  gltf: GLTF;
  data: ModelData;
  nodes: Map<number, THREE.Object3D>;
  url: string;
  dressing?: Dressing;
}

export function disposeTexture(texture: THREE.Texture): void {
  texture.dispose();
  if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
}

export function disposeTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      if (material instanceof THREE.ShaderMaterial) {
        for (const uniform of Object.values(material.uniforms)) if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
  for (const texture of textures) disposeTexture(texture);
}

export async function loadModel(url: string, signal: AbortSignal): Promise<LoadedModel> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Model download failed (${response.status})`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), new URL('.', url).href);
  if (signal.aborted) { disposeTree(gltf.scene); throw new DOMException('Aborted', 'AbortError'); }
  return prepareModel(gltf, url);
}

export function prepareModel(gltf: GLTF, url: string): LoadedModel {
  const nodes = new Map<number, THREE.Object3D>();
  gltf.scene.traverse((object) => {
    const index = gltf.parser.associations.get(object)?.nodes;
    if (index !== undefined) nodes.set(index, object);
    // Inactive prefabs become active when instantiated by the client.
    object.visible = true;
    if (object instanceof THREE.Mesh) object.frustumCulled = false;
  });
  const data = gltf.parser.json as ModelData;
  // Actor-only GLBs have no skin, so GLTFLoader creates ordinary nodes.
  // Promote the explicit actor table to bones before rebinding garments.
  for (const index of data.nodes.find((node) => node.extras?.actor_bones)?.extras?.actor_bones ?? []) {
    const object = nodes.get(index);
    if (!object || object instanceof THREE.Bone) continue;
    const bone = new THREE.Bone().copy(object, false);
    for (const child of [...object.children]) bone.add(child);
    object.parent?.add(bone);
    object.removeFromParent();
    const association = gltf.parser.associations.get(object);
    if (association) gltf.parser.associations.set(bone, association);
    nodes.set(index, bone);
  }
  return { gltf, data, nodes, url };
}

function tint(material: THREE.Material, color: Color): void {
  const data = material.userData;
  const colors = data.colors ??= {};
  colors._Color = color.map((c) => c * 0.5);
  const emission: number[] = colors._Emission ?? [0, 0, 0, 1];
  colors._Emission = emission.map((c, i) => c * color[i]);
}

export async function dressModel(model: LoadedModel, part: ModelPart, variant: PreviewVariant, baseUrl: string, env: Record<string, THREE.IUniform>, textures: Set<THREE.Texture>): Promise<void> {
  const loadTexture = async (key?: string): Promise<THREE.Texture | undefined> => {
    if (!key) return undefined;
    const texture = await new THREE.TextureLoader().loadAsync(`${baseUrl}/${key}`);
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    textures.add(texture);
    return texture;
  };
  const [primary, secondary] = await Promise.all([loadTexture(part.primary), loadTexture(part.secondary)]);
  model.gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const sources = Array.isArray(object.material) ? object.material : [object.material];
    for (const source of sources) for (const value of Object.values(source)) if (value instanceof THREE.Texture) textures.add(value);
    const materials = sources.map((source, index) => {
      const material = source.clone();
      material.userData = structuredClone(source.userData);
      const name = source.name.toLowerCase();
      const worn = part.mode === 'worn';
      const sub = name.includes('sub');
      const vehicle = part.mount === 'vehicle';
      const texture = vehicle ? primary : sub ? secondary : primary;
      if ((worn || index === 0) && !(worn && name.includes('override')) && (worn || name.includes('main') || sub) && texture) {
        (material as THREE.MeshStandardMaterial).map = texture;
        // ff-three checks this legacy field before the standard map.
        delete material.userData.main_texture_index;
      }
      if (worn && sub && variant.skin) tint(material, variant.skin);
      if (worn && name.includes('hair') && variant.hair) tint(material, variant.hair);
      return material;
    });
    // The client combines submesh zero and its first material for wearables.
    if (part.mode === 'worn') {
      const first = object.geometry.groups[0];
      if (first) object.geometry.setDrawRange(first.start, first.count);
      object.material = materials[0];
      materials.slice(1).forEach((m) => m.dispose());
    } else object.material = materials.length === 1 ? materials[0] : materials;
    sources.forEach((source) => source.dispose());
  });
  model.dressing = await dress(model.gltf.scene, model.gltf.parser, { env });
  dressFusionMatter(model.dressing, env);
  repairWrenchAlpha(model.dressing);
  for (const mesh of model.dressing.meshes) {
    for (const child of mesh.children) {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial && child.material.name === 'ff:outline') {
        child.material.userData.ffOutline = mesh.userData.ffExtras?.floats?._Outline ?? 0;
      }
    }
  }
}

const MOUNTS = { hat: 'Bip01 helmet01', glasses: 'Bip01 glass01', back: 'Bip01 back01', 'left-hand': 'Bip01 Lweapon01', 'right-hand': 'Bip01 Rweapon01', vehicle: 'vehicle' };

export function compose(actor: LoadedModel, garment: LoadedModel, part: ModelPart, variant: PreviewVariant): void {
  if (part.mode === 'attached') {
    const index = actor.data.nodes.findIndex((node) => node.name === MOUNTS[part.mount!]);
    const target = actor.nodes.get(index);
    if (!target) throw new Error(`Missing attachment mount: ${part.mount}`);
    if (part.mount === 'vehicle') {
      // LoadVehicle instantiates at the mount's world pose, then reparents
      // while preserving world scale. Transform the entire exported prefab
      // so detached skinned renderers stay with their skeleton too.
      const root = garment.gltf.scene.children[0];
      root.updateMatrix();
      target.updateWorldMatrix(true, false);
      const rotation = target.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
      const world = new THREE.Matrix4().compose(target.getWorldPosition(new THREE.Vector3()), rotation, root.scale.clone());
      garment.gltf.scene.matrix.copy(target.matrixWorld).invert().multiply(world).multiply(root.matrix.clone().invert());
      garment.gltf.scene.matrixAutoUpdate = false;
      target.add(garment.gltf.scene);
      return;
    }
    target.scale.set(1, 1, 1);
    // Unity instantiates the prefab root under the mount with these local TRS.
    const root = garment.gltf.scene.children[0];
    root.position.set(0, 0, 0);
    root.rotation.set(Math.PI / 2, 0, 0);
    root.scale.set(1, 1, 1);
    target.add(root);
    for (const other of [...garment.gltf.scene.children]) target.add(other);
    return;
  }

  const boneTable = actor.data.nodes.find((node) => node.extras?.actor_bones)?.extras?.actor_bones;
  if (!boneTable || !variant.gender) throw new Error('Actor bone table missing');
  const meshes: THREE.SkinnedMesh[] = [];
  garment.gltf.scene.traverse((object) => { if (object instanceof THREE.SkinnedMesh && !object.userData.ffSkip) meshes.push(object); });
  let bound = 0;
  for (const mesh of meshes) {
    const primitive = garment.gltf.parser.associations.get(mesh) as { primitives?: number } | undefined;
    if ((primitive?.primitives ?? 0) > 0) continue;
    let parent: THREE.Object3D | null = mesh;
    let index: number | undefined;
    while (parent && index === undefined) {
      index = garment.gltf.parser.associations.get(parent)?.nodes;
      parent = parent.parent;
    }
    const node = index === undefined ? undefined : garment.data.nodes[index];
    if (part.renderers && !part.renderers.includes(Number(node?.extras?.renderer))) continue;
    const mapping = node?.skin === undefined ? undefined : garment.data.skins?.[node.skin].extras?.actor_bones?.[variant.gender];
    if (!mapping) throw new Error('Garment bone mapping missing');
    const used = new Set<number>();
    const indices = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    for (let v = 0; v < indices.count; v++) for (let c = 0; c < 4; c++) if (weights.getComponent(v, c) > 0) used.add(indices.getComponent(v, c));
    const bones = mesh.skeleton.bones.map((_bone, joint) => {
      const target = actor.nodes.get(boneTable[mapping[joint]]);
      if (used.has(joint) && !(target instanceof THREE.Bone)) throw new Error(`Invalid garment joint ${joint}`);
      return target instanceof THREE.Bone ? target : actor.nodes.get(boneTable[0]) as THREE.Bone;
    });
    const skeleton = new THREE.Skeleton(bones, mesh.skeleton.boneInverses.map((m) => m.clone()));
    mesh.removeFromParent();
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    actor.gltf.scene.add(mesh);
    mesh.userData.ffWorn = true;
    mesh.bind(skeleton, new THREE.Matrix4());
    // Outline and alpha passes are children added by ff-three.
    mesh.traverse((child) => { if (child instanceof THREE.SkinnedMesh && child !== mesh) child.bind(skeleton, new THREE.Matrix4()); });
    bound++;
  }
  if (!bound) throw new Error('Wearable has no compatible skin renderer');
}
