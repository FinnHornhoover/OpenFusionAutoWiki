import { appendFile, readFile } from 'node:fs/promises';
import { Agent } from 'node:https';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { preparePublication, PUBLICATION_INDEX, type UploadEntry } from './compress.js';
import { fetchRelease } from '../download.js';
import { log } from '../log.js';
import { slugForZip } from '../manifest.js';
import { DATA_OUT } from '../paths.js';

type PublishedAsset = Pick<UploadEntry, 'key' | 'bytes'>;

function publicationClient() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET');
  }
  const concurrency = Number(process.env.R2_UPLOAD_CONCURRENCY ?? 48);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 128) {
    throw new Error('R2_UPLOAD_CONCURRENCY must be an integer between 1 and 128');
  }
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
  return { client, bucket: R2_BUCKET, concurrency };
}

async function pendingAssets<T extends PublishedAsset>(client: S3Client, bucket: string, entries: T[], signal?: AbortSignal) {
  const pending = new Map(entries.map((row) => ['v4/' + row.key, row]));
  let token: string | undefined, retries = 0, pages = 0, listed = 0;
  log.step('R2: listing existing assets');
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'v4/', ContinuationToken: token }), { abortSignal: signal });
    for (const row of page.Contents ?? []) {
      if (row.Key && row.Size !== undefined && pending.get(row.Key)?.bytes === row.Size) pending.delete(row.Key);
      listed++;
    }
    retries += (page.$metadata.attempts ?? 1) - 1;
    token = page.NextContinuationToken;
    if (++pages % 10 === 0) log.info(`R2: listed ${listed.toLocaleString()} assets`);
  } while (token && pending.size);
  return { pending: [...pending.values()], retries };
}

async function readCacheJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function verifyCachedPublication(): Promise<boolean> {
  const entries = await readCacheJson(PUBLICATION_INDEX);
  if (!Array.isArray(entries) || !entries.length || !entries.every((row) =>
    row && typeof row.key === 'string' && Number.isSafeInteger(row.bytes) && row.bytes >= 0)) {
    log.info('No usable publication manifest in the preview cache');
    return false;
  }

  const release = await fetchRelease();
  const selected = process.env.FFWIKI_BUILDS?.split(',').map((value) => value.trim()).filter(Boolean);
  const slugs = release.assets.map((asset) => slugForZip(asset.name)).filter((slug) => !selected || selected.includes(slug));
  const baseUrl = process.env.FFWIKI_OBJECTS_URL?.replace(/\/$/, '');
  const metas = await Promise.all(slugs.map((slug) => readCacheJson(join(DATA_OUT, slug, 'previews', 'meta.json'))));
  if (!baseUrl || !metas.length || metas.some((meta) => {
    const preview = meta as { release?: string; baseUrl?: string } | undefined;
    return preview?.release !== release.tagName || preview.baseUrl !== `${baseUrl}/v4`;
  })) {
    log.info('Cached preview data does not cover the selected builds and asset URL');
    return false;
  }

  const { client, bucket } = publicationClient();
  try {
    const { pending } = await pendingAssets(client, bucket, entries as PublishedAsset[]);
    if (pending.length) {
      log.info(`R2: ${pending.length.toLocaleString()} cached assets are missing or differ in size; rebuilding previews`);
      return false;
    }
    log.done(`R2: verified all ${entries.length.toLocaleString()} cached preview assets`);
    return true;
  } finally {
    client.destroy();
  }
}

export async function upload(): Promise<void> {
  const { client, bucket, concurrency } = publicationClient();
  const controller = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const entries = await preparePublication();
    const inventory = await pendingAssets(client, bucket, entries, controller.signal);
    const pending = inventory.pending.sort((a, b) => b.bytes - a.bytes);
    let retries = inventory.retries;
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
          const type = row.key.endsWith('.ogg') ? 'audio/ogg' : row.key.endsWith('.json') ? 'application/json' : row.key.endsWith('.webp') ? 'image/webp' : row.key.endsWith('.png') ? 'image/png' : row.key.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream';
          const result = await client.send(new PutObjectCommand({
            Bucket: bucket, Key: `v4/${row.key}`, Body: body,
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
  const task = process.argv.includes('--verify-cached')
    ? verifyCachedPublication().then(async (verified) => {
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `verified=${verified}\n`);
      else if (!verified) process.exitCode = 1;
    })
    : upload();
  task.catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
