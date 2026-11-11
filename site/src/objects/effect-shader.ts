import * as THREE from 'three';

export interface EffectExtras {
  shader?: string;
  colors?: Record<string, number[]>;
  floats?: Record<string, number>;
  textures?: Record<string, { index?: number; scale?: number[]; offset?: number[] }>;
}

export type EffectTextures = Partial<Record<string, THREE.Texture | null>>;

const defaults: Record<string, number> = {
  _RotationSpeed: 1, _CenterX: 0.5, _CenterY: 0.5, _VignetteIntensity: 0, _VignettePower: 2,
  _Columns: 4, _Rows: 4, _AnimationSpeed: 10,
  _ScrollX1: 0, _ScrollY1: 0, _ScrollX2: 0, _ScrollY2: 0, _EmissionStrength: 1, _MasterOpacity: 1,
  _ScrollSpeedU: 1, _ScrollSpeedV: 1, _RadialScale: 1, _AngularScale: 1,
  _BlendMode: 0, _DistortionStrength: 0.1, _NoiseScrollU: 0.5, _NoiseScrollV: 0.5, _NoiseScale: 1,
  _MainScrollU: 0, _MainScrollV: 0, _Main2ScrollU: 0, _Main2ScrollV: 0, _MaskScrollU: 0, _MaskScrollV: 0,
  _GradientRotation: 0, _GradientTopIntensity: 1, _GradientBottomIntensity: 1, _GradientTopPower: 1, _GradientBottomPower: 1,
};

// UVs entering this function use Unity's V axis; flip only at texture lookup.
export function effectSurface(extras: EffectExtras, textures: EffectTextures, time: THREE.IUniform<number>): { uniforms: Record<string, THREE.IUniform>; glsl: string } {
  const shader = extras.shader ?? '';
  const color = (key: string): THREE.IUniform<THREE.Vector4> => ({ value: new THREE.Vector4().fromArray(extras.colors?.[key] ?? [1, 1, 1, 1]) });
  const st = (key: string): THREE.IUniform<THREE.Vector4> => {
    const texture = extras.textures?.[key];
    return { value: new THREE.Vector4().fromArray([...(texture?.scale ?? [1, 1]), ...(texture?.offset ?? [0, 0])]) };
  };
  const uniforms: Record<string, THREE.IUniform> = {
    time, ffTextureRotation: { value: 0 }, color: color('_Color'), _Color1: color('_Color1'), _Color2: color('_Color2'),
    map: { value: textures._MainTex ?? null }, hasMap: { value: !!textures._MainTex }, uvST: st('_MainTex'),
    map2: { value: textures._MainTex2 ?? null }, hasMap2: { value: !!textures._MainTex2 }, uvST2: st('_MainTex2'),
    noiseMap: { value: textures._NoiseTex ?? null }, hasNoise: { value: !!textures._NoiseTex },
    maskMap: { value: textures._MaskTex ?? null }, hasMask: { value: !!textures._MaskTex }, maskST: st('_MaskTex'),
  };
  for (const [key, value] of Object.entries(defaults)) uniforms[key] = { value: extras.floats?.[key] ?? (shader === 'VFX_PolarScrolling_Additive' && /^_Center[XY]$/.test(key) ? 0 : value) };

  let body: string;
  if (shader === 'VFX_SimpleDualScrolling_Additive') {
    // This program uses only vertex alpha, and shares MainTex's ST across both textures.
    body = `
      vec4 first = ffMain(p + time * vec2(_ScrollX1, _ScrollY1)) * _Color1;
      vec4 second = ffSample(map2, hasMap2, p + time * vec2(_ScrollX2, _ScrollY2)) * _Color2;
      vec4 result = first + second;
      return vec4(result.rgb * _EmissionStrength, result.a * vertexColor.a * _MasterOpacity);`;
  } else if (shader === 'VFX_PolarScrolling_Additive') {
    body = `
      vec2 center = p - 0.5 + vec2(_CenterX, _CenterY);
      float angle = dot(center, center) > 0.0 ? atan(center.y, center.x) : 0.0;
      vec2 polar = vec2(fract((angle * _AngularScale + 3.14159265359) / 6.28318530718 + time * _ScrollSpeedU), length(center) * _RadialScale + time * _ScrollSpeedV);
      return ffMain(polar) * color * vertexColor * ffVignette(p);`;
  } else if (shader === 'VFX_ScrollDistort_wMask_Gradient_Additive') {
    body = `
      vec2 noiseUv = uv * _NoiseScale + time * vec2(_NoiseScrollU, _NoiseScrollV);
      vec2 distortion = (ffSample(noiseMap, hasNoise, noiseUv).rg - 0.5) * _DistortionStrength;
      vec4 first = ffMain(p + distortion + time * vec2(_MainScrollU, _MainScrollV)) * color;
      vec4 second = ffSample(map2, hasMap2, uv * uvST2.xy + uvST2.zw + distortion + time * vec2(_Main2ScrollU, _Main2ScrollV)) * _Color2;
      float mask = ffSample(maskMap, hasMask, uv * maskST.xy + maskST.zw + time * vec2(_MaskScrollU, _MaskScrollV)).r;
      float gradient = dot(uv - 0.5, vec2(sin(_GradientRotation), cos(_GradientRotation))) + 0.5;
      float fade = pow(abs(gradient), _GradientTopPower) * _GradientTopIntensity * pow(abs(1.0 - gradient), _GradientBottomPower) * _GradientBottomIntensity;
      return (_BlendMode < 0.5 ? first * second : first + second) * vertexColor * mask * fade;`;
  } else {
    body = `
      float angle = time * _RotationSpeed;
      vec2 center = vec2(_CenterX, _CenterY);
      vec2 rotated = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * (p - center) + center;
      ${shader === 'VFX_RotatingFlipbook' ? `
      float columns = max(1.0, _Columns), rows = max(1.0, _Rows);
      float frame = floor(time * _AnimationSpeed);
      vec2 index = vec2(frame, floor(frame / columns));
      index = sign(index) * mod(abs(index), vec2(columns, rows));
      rotated = (rotated + index) / vec2(columns, rows);` : ''}
      return ffMain(rotated) * color * vertexColor * ffVignette(p);`;
  }

  return { uniforms, glsl: `
    uniform sampler2D map, map2, noiseMap, maskMap;
    uniform bool hasMap, hasMap2, hasNoise, hasMask;
    uniform vec4 color, _Color1, _Color2, uvST, uvST2, maskST;
    uniform float time, ffTextureRotation;
    ${Object.keys(defaults).map((key) => `uniform float ${key};`).join('\n')}
    vec4 ffSample(sampler2D image, bool present, vec2 uv) {
      return present ? texture2D(image, vec2(uv.x, 1.0 - uv.y)) : vec4(1.0);
    }
    vec4 ffMain(vec2 uv) {
      float c = cos(ffTextureRotation), s = sin(ffTextureRotation);
      uv = mat2(c, s, -s, c) * (uv - 0.5) + 0.5;
      return ffSample(map, hasMap, uv);
    }
    float ffVignette(vec2 uv) {
      return 1.0 - clamp(pow(length(uv - 0.5) * 2.0, _VignettePower), 0.0, 1.0) * _VignetteIntensity;
    }
    vec4 ffEffect(vec2 uv, vec4 vertexColor) {
      vec2 p = uv * uvST.xy + uvST.zw;
      ${body}
    }` };
}
