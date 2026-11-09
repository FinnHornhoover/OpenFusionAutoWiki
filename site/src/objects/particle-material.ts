import * as THREE from 'three';
import { canvasAlpha, shaderBlend } from './blend';

interface MaterialData { extras?: { shader?: string; colors?: Record<string, number[]>; floats?: Record<string, number>; textures?: { _MainTex?: { index?: number; scale?: number[]; offset?: number[] } } } }
export function particleMaterial(data: MaterialData, texture: THREE.Texture | null, trail = false, preserveAlpha = true): THREE.ShaderMaterial {
  const extras = data.extras, blend = shaderBlend(extras?.shader ?? '');
  const rotate = /^VFX_TextureRotate(?:_Additive)?$/.test(extras?.shader ?? '');
  if (!blend && !rotate) throw new Error(`Unsupported particle shader: ${extras?.shader}`);
  const source = rotate ? THREE.SrcAlphaFactor : blend!.source;
  const destination = (rotate
    ? extras?.shader === 'VFX_TextureRotate_Additive' ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor
    : blend!.destination) as THREE.BlendingDstFactor;
  const tint = rotate ? extras?.colors?._Color ?? [1, 1, 1, 1] : extras?.colors?._TintColor ?? [0.5, 0.5, 0.5, 0.5];
  const st = extras?.textures?._MainTex, scale = st?.scale ?? [1, 1], offset = st?.offset ?? [0, 0];
  const material = new THREE.ShaderMaterial({
    defines: { ...(trail ? { FF_TRAIL: '' } : {}), ...(rotate ? { FF_TEXTURE_ROTATE: '' } : {}) },
    name: 'ff:particle', side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: source, blendDst: destination, blendEquation: THREE.AddEquation,
    blendSrcAlpha: preserveAlpha ? THREE.ZeroFactor : THREE.OneFactor, blendDstAlpha: preserveAlpha ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
    uniforms: {
      map: { value: texture }, hasMap: { value: !!texture }, tint: { value: new THREE.Vector4().fromArray(tint) },
      time: { value: 0 }, rotationSpeed: { value: extras?.floats?._RotationSpeed ?? 1 },
      rotationCenter: { value: new THREE.Vector2(extras?.floats?._CenterX ?? 0.5, extras?.floats?._CenterY ?? 0.5) },
      vignette: { value: new THREE.Vector2(extras?.floats?._VignetteIntensity ?? 0, extras?.floats?._VignettePower ?? 2) },
      uvST: { value: new THREE.Vector4(scale[0], scale[1], offset[0], offset[1]) },
      billboard: { value: 0 }, maxSize: { value: 10 },
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
      uniform sampler2D map; uniform bool hasMap; uniform vec4 tint; uniform vec4 uvST;
      uniform float time; uniform float rotationSpeed; uniform vec2 rotationCenter; uniform vec2 vignette;
      varying vec2 vUv; varying vec4 vColor;
      void main() {
        vec2 p = vUv * uvST.xy + uvST.zw;
#ifdef FF_TEXTURE_ROTATE
        float a = time * rotationSpeed;
        float edge = 1. - clamp(pow(length(p - .5) * 2., vignette.y), 0., 1.) * vignette.x;
        p = mat2(cos(a), sin(a), -sin(a), cos(a)) * (p - rotationCenter) + rotationCenter;
#endif
        p.y = 1. - p.y;
        vec4 tex = hasMap ? texture2D(map, p) : vec4(1.);
#ifdef FF_TEXTURE_ROTATE
        vec4 color = tex * vColor * tint * edge;
#else
        vec4 color = tex * vColor * tint * 2.;
#endif
        gl_FragColor = clamp(color, 0., 1.);
      }`,
  });
  if (!preserveAlpha) canvasAlpha(material);
  return material;
}
