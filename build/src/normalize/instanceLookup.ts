import AdmZip from 'adm-zip';

interface RawInstance {
  ID?: number;
  Name?: string;
}

export type InstanceNameIndex = Map<number, string>;

export function buildInstanceNameIndex(zipPath: string): InstanceNameIndex {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry('info/instance_info.json');
  const out: InstanceNameIndex = new Map();
  if (!entry) return out;

  const raw = JSON.parse(entry.getData().toString('utf8')) as Record<string, RawInstance> | RawInstance[];
  const rows = Array.isArray(raw) ? raw : Object.values(raw);
  for (const inst of rows) {
    if (!inst || typeof inst !== 'object') continue;
    const id = inst.ID ?? 0;
    const name = (inst.Name ?? '').trim();
    if (id > 0 && name) out.set(id, name);
  }
  return out;
}
