interface Env {
  PROSE_IMAGES?: {
    get(key: string): Promise<{ body: ReadableStream; httpEtag: string; size: number } | null>;
  };
}

const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

export async function onRequestGet({ params, env }: { params: { key: string }; env: Env }) {
  const match = /^[a-f0-9]{64}\.(png|jpg|webp)$/.exec(params.key);
  if (!match || !env.PROSE_IMAGES) return new Response(null, { status: 404 });

  try {
    const image = await env.PROSE_IMAGES.get(params.key);
    if (!image) return new Response(null, { status: 404 });
    return new Response(image.body, {
      headers: {
        'Content-Type': mime[match[1] as keyof typeof mime],
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
