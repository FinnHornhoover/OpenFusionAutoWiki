import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { POOL_DIR, UPLOAD_INDEX } from './build.js';
import type { PoolEntry } from './pool.js';
import { log } from '../log.js';

async function upload(): Promise<void> {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET');
  }
  const entries = JSON.parse(readFileSync(UPLOAD_INDEX, 'utf8')) as PoolEntry[];
  const client = new S3Client({
    region: 'auto', endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }, maxAttempts: 5,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  try {
    const existing = new Map<string, number>();
    let token: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: 'v4/', ContinuationToken: token }));
      for (const row of page.Contents ?? []) if (row.Key && row.Size !== undefined) existing.set(row.Key, row.Size);
      token = page.NextContinuationToken;
    } while (token);

    const pending = entries.filter((row) => existing.get(`v4/${row.key}`) !== row.bytes);
    log.step(`R2: uploading ${pending.length.toLocaleString()} assets; ${entries.length - pending.length} already present`);
    let next = 0;
    let done = 0;
    let lastLog = Date.now();
    await Promise.all(Array.from({ length: Math.min(8, pending.length) }, async () => {
      while (next < pending.length) {
        const row = pending[next++];
        const type = row.key.endsWith('.webp') ? 'image/webp' : row.key.endsWith('.png') ? 'image/png' : row.key.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream';
        await client.send(new PutObjectCommand({
          Bucket: R2_BUCKET, Key: `v4/${row.key}`, Body: readFileSync(join(POOL_DIR, row.key)),
          ContentType: type, CacheControl: 'public, max-age=31536000, immutable', Metadata: { sha256: row.sha256 },
        }));
        done++;
        if (Date.now() - lastLog > 5000) { log.info(`R2: ${done}/${pending.length} uploaded`); lastLog = Date.now(); }
      }
    }));
    log.done(`R2: ${done} uploaded; all preview assets available`);
  } finally {
    client.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  upload().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
