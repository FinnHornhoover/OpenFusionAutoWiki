export const PROSE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PROSE_IMAGE_MAX_DIMENSION = 4096;

export const PROSE_IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
} as const;

export const PROSE_IMAGE_KEY = /^([a-f0-9]{64})\.(png|jpg|webp)$/;

export const WIKI_ICON_KEY = /^[a-f0-9]{32}\.(png|jpe?g|webp)$/;
