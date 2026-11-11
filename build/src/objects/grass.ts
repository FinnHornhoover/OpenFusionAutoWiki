import type { Pack } from './pack.js';

interface PatchData {
  mode: 'local-palette' | 'sparse-soa';
  records?: Uint8Array[];
  indices?: number[];
  patches?: number;
  layer_bytes?: number;
  count_bytes?: number;
  layer_indices?: Uint8Array;
  count_encoding?: 'dense' | 'delta-nonzero';
  count_length?: number;
  counts?: Uint8Array;
}
export interface DetailPrototype {
  prototypeTexture?: { r: number | null };
  usePrototypeMesh?: number;
  minWidth: number; maxWidth: number; minHeight: number; maxHeight: number;
  noiseSpread: number; bendFactor: number;
  healthyColor: Record<string, number>; dryColor: Record<string, number>;
  grayscaleLighting?: number; lightmapFactor?: number; renderMode?: number;
}
export interface DetailDatabase {
  m_Patches: { file: string };
  m_PatchCount: number;
  m_PatchSamples: number;
  m_DetailPrototypes: DetailPrototype[];
  m_WavingGrassTint?: Record<string, number>;
  WavingGrassTint?: Record<string, number>;
  m_WavingGrassStrength: number; m_WavingGrassAmount: number; m_WavingGrassSpeed: number;
}

export function grassLayers(pack: Pack, database: DetailDatabase): Map<number, Uint8Array> {
  const data = pack.msgpack<PatchData>(database.m_Patches.file);
  const count = database.m_PatchCount, samples = database.m_PatchSamples, resolution = count * samples;
  const layers = new Map<number, Uint8Array>();
  let counts = data.counts ?? new Uint8Array();
  if (data.mode === 'sparse-soa' && data.count_encoding === 'delta-nonzero') {
    const dense = new Uint8Array(data.count_length!);
    let cursor = 0, index = -1;
    while (cursor < counts.length) {
      let gap = 0, shift = 0, byte: number;
      do { byte = counts[cursor++]; gap += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
      index += gap;
      if (index >= dense.length || cursor >= counts.length) throw new Error('Invalid sparse grass counts');
      dense[index] = counts[cursor++];
    }
    counts = dense;
  }
  const patches = data.mode === 'local-palette' ? data.indices!.length : data.patches!;
  if (patches !== count * count) throw new Error('Grass patch dimensions differ');
  for (let index = 0; index < patches; index++) {
    let indices: Uint8Array, values: Uint8Array;
    if (data.mode === 'local-palette') {
      const record = Buffer.from(data.records![data.indices![index]]);
      const bytes = record.readUInt32LE(24), length = record.readUInt32LE(28);
      indices = record.subarray(32, 32 + bytes);
      values = record.subarray(32 + bytes, 32 + bytes + length);
    } else {
      indices = data.layer_indices!.subarray(index * data.layer_bytes!, (index + 1) * data.layer_bytes!);
      values = counts.subarray(index * data.count_bytes!, (index + 1) * data.count_bytes!);
    }
    if (values.length !== indices.length * samples * samples) throw new Error('Grass layer dimensions differ');
    const px = index % count, pz = Math.floor(index / count);
    for (const [layer, prototype] of indices.entries()) {
      const cells = values.subarray(layer * samples * samples, (layer + 1) * samples * samples);
      if (!cells.some(Boolean)) continue;
      let output = layers.get(prototype);
      if (!output) { output = new Uint8Array(resolution * resolution); layers.set(prototype, output); }
      for (let z = 0; z < samples; z++) output.set(cells.subarray(z * samples, (z + 1) * samples), (pz * samples + z) * resolution + px * samples);
    }
  }
  return layers;
}
