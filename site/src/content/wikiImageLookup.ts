import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { PROSE_IMAGE_TYPES, PROSE_IMAGE_MAX_BYTES } from './images';

export async function existingWikiIcon(
  bytes: Uint8Array,
  type: keyof typeof PROSE_IMAGE_TYPES,
  fetchIcon: (path: string) => Promise<Response>,
) {
  // The wiki's built-in icon registry uses MD5 filenames. Verify the actual bytes.
  const hash = bytesToHex(md5(bytes));
  for (const extension of type === 'jpg' ? ['jpg', 'jpeg'] : [type]) {
    const key = hash + '.' + extension;
    const response = await fetchIcon('/icons/' + key);
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) continue;
    if (Number(response.headers.get('Content-Length')) > PROSE_IMAGE_MAX_BYTES) continue;
    const existing = new Uint8Array(await response.arrayBuffer());
    if (existing.length === bytes.length && existing.every((byte, index) => byte === bytes[index])) return key;
  }
  return undefined;
}
