declare module 'ff-three/materials' {
  import type { Material, Mesh, Object3D, IUniform } from 'three';
  import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
  export interface Dressing {
    meshes: Mesh[];
    unique(mesh: Mesh): Promise<Material[]>;
    dispose(): void;
  }
  export function dress(root: Object3D, parser: GLTFParser, options: { env: Record<string, IUniform>; outlines?: boolean }): Promise<Dressing>;
  export function outlineMaterial(options: { extras: Record<string, unknown> }): Material;
}

declare module 'ff-three' {
  import type { AnimationClip, Object3D, IUniform } from 'three';
  import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
  export function createEnvironment(): Record<string, IUniform>;
  export function clipFromGltf(parser: GLTFParser, index: number, objectOf: (index: number) => Object3D | undefined): Promise<AnimationClip>;
}
