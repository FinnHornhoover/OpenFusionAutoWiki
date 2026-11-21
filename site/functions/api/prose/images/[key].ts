import { PROSE_IMAGE_KEY, PROSE_IMAGE_TYPES } from '../../../../src/content/images';

interface Env {
  PROSE_IMAGES?: {
    get(key: string): Promise<{ body: ReadableStream; httpEtag: string; size: number } | null>;
  };
}

export async function onRequestGet({ params, env }: { params: { key: string }; env: Env }) {
  const match = PROSE_IMAGE_KEY.exec(params.key);
  if (!match || !env.PROSE_IMAGES) return new Response(null, { status: 404 });

  try {
    const image = await env.PROSE_IMAGES.get(params.key);
    if (!image) return new Response(null, { status: 404 });
    return new Response(image.body, {
      headers: {
        'Content-Type': PROSE_IMAGE_TYPES[match[2] as keyof typeof PROSE_IMAGE_TYPES],
        'Content-Length': String(image.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        ETag: image.httpEtag,
      },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
