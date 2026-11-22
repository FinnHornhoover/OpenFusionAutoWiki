import { inheritBuildScope, type ProseBlock, type ProseDocument, type ProseSection } from '../../src/content/document';
import { PROSE_IMAGE_KEY, WIKI_ICON_KEY } from '../../src/content/images';
import { writeProseSource } from '../../src/content/proseSource';
import { optimizeWikiLinks } from './prose-links';
import { withProseMetadata } from './prose-metadata';
import { segment, type PageMapping } from './prose';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid document structure');
  return value as Record<string, unknown>;
}

function text(value: unknown, length: number) {
  if (typeof value !== 'string' || value.length > length) throw new Error('Invalid text field');
  return value;
}

export function validateDocument(input: unknown, mapping: PageMapping, current: ProseDocument, editedBy: NonNullable<ProseDocument['editedBy']>) {
  const root = record(input);
  if (root.version !== 1 || !Array.isArray(root.sections)) throw new Error('Invalid document format');
  const ids = new Set<string>();
  const uploads = new Set<string>();
  const now = new Date().toISOString();

  function entry(value: Record<string, unknown>, parent?: string[]) {
    const id = text(value.id, 128);
    if (!segment.test(id) || ids.has(id) || ids.size >= 300) throw new Error('Invalid or duplicate section or block ID');
    ids.add(id);
    if (value.builds === undefined) return { id };
    if (!Array.isArray(value.builds) || !value.builds.length || value.builds.length > 100) throw new Error('Invalid build scope');
    const builds = value.builds.map((build) => text(build, 128));
    if (builds.some((build) => !segment.test(build) || (parent && !parent.includes(build)))) throw new Error('Invalid build scope');
    return { id, builds: inheritBuildScope(builds, parent) };
  }

  function block(input: unknown, parent?: string[], depth = 1, parentIds?: string[]): ProseBlock[] {
    const value = record(input);
    const scope = entry(value, parent);
    let entityIds: string[] | undefined;
    if (value.entityIds !== undefined) {
      if (!Array.isArray(value.entityIds) || !value.entityIds.length || value.entityIds.length > 100) throw new Error('Invalid ID scope');
      const selected = value.entityIds.map((id) => text(id, 128));
      if (selected.some((id) => !segment.test(id) || (parentIds && !parentIds.includes(id)))) throw new Error('Invalid ID scope');
      entityIds = inheritBuildScope(selected, parentIds);
    }
    const base = { ...scope, entityIds };
    if (value.kind === 'scope') {
      if (depth > 12 || !Array.isArray(value.blocks)) throw new Error('Invalid nested build scope');
      const blocks = value.blocks.flatMap((item) => block(item, base.builds ?? parent, depth + 1, entityIds ?? parentIds));
      return (base.builds || entityIds) && blocks.length ? [{ ...base, kind: 'scope', blocks }] : blocks;
    }
    if (value.kind === 'markdown') return [{ ...base, kind: 'markdown', source: text(optimizeWikiLinks(text(value.source, 20_000)), 20_000) }];
    if (value.kind !== 'image') throw new Error('Unsupported block type');
    const image = record(value.image);
    const alt = text(value.alt, 500);
    const caption = value.caption === undefined ? undefined : text(value.caption, 1000);
    if (image.kind === 'upload') {
      const key = text(image.key, 80);
      if (!PROSE_IMAGE_KEY.test(key)) throw new Error('Invalid upload reference');
      uploads.add(key);
      if (uploads.size > 8) throw new Error('Use at most eight uploaded images per document');
      return [{ ...base, kind: 'image', image: { kind: 'upload', key }, alt, caption }];
    }
    if (image.kind === 'icon') {
      const key = text(image.key, 80);
      if (!WIKI_ICON_KEY.test(key)) throw new Error('Invalid wiki icon');
      return [{ ...base, kind: 'image', image: { kind: 'icon', key }, alt, caption }];
    }
    if (image.kind !== 'wiki') throw new Error('Unsupported image reference');
    const asset = text(image.asset, 250);
    if (!mapping.wikiImages || !Object.hasOwn(mapping.wikiImages, asset)) throw new Error('Unknown wiki image');
    return [{ ...base, kind: 'image', image: { kind: 'wiki', asset }, alt, caption }];
  }

  function section(input: unknown, parent?: string[], depth = 1): ProseSection {
    const value = record(input);
    if (depth > 6 || !Array.isArray(value.blocks) || !Array.isArray(value.sections)) throw new Error('Invalid section structure');
    const base = entry(value, parent);
    const title = text(value.title, 250).trim();
    if (!title) throw new Error('Section titles are required');
    const scope = base.builds ?? parent;
    const blocks = value.blocks.flatMap((item) => block(item, scope));
    const sections = value.sections.map((item) => section(item, scope, depth + 1));
    return { ...base, title, blocks, sections, updatedAt: now };
  }

  const sections = root.sections.map((item) => section(item));
  const unchanged = writeProseSource({ version: 1, sections }) === writeProseSource(current);
  const document = unchanged ? current : withProseMetadata(sections, current, editedBy, now);
  return { document, uploads, unchanged };
}
