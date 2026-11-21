export interface WikiTarget {
  type: string;
  route: string;
}

interface Entry {
  id: string;
  builds?: string[];
}

export type ProseBlock = Entry & (
  | { kind: 'scope'; blocks: ProseBlock[] }
  | { kind: 'markdown'; source: string }
  | { kind: 'image'; image: ImageReference; alt: string; caption?: string }
);

export type ImageReference =
  | { kind: 'upload'; key: string }
  | { kind: 'wiki'; asset: string };

export interface ProseSection extends Entry {
  title: string;
  updatedAt: string;
  updatedAtByBuild?: Record<string, string>;
  blocks: ProseBlock[];
  sections: ProseSection[];
}

export interface ProseDocument {
  editedBy?: { id: number; login: string };
  version: 1;
  sections: ProseSection[];
}

export type ProseScope = 'general' | 'specific';

export interface PageProse {
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

function visibleBlocks(blocks: ProseBlock[], build: string | undefined): ProseBlock[] {
  return blocks.flatMap((block): ProseBlock[] => {
    if (block.builds && (!build || !block.builds.includes(build))) return [];
    return block.kind === 'scope' ? visibleBlocks(block.blocks, build) : [block];
  });
}

export function sectionsForBuild(sections: ProseSection[], build: string | undefined): ProseSection[] {
  return sections.flatMap((section) => {
    if (section.builds && (!build || !section.builds.includes(build))) return [];
    const blocks = visibleBlocks(section.blocks, build);
    const children = sectionsForBuild(section.sections, build);
    if (!blocks.length && !children.length) return [];
    return [{ ...section, blocks, sections: children }];
  });
}
