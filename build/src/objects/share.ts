import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PreviewMeta } from '../../../shared/objects.js';
import { log } from '../log.js';

function fingerprint(path: string): { hash: string; files: number } {
  const hash = createHash('sha256');
  let files = 0;
  const visit = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(join(directory, entry.name), `${relative}/`);
      else {
        hash.update(relative).update('\0').update(createHash('sha256').update(readFileSync(join(directory, entry.name))).digest());
        files++;
      }
    }
  };
  visit(path, '');
  return { hash: hash.digest('hex'), files };
}

export function sharePreviews(dataRoot: string, builds: Set<string>): number {
  let removed = 0;
  for (const build of builds) {
    if (!build.endsWith('-fixed')) continue;
    const source = build.slice(0, -'-fixed'.length);
    if (!builds.has(source)) continue;
    const directory = join(dataRoot, build, 'previews');
    const sourceDirectory = join(dataRoot, source, 'previews');
    const meta = JSON.parse(readFileSync(join(directory, 'meta.json'), 'utf8')) as PreviewMeta;
    const shared: Record<string, string> = { ...meta.shared };
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !existsSync(join(sourceDirectory, entry.name))) continue;
      const path = join(directory, entry.name);
      const target = fingerprint(path);
      if (target.hash !== fingerprint(join(sourceDirectory, entry.name)).hash) continue;
      shared[entry.name] = `/data/${source}/previews/${entry.name}`;
      removed += target.files;
      rmSync(path, { recursive: true });
    }
    meta.shared = shared;
    writeFileSync(join(directory, 'meta.json'), JSON.stringify(meta));
  }
  log.done(`3D preview data: shared ${removed.toLocaleString()} identical files across fixed builds`);
  return removed;
}
