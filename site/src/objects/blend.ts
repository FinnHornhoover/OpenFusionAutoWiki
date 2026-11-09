import * as THREE from 'three';

export const blendFactors: Record<string, THREE.BlendingSrcFactor> = {
  one: THREE.OneFactor, zero: THREE.ZeroFactor, srccolor: THREE.SrcColorFactor, invsrccolor: THREE.OneMinusSrcColorFactor,
  srcalpha: THREE.SrcAlphaFactor, invsrcalpha: THREE.OneMinusSrcAlphaFactor, destalpha: THREE.DstAlphaFactor,
  invdestalpha: THREE.OneMinusDstAlphaFactor, destcolor: THREE.DstColorFactor, invdestcolor: THREE.OneMinusDstColorFactor,
};

const customEffects = new Set(['VFX_TextureRotate', 'VFX_TextureRotate_Additive', 'VFX_RotatingFlipbook', 'VFX_SimpleDualScrolling_Additive', 'VFX_PolarScrolling_Additive', 'VFX_ScrollDistort_wMask_Gradient_Additive']);

export function shaderBlend(name: string): { source: THREE.BlendingSrcFactor; destination: THREE.BlendingDstFactor; depthWrite?: boolean; side?: THREE.Side; alphaPrimary?: boolean } | undefined {
  const custom = name.replace(/^ff:/, '');
  // Render states from these shaders' exported ShaderLab, which glTF marks opaque.
  if (customEffects.has(custom)) return { source: THREE.SrcAlphaFactor, destination: custom.endsWith('_Additive') ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor, depthWrite: false, side: THREE.DoubleSide };
  if (custom === 'diffuseFade' || custom === 'retro_diffuseFade') return { source: THREE.SrcAlphaFactor, destination: THREE.OneMinusSrcAlphaFactor, alphaPrimary: true };
  const match = /blend(Invdestcolor|Invdestalpha|Invsrccolor|Invsrcalpha|Srccolor|Srcalpha|Destcolor|Destalpha|One|Zero)(Invdestcolor|Invdestalpha|Invsrccolor|Invsrcalpha|Srccolor|Srcalpha|Destcolor|Destalpha|One|Zero)/i.exec(name);
  return match ? {
    source: blendFactors[match[1].toLowerCase()], destination: blendFactors[match[2].toLowerCase()] as THREE.BlendingDstFactor,
    ...(/zwriteOff/i.test(name) ? { depthWrite: false } : {}),
    ...(/cullOff/i.test(name) ? { side: THREE.DoubleSide } : {}),
  } : undefined;
}

export function canvasAlpha(material: THREE.ShaderMaterial, preserveAlpha = false): void {
  if (material.fragmentShader.includes('float ffCanvasCoverage')) return;
  if (material.blending !== THREE.CustomBlending) return;
  const source = material.blendSrc, destination = material.blendDst;
  const screen = destination === THREE.OneMinusSrcColorFactor;
  if (!screen && destination !== THREE.OneFactor && destination !== THREE.DstAlphaFactor) return;

  // Additive light must not make the canvas opaque. Preserve destination alpha
  // so the browser adds the emitted RGB over the page background too. Screen
  // blends also attenuate the background, so approximate their coverage below.
  let factor = '1.0';
  if (source === THREE.SrcAlphaFactor) factor = 'gl_FragColor.a';
  else if (source === THREE.OneMinusSrcAlphaFactor) factor = '(1.0 - gl_FragColor.a)';
  else if (source === THREE.SrcColorFactor) factor = 'gl_FragColor.rgb';
  if (!preserveAlpha) {
    if (source === THREE.DstAlphaFactor || screen && (source === THREE.SrcAlphaFactor || source === THREE.OneMinusSrcAlphaFactor || source === THREE.SrcColorFactor)) material.blendSrc = THREE.OneFactor;
    if (destination === THREE.DstAlphaFactor) material.blendDst = THREE.OneFactor;
  }
  const contribution = source === THREE.OneMinusSrcColorFactor ? 'gl_FragColor.rgb * (1.0 - gl_FragColor.rgb)' : source === THREE.ZeroFactor ? 'vec3(0.0)' : 'gl_FragColor.rgb';
  material.fragmentShader = material.fragmentShader.replace(/}\s*$/, `
    vec3 ffCanvasRaw = gl_FragColor.rgb;
    vec3 ffCanvasLight = (${contribution}) * ${factor};
    ${screen ? 'ffCanvasLight = max(ffCanvasLight, ffCanvasRaw);' : ''}
    float ffCanvasCoverage = clamp(max(ffCanvasLight.r, max(ffCanvasLight.g, ffCanvasLight.b)), 0.0, 1.0);
    if (ffCanvasCoverage <= 0.0) discard;
    ${!preserveAlpha && screen ? `gl_FragColor.rgb *= ${factor}; gl_FragColor.a = ffCanvasCoverage;` : ''}
  }`);
  if (!preserveAlpha) {
    material.blendSrcAlpha = screen ? THREE.OneFactor : THREE.ZeroFactor;
    material.blendDstAlpha = screen ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor;
  }
  material.needsUpdate = true;
}
