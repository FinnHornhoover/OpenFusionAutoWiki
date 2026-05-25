/** Lowercase, dashed slug used for area route IDs. */
export function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/\s*-\s*/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || s.toLowerCase();
}
