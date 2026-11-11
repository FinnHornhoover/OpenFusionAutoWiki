import { LruCache } from '../data/lruCache';
import type { PreviewMeta } from '../../../shared/objects';

const cache = new LruCache<string, Promise<unknown>>(32);

export function previewUrl(build: string, path: string, meta: PreviewMeta): string {
  const section = path.split('/')[0];
  const shared = meta.shared?.[section];
  return shared ? shared + path.slice(section.length) : `/data/${build}/previews/${path}`;
}

export function previewJson<T>(url: string): Promise<T | null> {
  let promise = cache.get(url);
  if (!promise) {
    promise = fetch(url).then((response) => {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Preview data failed (${response.status})`);
      return response.json();
    }).catch(() => { cache.delete(url); return null; });
    cache.set(url, promise);
  }
  return promise as Promise<T | null>;
}
