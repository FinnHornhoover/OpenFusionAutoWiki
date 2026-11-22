import { inheritBuildScope, type ImageReference, type ProseBlock, type ProseDocument, type ProseSection } from './document';

const marker = / ?<!--wiki:([a-z0-9_-]+)-->/i;
const heading = /^(#{1,6})[ \t]+(.+)$/;
const buildSuffix = / \{builds:\s*([^{}]+)\}$/;
const scopeStart = /^[ \t]*::: (builds|ids)\s+(.*?)\s*$/;
const scopeEnd = /^[ \t]*:::[ \t]*$/;
const imageLine = /^!\[((?:[^\]\\]|\\.)*)\]\((upload|wiki-image|wiki-icon):([^\s)]+)(?: ("(?:[^"\\]|\\.)*"))?\)$/;

function splitBuilds(value?: string) {
  return value?.split(',').map((build) => build.trim()).filter(Boolean);
}

function stripMarker(line: string) {
  const match = marker.exec(line);
  return { text: match ? line.slice(0, match.index) + line.slice(match.index + match[0].length) : line, id: match?.[1] };
}

function escaped(line: string) {
  const plain = line.replace(/^\\+/, '');
  return heading.test(plain) || scopeStart.test(plain) || scopeEnd.test(plain) || imageLine.test(plain) || marker.test(plain);
}

export function imageSource(image: ImageReference, alt = 'Image description', caption?: string) {
  const target = image.kind === 'wiki' ? 'wiki-image:' + encodeURIComponent(image.asset).replaceAll(')', '%29')
    : (image.kind === 'icon' ? 'wiki-icon:' : 'upload:') + image.key;
  return '![' + alt.replace(/[\\\]]/g, '\\$&') + '](' + target + (caption === undefined ? '' : ' ' + JSON.stringify(caption)) + ')';
}

export function writeProseSource(document: ProseDocument) {
  const lines: string[] = [];

  function blockSource(block: ProseBlock, parent?: string[], parentIds?: string[]) {
    const builds = inheritBuildScope(block.builds, parent);
    const id = ' <!--wiki:' + block.id + '-->';
    const entityIds = inheritBuildScope(block.entityIds, parentIds);
    if (builds) lines.push('::: builds ' + builds.join(', ') + id);
    if (entityIds) lines.push('::: ids ' + entityIds.join(', ') + (builds ? '' : id));
    if (block.kind === 'scope') {
      block.blocks.forEach((child) => blockSource(child, builds ?? parent, entityIds ?? parentIds));
    } else {
      const body = block.kind === 'image'
        ? [imageSource(block.image, block.alt, block.caption)]
        : block.source.split('\n').map((line) => {
          const literal = line.replace(/<!--wiki(\\*):/g, '<!--wiki$1\\:');
          return escaped(literal) ? '\\' + literal : literal;
        });
      if (!builds && !entityIds) body[0] += id;
      lines.push(...body);
    }
    if (entityIds) lines.push(':::');
    if (builds) lines.push(':::');
  }

  function sectionSource(section: ProseSection, depth: number, parent?: string[]) {
    const builds = inheritBuildScope(section.builds, parent);
    const suffix = builds?.length ? ' {builds: ' + builds.join(', ') + '}' : '';
    lines.push('#'.repeat(depth + 1) + ' ' + section.title + suffix + ' <!--wiki:' + section.id + '-->');
    section.blocks.forEach((block) => blockSource(block, builds ?? parent));
    section.sections.forEach((child) => sectionSource(child, depth + 1, builds ?? parent));
  }

  document.sections.forEach((section) => sectionSource(section, 0));
  return lines.join('\n');
}

export function sourceScopeLine(line: string) {
  const { text, id } = stripMarker(line);
  const section = heading.exec(text);
  const scopedHeading = section && buildSuffix.exec(section[2]);
  const block = scopeStart.exec(text);
  return {
    text,
    id,
    section: section ? text.replace(buildSuffix, '') : undefined,
    depth: section ? section[1].length - 1 : undefined,
    builds: splitBuilds(scopedHeading?.[1] ?? (block?.[1] === 'builds' ? block[2] : undefined)),
    entityIds: splitBuilds(block?.[1] === 'ids' ? block[2] : undefined),
    scopeKind: block?.[1] as 'builds' | 'ids' | undefined,
    beginsBlock: !!block,
    endsBlock: scopeEnd.test(text),
    isImage: imageLine.test(text),
  };
}

