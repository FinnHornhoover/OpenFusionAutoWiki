import { readFile } from 'node:fs/promises';
import { Agent } from 'node:https';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { preparePublication } from './compress.js';
import { log } from '../log.js';

export async function upload(): Promise<void> {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET');
  }
  const concurrency = Number(process.env.R2_UPLOAD_CONCURRENCY ?? 48);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 128) {
    throw new Error('R2_UPLOAD_CONCURRENCY must be an integer between 1 and 128');
  }
  const entries = await preparePublication();
  const client = new S3Client({
    region: 'auto', endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }, maxAttempts: 5,
    expectContinueHeader: false,
    requestHandler: {
      httpsAgent: new Agent({ keepAlive: true, maxSockets: concurrency }),
      connectionTimeout: 10_000, requestTimeout: 120_000, throwOnRequestTimeout: true,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const controller = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const existing = new Map<string, number>();
    let token: string | undefined, retries = 0, pages = 0;
    log.step('R2: listing existing assets');
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: 'v4/', ContinuationToken: token }), { abortSignal: controller.signal });
      for (const row of page.Contents ?? []) if (row.Key && row.Size !== undefined) existing.set(row.Key, row.Size);
      retries += (page.$metadata.attempts ?? 1) - 1;
      token = page.NextContinuationToken;
      if (++pages % 10 === 0) log.info(`R2: listed ${existing.size.toLocaleString()} assets`);
    } while (token);

    const pending = entries.filter((row) => existing.get(`v4/${row.key}`) !== row.bytes).sort((a, b) => b.bytes - a.bytes);
    log.step(`R2: uploading ${pending.length.toLocaleString()} assets with ${concurrency} workers; ${entries.length - pending.length} already present`);
    let next = 0, done = 0, bytes = 0;
    const started = Date.now();
    const progress = (): void => {
      const seconds = Math.max((Date.now() - started) / 1000, 0.001);
      const rate = done / seconds;
      const eta = rate ? `${((pending.length - done) / rate / 60).toFixed(1)} min` : 'calculating';
      log.info(`R2: ${done}/${pending.length} uploaded; ${rate.toFixed(1)} files/s, ${(bytes / seconds / 1e6).toFixed(2)} MB/s; elapsed ${(seconds / 60).toFixed(1)} min; ETA ${eta}; retries ${retries}`);
    };
    if (pending.length) timer = setInterval(progress, 5000);
    await Promise.allSettled(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
      try {
        while (next < pending.length && !controller.signal.aborted) {
          const row = pending[next++];
          const body = await readFile(row.path, { signal: controller.signal });
          controller.signal.throwIfAborted();
          const type = row.key.endsWith('.webp') ? 'image/webp' : row.key.endsWith('.png') ? 'image/png' : row.key.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream';
          const result = await client.send(new PutObjectCommand({
            Bucket: R2_BUCKET, Key: `v4/${row.key}`, Body: body,
            ContentType: type, ContentEncoding: row.contentEncoding,
            CacheControl: 'public, max-age=31536000, immutable', Metadata: { sha256: row.sha256 },
          }), { abortSignal: controller.signal });
          done++; bytes += row.bytes; retries += (result.$metadata.attempts ?? 1) - 1;
        }
      } catch (error) { controller.abort(error); throw error; }
    }));
    controller.signal.throwIfAborted();
    if (pending.length) progress();
    log.done(`R2: ${done} uploaded; all preview assets available`);
  } finally {
    clearInterval(timer);
    controller.abort();
    client.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  upload().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
