import type { Pack } from './pack.js';
import type { DetailDatabase } from './grass.js';

interface Pointer { r: number | null }
interface Vector { x: number; y: number; z: number }
export interface TerrainData {
  m_Name: string;
  m_Heightmap: {
    m_Heights: { file: string };
    m_Scale: Vector;
    m_Shifts: { x: number; y: number; flags: number }[];
  };
  m_SplatDatabase: {
    m_Splats: { texture: Pointer; tileSize: { x: number; y: number }; tileOffset?: { x: number; y: number } }[];
    m_AlphaTextures: Pointer[];
  };
  m_Lightmap?: Pointer;
  m_DetailDatabase?: DetailDatabase;
}

export function terrainGeometry(pack: Pack, terrain: TerrainData): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  const map = terrain.m_Heightmap;
  const raw = pack.read(map.m_Heights.file);
  const magic = raw.toString('ascii', 0, 4);
  if (!['HMP1', 'HMD1', 'HMX1'].includes(magic)) throw new Error(`Unknown height encoding: ${magic}`);
  const width = raw.readUInt32LE(4), height = raw.readUInt32LE(8), signed = raw.readUInt32LE(12);
  if (raw.length !== 16 + width * height * 2) throw new Error('Truncated terrain heightmap');
  const heights = new Int32Array(width * height);
  for (let x = 0; x < width; x++) {
    let previous = 0;
    for (let z = 0; z < height; z++) {
      const index = x * height + z;
      let value = raw.readUInt16LE(16 + index * 2);
      if (magic === 'HMD1') value = (previous + value) & 65535;
      if (magic === 'HMX1') value ^= previous;
      previous = value;
      heights[index] = signed && value >= 32768 ? value - 65536 : value;
    }
  }

  const moves = new Map<number, number>();
  const diagonal = new Set<number>();
  for (const shift of map.m_Shifts ?? []) {
    const { x, y: z, flags } = shift;
    if (x < 0 || x >= width || z < 0 || z >= height) continue;
    moves.set(z * width + x, flags);
    for (const [cx, cz] of [[x, z], [x - 1, z], [x, z - 1], [x - 1, z - 1]]) {
      if (cx >= 0 && cz >= 0 && (cx + cz) % 2 === 0) diagonal.add(cz * width + cx);
    }
  }
  const positions = new Float32Array(width * height * 3);
  const normals = new Float32Array(positions.length);
  const uvs = new Float32Array(width * height * 2);
  const indices = new Uint32Array((width - 1) * (height - 1) * 6);
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const index = z * width + x, flags = moves.get(index) ?? 0;
    const px = (x - Number(!!(flags & 1)) + Number(!!(flags & 2))) * map.m_Scale.x;
    const pz = (z - Number(!!(flags & 4)) + Number(!!(flags & 8))) * map.m_Scale.z;
    positions.set([-px, heights[x * height + z] / 32766 * map.m_Scale.y, pz], index * 3);
    uvs.set([px / ((width - 1) * map.m_Scale.x), 1 - pz / ((height - 1) * map.m_Scale.z)], index * 2);
  }
  let offset = 0;
  for (let z = 0; z < height - 1; z++) for (let x = 0; x < width - 1; x++) {
    const a = z * width + x, b = a + 1, c = a + width, d = c + 1;
    indices.set(diagonal.has(a) ? [a, b, c, b, d, c] : [a, d, c, a, b, d], offset);
    offset += 6;
  }
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const ax = positions[b] - positions[a], ay = positions[b + 1] - positions[a + 1], az = positions[b + 2] - positions[a + 2];
    const bx = positions[c] - positions[a], by = positions[c + 1] - positions[a + 1], bz = positions[c + 2] - positions[a + 2];
    const face = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    for (const vertex of [a, b, c]) for (let k = 0; k < 3; k++) normals[vertex + k] += face[k];
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (length) for (let k = 0; k < 3; k++) normals[i + k] /= length;
    else normals[i + 1] = 1;
  }
  return { positions, normals, uvs, indices };
}
