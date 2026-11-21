import { imageSize } from 'image-size';
import { authError, authHeaders, mutationSession, type AuthEnv } from '../../../_shared/auth';
import { PROSE_IMAGE_MAX_BYTES, PROSE_IMAGE_MAX_DIMENSION, PROSE_IMAGE_TYPES } from '../../../../src/content/images';

import { readBytes, reserveMutation, type ProseBucketEnv } from '../../../_shared/prose-storage';

export async function onRequestPost({ request, env }: { request: Request; env: AuthEnv & ProseBucketEnv }) {
  const session = await mutationSession({ request, env });
  if (!session) return authError('Sign in and retry the upload from the wiki', 403);
  const bucket = env.PROSE_IMAGES;
  if (!bucket) return authError('Image uploads are unavailable', 503);
  if (Number(request.headers.get('Content-Length')) > PROSE_IMAGE_MAX_BYTES) {
    return authError('Images must be 2 MiB or smaller', 413);
  }

  try {
    if (!await reserveMutation(bucket, 'uploads', session.user.id)) {
      const headers = authHeaders();
      headers.set('Retry-After', String(60 - Math.floor(Date.now() / 1000) % 60));
      return authError('Too many uploads. Try again shortly.', 429, headers);
    }
    const bytes = await readBytes(request, PROSE_IMAGE_MAX_BYTES);
    if (!bytes) return authError('Images must be 2 MiB or smaller', 413);

    let dimensions: ReturnType<typeof imageSize>;
    try {
      dimensions = imageSize(bytes);
    } catch {
      return authError('Choose a readable PNG, JPEG, or WebP image', 415);
    }
    const { type, width, height } = dimensions;
    if (type !== 'png' && type !== 'jpg' && type !== 'webp') {
      return authError('Choose a PNG, JPEG, or WebP image', 415);
    }
    if (width < 1 || height < 1 || width > PROSE_IMAGE_MAX_DIMENSION || height > PROSE_IMAGE_MAX_DIMENSION) {
      return authError('Images must be at most 4096 pixels wide and tall', 422);
    }

    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const key = `${hash}.${type}`;
    const stored = await bucket.put(key, bytes, {
      onlyIf: new Headers({ 'If-None-Match': '*' }),
      httpMetadata: { contentType: PROSE_IMAGE_TYPES[type] },
    });
    if (!stored && !await bucket.head(key)) return authError('Image storage is temporarily unavailable', 503);
    return Response.json({ image: { kind: 'upload', key }, width, height, bytes: bytes.byteLength }, {
      status: stored ? 201 : 200,
      headers: authHeaders(),
    });
  } catch {
    return authError('Image storage is temporarily unavailable', 503);
  }
}
