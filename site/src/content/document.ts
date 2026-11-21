export interface WikiTarget {
  type: string;
  route: string;
}

interface Entry {
  id: string;
  builds?: string[];
}

export type ProseBlock = Entry & (
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
  version: 1;
  sections: ProseSection[];
}

export interface PageProse {
  general?: ProseDocument;
  specific?: ProseDocument;
  wikiImages?: Record<string, string>;
}

export function sectionsForBuild(sections: ProseSection[], build: string): ProseSection[] {
  return sections.flatMap((section) => {
    if (section.builds && !section.builds.includes(build)) return [];
    const blocks = section.blocks.filter((block) => !block.builds || block.builds.includes(build));
    const children = sectionsForBuild(section.sections, build);
    if (!blocks.length && !children.length) return [];
    return [{ ...section, blocks, sections: children }];
  });
}