export function sourceBuildContext(lines: string[]) {
  const sections: (string[] | undefined)[] = [];
  const blocks: { line: number; builds?: string[]; entityIds?: string[] }[] = [];
  let fence: string | undefined;

  return lines.map((raw, line) => {
    const info = sourceScopeLine(raw);
    const delimiter = /^ {0,3}(\x60{3,}|~{3,})/.exec(info.text)?.[1];
    if (fence && info.id && (info.beginsBlock || info.section)) fence = undefined;
    const inCode = !!fence || !!delimiter;
    if (fence && delimiter?.[0] === fence[0] && delimiter.length >= fence.length && /^ {0,3}(\x60+|~+)\s*$/.test(info.text)) {
      fence = undefined;
    } else if (!fence && delimiter) {
      fence = delimiter;
    }

    const depth = !inCode && blocks.length === 0 ? info.depth : undefined;
    if (depth !== undefined) sections.length = Math.min(depth, sections.length);
    const activeBlock = blocks.at(-1);
    const parent = activeBlock?.builds ?? sections.at(-1);
    const beginsBlock = !inCode && info.beginsBlock;
    const endsBlock = !inCode && info.endsBlock;
    const builds = (beginsBlock || depth !== undefined ? info.builds : undefined) ?? parent;
    const parentIds = activeBlock?.entityIds;
    const entityIds = (beginsBlock ? info.entityIds : undefined) ?? parentIds;
    if (depth !== undefined) sections.push(builds);
    if (beginsBlock) blocks.push({ line, builds, entityIds });
    if (endsBlock) blocks.pop();
    return {
      ...info, depth, beginsBlock, endsBlock, inCode, builds, parent, entityIds, parentIds,
      selectedIds: info.entityIds,
      blockStart: beginsBlock ? line : activeBlock?.line,
      selectedBuilds: info.builds,
    };
  });
}

export function sourceBuildScopes(lines: string[]) {
  return sourceBuildContext(lines).map(({ builds }) => builds);
}

