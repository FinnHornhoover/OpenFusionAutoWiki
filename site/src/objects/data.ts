import { LruCache } from '../data/lruCache';

const cache = new LruCache<string, Promise<unknown>>(32);

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
