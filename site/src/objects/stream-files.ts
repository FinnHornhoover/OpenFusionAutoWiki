import type { Files } from 'ff-three/world';

export function streamFiles(parentSignal: AbortSignal, maxBytes: number, concurrency = 4): Files & { dispose(): void } {
  const controller = new AbortController();
  const signal = AbortSignal.any([parentSignal, controller.signal]);
  const cache = new Map<string, ArrayBuffer>();
  const pending = new Map<string, Promise<ArrayBuffer>>();
  const waiting: { run(): void; reject(reason: unknown): void }[] = [];
  let bytes = 0, active = 0;
  const pump = (): void => { while (!signal.aborted && active < concurrency && waiting.length) waiting.shift()!.run(); };
  const forget = (): void => { cache.clear(); bytes = 0; };
  signal.addEventListener('abort', () => {
    forget();
    waiting.splice(0).forEach((item) => item.reject(signal.reason));
  }, { once: true });
  return {
    dispose() { controller.abort(); },
    get(url) {
      if (signal.aborted) return Promise.reject(signal.reason);
      const cached = cache.get(url);
      if (cached) { cache.delete(url); cache.set(url, cached); return Promise.resolve(cached); }
      if (!pending.has(url)) {
        const promise = new Promise<ArrayBuffer>((resolve, reject) => {
          waiting.push({ reject, run() {
            active++;
            void fetch(url, { signal }).then(async (response) => {
              if (!response.ok) throw new Error(`3D asset download failed (${response.status})`);
              const data = await response.arrayBuffer();
              signal.throwIfAborted();
              if (data.byteLength <= maxBytes) {
                cache.set(url, data); bytes += data.byteLength;
                while (bytes > maxBytes) {
                  const key = cache.keys().next().value!;
                  bytes -= cache.get(key)!.byteLength; cache.delete(key);
                }
              }
              resolve(data);
            }).catch(reject).finally(() => { active--; pump(); });
          } });
          pump();
        }).finally(() => { pending.delete(url); });
        pending.set(url, promise);
      }
      return pending.get(url)!;
    },
    forget,
  };
}
