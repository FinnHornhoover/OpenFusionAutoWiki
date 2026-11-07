import * as THREE from 'three';
import { outlineMaterial, type Dressing } from 'ff-three/materials';

interface FusionExtras {
  shader: string;
  colors?: Record<string, number[]>;
  floats?: Record<string, number>;
}

// Retrobution's SkinnedFusionMatterLightDir shader stores three effects in
// one RGB texture. Defaults and arithmetic follow its exported ShaderLab.
function fusionMatter(source: THREE.ShaderMaterial, extras: FusionExtras, env: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  const color = (name: string, fallback: number[]): THREE.Vector4 => new THREE.Vector4().fromArray(extras.colors?.[name] ?? fallback);
  return new THREE.ShaderMaterial({
    name: `ff:${extras.shader}`,
    uniforms: {
      map: source.uniforms.map,
      time: env.time,
      lightDir: env.lightDir,
      color: { value: color('_Color', [0.6, 0.6, 0.6, 1]) },
      fusionTint: { value: color('_FusionTint', [0, 1, 0, 1]) },
      bubblesTint: { value: color('_BubblesTint', [1, 0.976, 0.208, 1]) },
      electricityTint: { value: color('_ElectricityTint', [0.529, 0.576, 1, 1]) },
      rimColor: { value: color('_RimColor', [1, 0.976, 0.208, 1]) },
      shadowStrength: { value: extras.floats?._ShadowStrength ?? 0.65 },
    },
    transparent: true,
    depthWrite: true,
    vertexShader: `
      #include <common>
      #include <skinning_pars_vertex>
      uniform vec3 lightDir;
      uniform vec4 color;
      uniform float shadowStrength;
      varying vec2 vUv;
      varying vec3 vNormal, vView, vPrimary;
      varying float vUp;
      void main() {
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vUv = uv;
        vNormal = normalize(normalMatrix * objectNormal);
        vec3 light = normalize((viewMatrix * vec4(lightDir, 0.0)).xyz);
        float shade = 1.0 + (max(dot(vNormal, light), 0.0) - 1.0) * shadowStrength;
        vPrimary = shade * color.rgb + 0.3;
        vUp = normalize(mat3(modelMatrix) * objectNormal).y;
        vec4 view = modelViewMatrix * vec4(transformed, 1.0);
        vView = normalize(-view.xyz);
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform float time;
      uniform vec4 color, fusionTint, bubblesTint, electricityTint, rimColor;
      varying vec2 vUv;
      varying vec3 vNormal, vView, vPrimary;
      varying float vUp;
      void main() {
        // Exported UVs already have Unity's V axis inverted.
        float t = time;
        vec2 fusion = texture2D(map, vUv + vec2(0.0, -0.25 * t)).rg;
        float bubbles = texture2D(map, vUv + vec2(0.0, 0.15 * t)).g;
        vec2 electricityUv = vUv + vec2(0.0, 0.35 * t) + fusion * vec2(0.65, -0.65);
        float electricity = texture2D(map, electricityUv).b;
        vec3 base = fusion.r * fusionTint.rgb + bubbles * bubblesTint.rgb * 0.5;
        base += clamp(vUp * 2.0 - 0.6, 0.0, 1.0) * vec3(0.6, 0.45, 0.24);
        float rim = 1.0 - clamp(dot(vNormal, vView), 0.0, 1.0);
        vec3 effects = electricity * electricityTint.rgb + rim * rim * rimColor.a * rimColor.rgb;
        gl_FragColor = vec4(base * vPrimary * 1.25 + effects, color.a);
      }`,
  });
}

export function dressFusionMatter(dressing: Dressing, env: Record<string, THREE.IUniform>): void {
  const materials = new Map<THREE.Mesh, THREE.Material[]>();
  for (const mesh of dressing.meshes) {
    const extras = mesh.userData.ffExtras;
    if (extras?.shader !== 'SkinnedFusionMatterLightDir_blendSrcalphaInvsrcalpha') continue;
    const material = fusionMatter(mesh.material as THREE.ShaderMaterial, extras, env);
    mesh.material = material;
    mesh.renderOrder = -1;
    mesh.userData.ffInfo.family = 'fusion';
    materials.set(mesh, [material]);
    if ((extras.floats?._Outline ?? 0.005) > 0) {
      const outline = outlineMaterial({ extras: { ...extras, floats: { ...extras.floats, _Outline: extras.floats?._Outline ?? 0.005 } } });
      outline.name = 'ff:outline';
      const hull = mesh instanceof THREE.SkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, outline) : new THREE.Mesh(mesh.geometry, outline);
      if (hull instanceof THREE.SkinnedMesh && mesh instanceof THREE.SkinnedMesh) {
        hull.bindMode = mesh.bindMode;
        hull.bind(mesh.skeleton, mesh.bindMatrix);
      }
      hull.frustumCulled = false;
      hull.raycast = () => {};
      mesh.add(hull);
      materials.get(mesh)!.push(outline);
    }
  }

  const unique = dressing.unique.bind(dressing);
  dressing.unique = (mesh) => materials.has(mesh) ? Promise.resolve(materials.get(mesh)!) : unique(mesh);
  const dispose = dressing.dispose.bind(dressing);
  dressing.dispose = () => {
    for (const list of materials.values()) for (const material of list) material.dispose();
    dispose();
  };
}

export function repairWrenchAlpha(dressing: Dressing): void {
  const repair = (mesh: THREE.Mesh, materials: THREE.Material[]): void => {
    const extras = mesh.userData.ffExtras;
    // The beta clients store this RGB atlas as ARGB32 with zero alpha.
    // Preserve its colors while making the wrench's base pass visible.
    if (extras?.textures?._MainTex?.texture !== 'melee_valerionssword.dds' || mesh.userData.ffInfo?.family !== 'toon') return;
    for (const material of materials) {
      if (!(material instanceof THREE.ShaderMaterial) || material.name === 'ff:outline') continue;
      if (material.fragmentShader.includes('gl_FragColor.a = color.a;')) continue;
      material.fragmentShader = material.fragmentShader.replace(/}\s*$/, 'gl_FragColor.a = color.a;\n}');
      material.needsUpdate = true;
    }
  };
  for (const mesh of dressing.meshes) repair(mesh, Array.isArray(mesh.material) ? mesh.material : [mesh.material]);

  const unique = dressing.unique.bind(dressing);
  dressing.unique = async (mesh) => {
    const materials = await unique(mesh);
    repair(mesh, materials);
    return materials;
  };
}