export function readProseSource(source: string, previous: ProseDocument, seed: string, date: string) {
  const original = new Map<string, ProseSection>();
  const sections: ProseSection[] = [];
  const parents: ProseSection[] = [];
  const lines = source.split('\n');
  const contexts = sourceBuildContext(lines);
  const reservedIds = new Set(contexts.flatMap(({ id }) => id ? [id] : []));
  const ids = new Set<string>();
  const scopes: { id?: string; builds?: string[]; entityIds?: string[]; blocks: ProseBlock[]; simple: boolean }[] = [];
  let count = 0;
  let pending: { lines: string[]; id?: string } | undefined;
  let error: string | undefined;

  function index(items: ProseSection[]) {
    for (const item of items) {
      original.set(item.id, item);
      index(item.sections);
    }
  }
  index(previous.sections);

  function idFor(id?: string) {
    if (id && !ids.has(id)) {
      ids.add(id);
      return id;
    }
    let generated: string;
    do { generated = seed + '-' + ++count; } while (ids.has(generated) || reservedIds.has(generated));
    ids.add(generated);
    return generated;
  }

  function scopeFor(selected: string[] | undefined, parent: string[] | undefined, line: number) {
    if (selected && !selected.length) error ??= 'Line ' + line + ': choose at least one build.';
    const invalid = selected?.find((build) => !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(build) || (parent && !parent.includes(build)));
    if (invalid) error ??= parent
      ? 'Line ' + line + ': ' + invalid + ' is outside the parent scope (' + parent.join(', ') + ').'
      : 'Line ' + line + ': ' + invalid + ' is not a valid build slug.';
    return inheritBuildScope(selected, parent);
  }

  const headingRequired = 'Add a Heading 1 (#) before any text or images.';

  function add(...blocks: ProseBlock[]) {
    if (!blocks.length) return;
    const target = scopes.at(-1)?.blocks ?? parents.at(-1)?.blocks;
    if (target) target.push(...blocks);
    else error ??= headingRequired;
  }

  function flush() {
    if (!pending) return;
    const { lines, id } = pending;
    const image = lines.length === 1 && imageLine.exec(lines[0]);
    if (image) {
      try {
        const imageRef: ImageReference = image[2] === 'upload'
          ? { kind: 'upload', key: image[3] }
          : image[2] === 'wiki-icon' ? { kind: 'icon', key: image[3] } : { kind: 'wiki', asset: decodeURIComponent(image[3]) };
        add({ id: idFor(id), kind: 'image', image: imageRef, alt: image[1].replace(/\\([\\\]])/g, '$1'), caption: image[4] ? JSON.parse(image[4]) : undefined });
      } catch {
        error ??= 'An image reference or caption is invalid.';
      }
    } else if (id || lines.some((line) => line.trim())) {
      add({ id: idFor(id), kind: 'markdown', source: lines.map((line) => {
        const literal = line.startsWith('\\') && escaped(line) ? line.slice(1) : line;
        return literal.replace(/<!--wiki(\\*)\\:/g, '<!--wiki$1:');
      }).join('\n') });
    }
    pending = undefined;
  }

  function closeScope() {
    const scope = scopes.pop();
    if (!scope) return;
    if (scope.simple && scope.blocks.length === 1 && scope.blocks[0].kind !== 'scope') {
      const block = scope.blocks[0];
      add({ ...block, id: scope.id ? idFor(scope.id) : block.id, builds: scope.builds, entityIds: scope.entityIds });
    } else if ((scope.builds || scope.entityIds) && scope.blocks.length) {
      add({ id: idFor(scope.id), kind: 'scope', builds: scope.builds, entityIds: scope.entityIds, blocks: scope.blocks });
    } else {
      add(...scope.blocks);
    }
  }

  contexts.forEach((line, index) => {
    const { text, id } = line;
    if (line.endsBlock) {
      flush();
      if (scopes.length) closeScope();
      else error ??= 'Line ' + (index + 1) + ': this ::: has no matching scope.';
      return;
    }
    if (line.beginsBlock) {
      flush();
      if (!parents.length) error ??= headingRequired;
      const parent = scopes.at(-1);
      if (parent) parent.simple = false;
      if (scopes.length >= 12) error ??= 'Use at most 12 nested scopes.';
      const selectedIds = line.selectedIds;
      if (selectedIds && (!selectedIds.length || selectedIds.some((value) => !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(value) || (line.parentIds && !line.parentIds.includes(value))))) {
        error ??= 'Line ' + (index + 1) + ': enter valid IDs within the parent ID scope.';
      }
      scopes.push({
        id, builds: scopeFor(line.selectedBuilds, line.parent, index + 1),
        entityIds: inheritBuildScope(selectedIds, line.parentIds), blocks: [], simple: true,
      });
      return;
    }
    if (line.depth !== undefined && line.section !== undefined) {
      flush();
      if (line.depth > parents.length) error ??= 'Add the higher-level heading before this subsection.';
      parents.length = Math.min(line.depth, parents.length);
      const title = heading.exec(line.section)?.[2].trim() ?? '';
      if (!title) error ??= 'Enter a title for each heading.';
      const builds = scopeFor(line.selectedBuilds, line.parent, index + 1);
      const sectionId = idFor(id);
      const old = original.get(sectionId);
      const section: ProseSection = {
        id: sectionId, title, builds, updatedAt: old?.updatedAt ?? date,
        updatedAtForAnyBuild: old?.updatedAtForAnyBuild, updatedAtByBuild: old?.updatedAtByBuild,
        editedBy: old?.editedBy, editedByForAnyBuild: old?.editedByForAnyBuild, editedByByBuild: old?.editedByByBuild,
        blocks: [], sections: [],
      };
      const parent = parents.at(-1);
      (parent ? parent.sections : sections).push(section);
      parents.push(section);
      return;
    }
    if (!line.inCode && line.isImage) {
      flush();
      if (id && scopes.length) scopes[scopes.length - 1].simple = false;
      pending = { id, lines: [text] };
      flush();
      return;
    }
    if (id) {
      flush();
      if (scopes.length) scopes[scopes.length - 1].simple = false;
    }
    pending ??= { id, lines: [] };
    pending.lines.push(text);
  });
  flush();
  if (scopes.length) error ??= 'Close each scoped block with ::: on its own line.';
  while (scopes.length) closeScope();
  return { document: { ...previous, sections }, error };
}

export function sourceMarker(line: string) {
  return marker.exec(line);
}
