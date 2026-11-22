import {
  allowsBuild, proseSectionDate, type ProseBlock, type ProseContributor, type ProseDocument, type ProseSection,
} from '../../src/content/document';
import { proseContentKey } from '../../src/content/proseMerge';

function addBuilds(item: ProseSection | ProseBlock, builds: Set<string>) {
  item.builds?.forEach((build) => builds.add(build));
  if ('sections' in item) item.sections.forEach((child) => addBuilds(child, builds));
  if ('blocks' in item) item.blocks.forEach((block) => addBuilds(block, builds));
}

function visibleBlocks(blocks: ProseBlock[], build: string | undefined, parentIds?: string[]): unknown[] {
  return blocks.flatMap((block): unknown[] => {
    if (!allowsBuild(block.builds, build)) return [];
    const ids = block.entityIds ? [...new Set(block.entityIds.filter((id) => !parentIds || parentIds.includes(id)))].sort() : parentIds;
    if (ids?.length === 0) return [];
    if (block.kind === 'scope') return visibleBlocks(block.blocks, build, ids);
    if (block.kind === 'markdown') return [['markdown', ids, block.source]];
    const { image } = block;
    return [['image', ids, image.kind, image.kind === 'wiki' ? image.asset : image.key, block.alt, block.caption]];
  });
}

function visibleSection(section: ProseSection, build: string | undefined, parent?: string[]): unknown[] | undefined {
  if (!allowsBuild(parent, build) || !allowsBuild(section.builds, build)) return undefined;
  const blocks = visibleBlocks(section.blocks, build);
  const sections = section.sections.flatMap((child) => {
    const view = visibleSection(child, build);
    return view ? [view] : [];
  });
  return blocks.length || sections.length ? [section.title, blocks, sections] : undefined;
}

export function withProseMetadata(sections: ProseSection[], current: ProseDocument, editor: ProseContributor, now: string): ProseDocument {
  const previous = new Map<string, { section: ProseSection; parent?: string[] }>();
  function index(items: ProseSection[], parent?: string[]) {
    for (const section of items) {
      previous.set(section.id, { section, parent });
      index(section.sections, section.builds ?? parent);
    }
  }
  index(current.sections);

  function stamp(section: ProseSection, parent?: string[]): ProseSection {
    const old = previous.get(section.id);
    const children = section.sections.map((child) => stamp(child, section.builds ?? parent));
    if (!old) return { ...section, sections: children };

    const { section: previousSection, parent: previousParent } = old;
    const scope = section.builds ?? parent;
    const oldScope = previousSection.builds ?? previousParent;
    if (JSON.stringify(scope) === JSON.stringify(oldScope) && proseContentKey(section, true) === proseContentKey(previousSection, true)) {
      return {
        ...section, sections: children, updatedAt: previousSection.updatedAt,
        updatedAtForAnyBuild: previousSection.updatedAtForAnyBuild, updatedAtByBuild: previousSection.updatedAtByBuild,
      };
    }
    function dateFor(build?: string) {
      const before = JSON.stringify(visibleSection(previousSection, build, previousParent));
      const after = JSON.stringify(visibleSection(section, build, parent));
      return before === after ? proseSectionDate(previousSection, build) : now;
    }
    const anyBuildDate = dateFor();
    const builds = new Set([...(scope ?? []), ...(oldScope ?? []), ...Object.keys(previousSection.updatedAtByBuild ?? {})]);
    addBuilds(previousSection, builds);
    addBuilds(section, builds);
    const overrides = [...builds].sort().flatMap((build) => {
      const date = dateFor(build);
      return date === anyBuildDate ? [] : [[build, date]];
    });
    return {
      ...section, sections: children, updatedAt: now,
      updatedAtForAnyBuild: anyBuildDate === now ? undefined : anyBuildDate,
      updatedAtByBuild: overrides.length ? Object.fromEntries(overrides) : undefined,
    };
  }

  const contributors = new Map(current.contributors?.map((contributor) => [contributor.id, contributor]));
  if (current.editedBy) contributors.set(current.editedBy.id, current.editedBy);
  contributors.set(editor.id, editor);
  return { version: 1, sections: sections.map((section) => stamp(section)), editedBy: editor, contributors: [...contributors.values()] };
}
