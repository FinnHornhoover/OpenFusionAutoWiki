export interface WikiTarget {
  type: string;
  route: string;
}

interface Entry {
  id: string;
  builds?: string[];
}

export type ProseBlock = Entry & { entityIds?: string[] } & (
  | { kind: 'scope'; blocks: ProseBlock[] }
  | { kind: 'markdown'; source: string }
  | { kind: 'image'; image: ImageReference; alt: string; caption?: string }
);

export type ImageReference =
  | { kind: 'upload'; key: string }
  | { kind: 'icon'; key: string }
  | { kind: 'wiki'; asset: string };

export interface ProseSection extends Entry {
  title: string;
  updatedAt: string;
  updatedAtForAnyBuild?: string;
  updatedAtByBuild?: Record<string, string>;
  blocks: ProseBlock[];
  sections: ProseSection[];
}

export interface ProseContributor {
  id: number;
  login: string;
}

export interface ProseDocument {
  editedBy?: ProseContributor;
  contributors?: ProseContributor[];
  version: 1;
  sections: ProseSection[];
}

export type ProseScope = 'general' | 'specific';

export interface PageProse {
  entityId?: string;
  scopes?: ProseScope[];
  general?: ProseDocument;
  specific?: ProseDocument;
  wikiImages?: Record<string, string>;
}

export function inheritBuildScope(builds: string[] | undefined, parent: string[] | undefined) {
  const selected = builds ? [...new Set(builds)].sort() : undefined;
  return selected && parent && selected.length === parent.length && selected.every((build) => parent.includes(build))
    ? undefined
    : selected;
}

export function proseSectionDate(section: ProseSection, build?: string) {
  const dates = section.updatedAtByBuild;
  return build && dates && Object.hasOwn(dates, build) ? dates[build] : section.updatedAtForAnyBuild ?? section.updatedAt;
}

export function allowsBuild(builds: string[] | undefined, build: string | undefined) {
  return !builds || (!!build && builds.includes(build));
}

function visibleBlocks(blocks: ProseBlock[], build: string | undefined, entityId?: string): ProseBlock[] {
  return blocks.flatMap((block): ProseBlock[] => {
    if (!allowsBuild(block.builds, build)) return [];
    if (block.entityIds && (!entityId || !block.entityIds.includes(entityId))) return [];
    return block.kind === 'scope' ? visibleBlocks(block.blocks, build, entityId) : [block];
  });
}

export function sectionsForBuild(sections: ProseSection[], build: string | undefined, entityId?: string): ProseSection[] {
  return sections.flatMap((section) => {
    if (!allowsBuild(section.builds, build)) return [];
    const blocks = visibleBlocks(section.blocks, build, entityId);
    const children = sectionsForBuild(section.sections, build, entityId);
    if (!blocks.length && !children.length) return [];
    return [{ ...section, blocks, sections: children }];
  });
}
