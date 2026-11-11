import { Matrix4 } from 'three';

interface Packed { m_NumItems: number; m_BitSize: number; m_Data: Uint8Array }
interface SkinData {
  m_Skin?: Record<string, number>[];
  m_BindPose?: Record<string, number>[];
  compressed_channels?: { m_Weights: Packed; m_BoneIndices: Packed };
}
function unpack(data: Packed): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.m_NumItems; i++) {
    let value = 0;
    for (let bit = 0; bit < data.m_BitSize; bit++) { const index = i * data.m_BitSize + bit; value += ((data.m_Data[index >> 3] >> (index & 7)) & 1) * 2 ** bit; }
    result.push(value);
  }
  return result;
}
export function skinAttributes(raw: SkinData, vertices: number, bones: number): { joints: Uint16Array; weights: Float32Array } {
  const rows: [number, number][][] = [];
  if (raw.m_Skin?.length) {
    for (const vertex of raw.m_Skin) rows.push(Array.from({ length: 4 }, (_, i): [number, number] => [vertex[`boneIndex[${i}]`], vertex[`weight[${i}]`]]).filter(([, weight]) => weight > 0));
  } else if (raw.compressed_channels) {
    const weights = unpack(raw.compressed_channels.m_Weights), indices = unpack(raw.compressed_channels.m_BoneIndices);
    let cursor = 0, total = 0, row: [number, number][] = [];
    for (const value of weights) {
      if (value > 31 || total + value > 31 || cursor >= indices.length) throw new Error('Invalid compressed skin weights');
      row.push([indices[cursor++], value / 31]); total += value;
      if (total < 31 && row.length === 3) { row.push([indices[cursor++], (31 - total) / 31]); total = 31; }
      if (total === 31) { rows.push(row); row = []; total = 0; }
    }
    if (row.length || cursor !== indices.length) throw new Error('Truncated compressed skin');
  }
  if (rows.length !== vertices) throw new Error('Skin vertex count differs');
  const joints = new Uint16Array(vertices * 4), weights = new Float32Array(vertices * 4);
  for (const [vertex, row] of rows.entries()) {
    const merged = new Map<number, number>();
    for (const [bone, weight] of row) {
      if (!Number.isFinite(weight) || weight < 0 || !Number.isInteger(bone) || bone < 0 || bone >= bones) throw new Error('Invalid skin influence');
      if (weight) merged.set(bone, (merged.get(bone) ?? 0) + weight);
    }
    const influences = [...merged].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
    const sum = influences.reduce((n, [, weight]) => n + weight, 0);
    if (!(sum > 0)) throw new Error('Skin vertex has no influence');
    for (const [i, [bone, weight]] of influences.entries()) { joints[vertex * 4 + i] = bone; weights[vertex * 4 + i] = weight / sum; }
  }
  return { joints, weights };
}
export function storedBind(raw: SkinData, count: number, index: number): Matrix4 | undefined {
  if (raw.m_BindPose?.length !== count) return undefined;
  const source = raw.m_BindPose[index];
  const values = Array.from({ length: 16 }, (_, i) => source[`e${i % 4}${Math.floor(i / 4)}`] * ((i % 4 === 0) !== (Math.floor(i / 4) === 0) ? -1 : 1));
  if (!values.every(Number.isFinite)) throw new Error('Invalid bind matrix');
  return new Matrix4().fromArray(values);
}
