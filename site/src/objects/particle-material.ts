import * as THREE from 'three';
import { canvasAlpha, shaderBlend } from './blend';
import { VFX_SHADERS } from '../../../shared/shaders.js';
import { effectSurface, type EffectExtras, type EffectTextures } from './effect-shader';

interface MaterialData { extras?: EffectExtras }
export function particleMaterial(data: MaterialData, texture: THREE.Texture | null, trail = false, preserveAlpha = true, textures: EffectTextures = {}): THREE.ShaderMaterial {
  const extras = data.extras, blend = shaderBlend(extras?.shader ?? '');
  if (!blend) throw new Error(`Unsupported particle shader: ${extras?.shader}`);
  const surface = VFX_SHADERS.includes(extras?.shader ?? '') ? effectSurface(extras!, { ...textures, _MainTex: texture }, { value: 0 }) : undefined;
  const tint = extras?.colors?._TintColor ?? [0.5, 0.5, 0.5, 0.5];
  const st = extras?.textures?._MainTex, scale = st?.scale ?? [1, 1], offset = st?.offset ?? [0, 0];
  const material = new THREE.ShaderMaterial({
    defines: trail ? { FF_TRAIL: '' } : {},
    name: 'ff:particle', side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: blend.source, blendDst: blend.destination, blendEquation: THREE.AddEquation,
    blendSrcAlpha: preserveAlpha ? THREE.ZeroFactor : THREE.OneFactor, blendDstAlpha: preserveAlpha ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
    uniforms: {
      map: { value: texture }, hasMap: { value: !!texture }, tint: { value: new THREE.Vector4().fromArray(tint) },
      time: { value: 0 },
      uvST: { value: new THREE.Vector4(scale[0], scale[1], offset[0], offset[1]) },
      billboard: { value: 0 }, maxSize: { value: 10 },
      ...surface?.uniforms,
    },
    vertexShader: `
      attribute vec3 center; attribute vec2 dimensions; attribute vec4 particleColor; attribute float angle; attribute vec4 rectangle;
      uniform int billboard; uniform float maxSize; varying vec2 vUv; varying vec4 vColor;
      void main() {
#ifdef FF_TRAIL
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.);
        vUv = uv; vColor = particleColor;
#else
        vec3 viewCenter = (viewMatrix * vec4(center, 1.)).xyz;
        vec2 projectedSize = dimensions * vec2(projectionMatrix[0][0], projectionMatrix[1][1]) / max(.0001, -2. * viewCenter.z);
        float sizeScale = min(1., maxSize / max(.0001, max(projectedSize.x, projectedSize.y)));
        vec2 p = position.xy * dimensions * sizeScale;
        p = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * p;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        if (billboard == 4) { right = vec3(1., 0., 0.); up = vec3(0., 0., -1.); }
        if (billboard == 5) { right.y = 0.; right = normalize(right); up = vec3(0., 1., 0.); }
        gl_Position = projectionMatrix * viewMatrix * vec4(center + right * p.x + up * p.y, 1.);
        vUv = rectangle.xy + uv * rectangle.zw; vColor = particleColor;
#endif
      }`,
    fragmentShader: `
      ${surface?.glsl ?? 'uniform sampler2D map; uniform bool hasMap; uniform vec4 tint; uniform vec4 uvST;'}
      varying vec2 vUv; varying vec4 vColor;
      void main() {
        ${surface ? 'gl_FragColor = ffEffect(vUv, vColor);' : `
        vec2 p = vUv * uvST.xy + uvST.zw;
        p.y = 1. - p.y;
        vec4 tex = hasMap ? texture2D(map, p) : vec4(1.);
        gl_FragColor = clamp(tex * vColor * tint * 2., 0., 1.);`}
      }`,
  });
  if (!preserveAlpha) canvasAlpha(material);
  return material;
}
