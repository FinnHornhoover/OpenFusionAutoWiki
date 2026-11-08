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
  export function applySceneSettings(env: Record<string, IUniform>, settings: Record<string, unknown>): number[];
  export function clipFromGltf(parser: GLTFParser, index: number, objectOf: (index: number) => Object3D | undefined): Promise<AnimationClip>;
}

declare module 'ff-three/world' {
  import type { Object3D, IUniform } from 'three';
  import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
  import type { Dressing } from 'ff-three/materials';
  export interface Files { get(url: string): Promise<ArrayBuffer>; forget(): void }
  export interface SceneSetup {
    root: Object3D;
    settings: Record<string, unknown>;
    dressing: Dressing;
    animations: { platforms: number; playing: number; update(delta: number): void; stop(): void } | null;
    heightAt(x: number, z: number): number;
    adopt(scene: SceneSetup): void;
    dispose(): void;
  }
  export function createFiles(options: { concurrency: number; fetchBytes: (url: string) => Promise<ArrayBuffer> }): Files;
  export function loadGlb(url: string, files: Files): Promise<{ gltf: GLTF; release(): void }>;
  export function setUpScene(gltf: GLTF, options: { env: Record<string, IUniform>; grass: boolean; animate: boolean }): Promise<SceneSetup>;
}
