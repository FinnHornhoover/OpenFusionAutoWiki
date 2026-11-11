import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix } from 'node:path';
import { Pack } from './pack.js';

export interface PoolEntry {
  key: string;
  bytes: number;
  sha256: string;
}

export class AssetPool {
  readonly entries = new Map<string, PoolEntry>();
  private clips = new Map<string, Record<string, string>>();

  constructor(readonly directory: string) {}

  add(pack: Pack, key: string): string {
    key = posix.normalize(key);
    if (!/^(models\/(prefabs|geometry|buffers)|animations\/gltf|textures)\/[a-f0-9]{64}\.(glb|bin|webp)$/.test(key)) {
      throw new Error(`Expected content-addressed browser asset: ${key}`);
    }
    if (this.entries.has(key)) return key;

    const bytes = pack.read(key);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (basename(key).split('.')[0] !== sha256) throw new Error(`Asset content does not match its hash: ${key}`);
    this.write(key, bytes, sha256);

    if (key.endsWith('.glb')) {
      const size = bytes.readUInt32LE(12);
      const data = JSON.parse(bytes.subarray(20, 20 + size).toString('utf8')) as {
        buffers?: { uri?: string }[];
        images?: { uri?: string }[];
        extras?: { clips?: Record<string, string> };
      };
      const uris = [...data.buffers ?? [], ...data.images ?? []].flatMap((row) => row.uri ? [row.uri] : []);
      this.clips.set(key, data.extras?.clips ?? {});
      for (const uri of uris) {
        if (!uri.startsWith('data:')) this.add(pack, posix.join(posix.dirname(key), uri));
      }
    }
    return key;
  }

  store(folder: 'areas/tiles' | 'areas/terrain' | 'models/buffers' | 'textures', bytes: Buffer, extension: 'glb' | 'bin' | 'png'): string {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const key = `${folder}/${sha256}.${extension}`;
    this.write(key, bytes, sha256);
    return key;
  }

  private write(key: string, bytes: Buffer, sha256: string): void {
    if (this.entries.has(key)) return;
    const output = join(this.directory, key);
    mkdirSync(dirname(output), { recursive: true });
    if (!existsSync(output) || createHash('sha256').update(readFileSync(output)).digest('hex') !== sha256) {
      writeFileSync(output, bytes);
    }
    this.entries.set(key, { key, bytes: bytes.length, sha256 });
  }

  stageAnimations(pack: Pack, model: string, names: string[]): void {
    for (const name of new Set(names)) {
      const uri = this.clips.get(model)?.[name];
      if (uri) this.add(pack, posix.join(posix.dirname(model), uri));
    }
  }

  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify([...this.entries.values()].sort((a, b) => a.key.localeCompare(b.key))));
  }
}
