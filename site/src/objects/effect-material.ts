import * as THREE from 'three';
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import type { Dressing } from 'ff-three/materials';
import { VFX_SHADERS } from '../../../shared/shaders.js';
import { effectSurface, type EffectExtras, type EffectTextures } from './effect-shader';
import { shaderBlend } from './blend';

export async function effectTextures(extras: EffectExtras, parser: GLTFParser): Promise<EffectTextures> {
  const slots = extras.shader === 'VFX_ScrollDistort_wMask_Gradient_Additive' ? ['_MainTex', '_MainTex2', '_NoiseTex', '_MaskTex']
    : extras.shader === 'VFX_SimpleDualScrolling_Additive' ? ['_MainTex', '_MainTex2'] : ['_MainTex'];
  const results = await Promise.allSettled(slots.map(async (key) => {
    const index = extras.textures?.[key]?.index;
    const texture: THREE.Texture | null = index === undefined ? null : await parser.getDependency('texture', index);
    if (texture) { texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true; }
    return [key, texture] as const;
  }));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return Object.fromEntries(results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []));
}

export async function dressVfx(dressing: Dressing, parser: GLTFParser, env: Record<string, THREE.IUniform>): Promise<void> {
  const meshes = dressing.meshes.filter((mesh) => VFX_SHADERS.includes(mesh.userData.ffExtras?.shader ?? ''));
  if (!meshes.length) return;
  const materials = new Map<THREE.Mesh, THREE.ShaderMaterial[]>();
  const dispose = dressing.dispose.bind(dressing);
  dressing.dispose = () => {
    for (const list of materials.values()) for (const material of list) material.dispose();
    dispose();
  };
  for (const mesh of meshes) {
    const extras = mesh.userData.ffExtras as EffectExtras;
    const source = mesh.material as THREE.ShaderMaterial;
    const textures = await effectTextures(extras, parser);
    textures._MainTex = source.uniforms.map?.value ?? textures._MainTex;
    const surface = effectSurface(extras, textures, env.time);
    const blend = shaderBlend(extras.shader!)!;
    const material = new THREE.ShaderMaterial({
      name: `ff:${extras.shader}`, uniforms: surface.uniforms, vertexColors: !!mesh.geometry.getAttribute('color'),
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending,
      blendSrc: blend.source, blendDst: blend.destination, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      vertexShader: `
        #include <common>
        #include <skinning_pars_vertex>
        varying vec2 vUv;
        varying vec4 vColor;
        void main() {
          #include <begin_vertex>
          #include <skinbase_vertex>
          #include <skinning_vertex>
          vUv = vec2(uv.x, 1.0 - uv.y);
          #ifdef USE_COLOR_ALPHA
            vColor = color;
          #elif defined(USE_COLOR)
            vColor = vec4(color, 1.0);
          #else
            vColor = vec4(1.0);
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
        }`,
      fragmentShader: `${surface.glsl}
        varying vec2 vUv;
        varying vec4 vColor;
        void main() { gl_FragColor = ffEffect(vUv, vColor); }`,
    });
    mesh.material = material;
    mesh.renderOrder = 3;
    mesh.userData.ffInfo.family = 'vfx';
    materials.set(mesh, [material]);
  }

  const unique = dressing.unique.bind(dressing);
  dressing.unique = (mesh) => materials.has(mesh) ? Promise.resolve(materials.get(mesh)!) : unique(mesh);
}
