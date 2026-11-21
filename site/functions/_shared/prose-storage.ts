interface R2Object {
  etag: string;
  size?: number;
  customMetadata?: Record<string, string>;
}

export interface ProseBucketEnv {
  PROSE_IMAGES?: {
    head(key: string): Promise<R2Object | null>;
    put(key: string, value: Uint8Array, options: {
      onlyIf: Headers;
      customMetadata?: Record<string, string>;
      httpMetadata?: { contentType: string };
    }): Promise<R2Object | null>;
  };
}

export async function reserveMutation(bucket: NonNullable<ProseBucketEnv['PROSE_IMAGES']>, kind: 'uploads' | 'saves', id: number) {
  const key = `limits/${kind}/${id}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await bucket.head(key);
    const window = Math.floor(Date.now() / 60_000);
    const count = current?.customMetadata?.window === String(window)
      ? Number(current.customMetadata.count) : 0;
    if (count >= (kind === 'uploads' ? 12 : 20)) return false;
    const metadata = { window: String(window), count: String(count + 1) };
    const condition = current
      ? new Headers({ 'If-Match': `"${current.etag}"` })
      : new Headers({ 'If-None-Match': '*' });
    const result = await bucket.put(key, new TextEncoder().encode(JSON.stringify(metadata)), {
      onlyIf: condition,
      customMetadata: metadata,
    });
    if (result) return true;
  }
  return false;
}

export async function readBytes(request: Request, maxBytes: number) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
