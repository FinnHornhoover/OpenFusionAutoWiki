import type { ProseBlock, ProseDocument, ProseSection } from './document';

export type ProseContent = ProseSection | ProseBlock;
type Side = 'yours' | 'saved';
export type MergeChoices = ReadonlyMap<number, Side>;
type Versions<T> = { original?: T; yours: T; saved: T };
type Resolve<T> = (choices: MergeChoices) => T;

export interface MergeDecision {
  id: number;
  label: string;
  location: string;
  order?: boolean;
  versions: Versions<ProseContent[]>;
}

export function proseChildren(item?: ProseContent): ProseContent[] {
  if (!item) return [];
  if ('sections' in item) return [...item.blocks, ...item.sections];
  return item.kind === 'scope' ? item.blocks : [];
}

export function proseContentLabel(item: ProseContent) {
  if ('title' in item) return item.title;
  if (item.kind === 'scope') return 'Visibility block';
  if (item.kind === 'image') return item.alt || 'Image';
  return item.source.trim().split('\n')[0].slice(0, 70) || 'Text block';
}

function sorted(scope?: string[]) {
  return scope && [...scope].sort();
}

function contentShape(item: ProseContent, nested: boolean): unknown[] {
  const builds = sorted(item.builds);
  const own = 'sections' in item ? [item.title, builds] : [item.kind, builds, sorted(item.entityIds)];
  if ('kind' in item && item.kind === 'markdown') own.push(item.source);
  if ('kind' in item && item.kind === 'image') {
    const { image } = item;
    own.push(image.kind, image.kind === 'wiki' ? image.asset : image.key, item.alt, item.caption);
  }
  return nested ? [item.id, own, proseChildren(item).map((child) => contentShape(child, true))] : own;
}

export function proseContentKey(item: ProseContent, nested = false) {
  return JSON.stringify(contentShape(item, nested));
}

function combinedOrder(preferred: string[], other: string[]) {
  const order = [...preferred];
  let insertion = order.length;
  for (const id of [...other].reverse()) {
    const existing = order.indexOf(id);
    if (existing === -1) order.splice(insertion, 0, id);
    else insertion = existing;
  }
  return order;
}

function versionsAsLists<T extends ProseContent>(versions: Versions<T | undefined>): Versions<ProseContent[]> {
  return {
    original: versions.original ? [versions.original] : undefined,
    yours: versions.yours ? [versions.yours] : [],
    saved: versions.saved ? [versions.saved] : [],
  };
}

export function planProseMerge(base: ProseDocument, draft: ProseDocument, latest: ProseDocument) {
  const decisions: MergeDecision[] = [];

  function choose<T>(values: Versions<T>, label: string, location: string, versions: Versions<ProseContent[]>, order?: boolean): Resolve<T> {
    const id = decisions.length;
    decisions.push({ id, label, location, versions, order });
    return (choices) => {
      const side = choices.get(id);
      if (!side) throw new Error('A choice is required for every change.');
      return values[side];
    };
  }

  function mergeList<T extends ProseContent>(
    versions: Versions<T[]>,
    location: string,
    orderLabel: string,
    mergeItem: (versions: Versions<T | undefined>, location: string) => Resolve<T | undefined>,
  ): Resolve<T[]> {
    const mine = versions.yours.map(({ id }) => id);
    const theirs = versions.saved.map(({ id }) => id);
    const inBoth = mine.filter((id) => theirs.includes(id));
    const sharedOrder = theirs.filter((id) => mine.includes(id));
    const draftOrder = combinedOrder(mine, theirs);
    const order = inBoth.join(',') === sharedOrder.join(',')
      ? () => draftOrder
      : choose({ yours: draftOrder, saved: combinedOrder(theirs, mine) }, orderLabel, location, versions, true);
    const items = new Map(draftOrder.map((id) => [id, mergeItem({
      original: versions.original?.find((item) => item.id === id),
      yours: versions.yours.find((item) => item.id === id),
      saved: versions.saved.find((item) => item.id === id),
    }, location)]));
    return (choices) => order(choices).flatMap((id) => {
      const item = items.get(id)?.(choices);
      return item ? [item] : [];
    });
  }

  function mergeBlock(versions: Versions<ProseBlock | undefined>, location: string): Resolve<ProseBlock | undefined> {
    const { original, yours, saved } = versions;
    if (yours && saved && proseContentKey(yours, true) === proseContentKey(saved, true)) return () => saved;
    if (yours?.kind === 'scope' && saved?.kind === 'scope' && proseContentKey(yours) === proseContentKey(saved)) {
      const blocks = mergeList({ original: original?.kind === 'scope' ? original.blocks : undefined, yours: yours.blocks, saved: saved.blocks },
        location + ' / Visibility block', 'Block order', mergeBlock);
      return (choices) => {
        const merged = blocks(choices);
        return merged.length ? { ...saved, blocks: merged } : undefined;
      };
    }
    const item = original ?? yours ?? saved;
    const label = item?.kind === 'scope' ? 'Visibility block' : item?.kind === 'image' ? 'Image' : 'Text block';
    return choose(versions, label, location, versionsAsLists(versions));
  }

  function mergeSection(versions: Versions<ProseSection | undefined>, location: string): Resolve<ProseSection | undefined> {
    const { original, yours, saved } = versions;
    if (yours && saved && proseContentKey(yours, true) === proseContentKey(saved, true)) return () => saved;
    const title = (original ?? yours ?? saved)?.title ?? 'Section';
    if (!yours || !saved || JSON.stringify(sorted(yours.builds)) !== JSON.stringify(sorted(saved.builds))) {
      return choose(versions, title, location, versionsAsLists(versions));
    }
    const here = location ? `${location} / ${title}` : title;
    const header = yours.title === saved.title ? () => saved : choose({ original, yours, saved }, 'Heading', here, {
      original: original && [{ ...original, blocks: [], sections: [] }],
      yours: [{ ...yours, blocks: [], sections: [] }],
      saved: [{ ...saved, blocks: [], sections: [] }],
    });
    const blocks = mergeList({ original: original?.blocks, yours: yours.blocks, saved: saved.blocks }, here, 'Block order', mergeBlock);
    const sections = mergeList({ original: original?.sections, yours: yours.sections, saved: saved.sections }, here, 'Subsection order', mergeSection);
    return (choices) => ({ ...header(choices), blocks: blocks(choices), sections: sections(choices) });
  }

  const sections = mergeList({ original: base.sections, yours: draft.sections, saved: latest.sections }, '', 'Section order', mergeSection);
  return { decisions, apply: (choices: MergeChoices): ProseDocument => ({ ...draft, sections: sections(choices) }) };
}

export function duplicateProseContent(document: ProseDocument) {
  const seen = new Set<string>();
  function find(items: ProseContent[]): ProseContent | undefined {
    for (const item of items) {
      if (seen.has(item.id)) return item;
      seen.add(item.id);
      const duplicate = find(proseChildren(item));
      if (duplicate) return duplicate;
    }
  }
  return find(document.sections);
}
