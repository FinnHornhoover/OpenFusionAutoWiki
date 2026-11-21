import { useRef, useState } from 'react';
import type { ImageReference, ProseBlock, ProseSection } from './document';
import type { BuildEntry } from '../data/useManifest';

export function newSection(): ProseSection {
  return { id: crypto.randomUUID(), title: 'New section', updatedAt: new Date().toISOString(), blocks: [], sections: [] };
}

interface Props {
  section: ProseSection;
  onChange(section: ProseSection): void;
  onRemove(): void;
  onMove?(direction: number): void;
  builds: BuildEntry[];
  parentScope?: string[];
  wikiImages: Record<string, string>;
  upload(file: File): Promise<ImageReference>;
  depth?: number;
}

function replace<T>(items: T[], index: number, value: T) {
  return items.map((item, current) => current === index ? value : item);
}

export function move<T>(items: T[], index: number, direction: number) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function Scope({ chosen, builds, parent, onChange }: { chosen?: string[]; builds: BuildEntry[]; parent?: string[]; onChange(next?: string[]): void }) {
  return (
    <details className="prose-scope" data-specific={!!chosen}>
      <summary>{chosen?.length ? 'Build-specific' : 'All applicable builds'}</summary>
      {chosen?.map((slug) => <span className="badge badge-category" key={slug}>{builds.find((build) => build.slug === slug)?.displayName ?? slug}</span>)}
      <div className="prose-build-options">
        {builds.filter(({ slug }) => !parent || parent.includes(slug) || chosen?.includes(slug)).map(({ slug, displayName }) => (
          <label key={slug}>
            <input type="checkbox" checked={chosen?.includes(slug) ?? false} onChange={(event) => {
              const next = event.target.checked ? [...chosen ?? [], slug] : chosen?.filter((item) => item !== slug);
              onChange(next?.length ? next : undefined);
            }} />
            {displayName}
          </label>
        ))}
      </div>
    </details>
  );
}

function WikiLinkControl({ onInsert }: { onInsert(source: string): void }) {
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  return (
    <details>
      <summary>Link from the Wiki</summary>
      <label>Link text <input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <label>Wiki target <input value={target} placeholder="npcs/buttercup" onChange={(event) => setTarget(event.target.value)} /></label>
      <button type="button" disabled={!label.trim() || !/^[a-z-]+\/[\w-]+$/.test(target)} onClick={() => {
        onInsert(`[${label.trim().replace(/[\\[\]\\\\]/g, '\\\\$&')}](wiki:${target})`);
        setLabel('');
        setTarget('');
      }}>Insert wiki link</button>
    </details>
  );
}

export default function ProseSectionEditor({ section, onChange, onRemove, onMove, builds, parentScope, wikiImages, upload, depth = 1 }: Props) {
  const [asset, setAsset] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const scope = section.builds ?? parentScope;
  const current = useRef({ section, onChange });
  current.current = { section, onChange };
  const addImage = (image: ImageReference) => {
    const { section: latest, onChange: update } = current.current;
    update({ ...latest, blocks: [...latest.blocks, { id: crypto.randomUUID(), kind: 'image', image, alt: '' }] });
  };

  return (
    <fieldset className="prose-section-editor" data-specific={!!section.builds}>
      <legend>{section.title || 'Section'}</legend>
      <label>Section title <input value={section.title} onChange={(event) => onChange({ ...section, title: event.target.value })} /></label>
      <Scope chosen={section.builds} builds={builds} parent={parentScope} onChange={(chosen) => onChange({ ...section, builds: chosen })} />
      {section.blocks.map((block, index) => {
        const update = (value: ProseBlock) => onChange({ ...section, blocks: replace(section.blocks, index, value) });
        return (
          <div className="prose-block-editor" data-specific={!!block.builds} key={block.id}>
            {block.kind === 'markdown' ? (
              <>
                <label>Markdown <textarea rows={5} value={block.source} onChange={(event) => update({ ...block, source: event.target.value })} /></label>
                <details>
                  <summary>Formatting</summary>
                  <div className="prose-editor-actions">
                    {Object.entries({
                      Heading: '## Heading',
                      'Bulleted list': '- First item\n- Second item',
                      'Numbered list': '1. First item\n2. Second item',
                      Table: '| Heading | Heading |\n| --- | --- |\n| Cell | Cell |',
                      'External link': '[Link text](https://example.com)',
                    }).map(([label, source]) => (
                      <button type="button" key={label} onClick={() => update({ ...block, source: [block.source, source].filter(Boolean).join('\n\n') })}>{label}</button>
                    ))}
                  </div>
                </details>
                <WikiLinkControl onInsert={(link) => update({ ...block, source: block.source ? block.source + ' ' + link : link })} />
              </>
            ) : (
              <>
                <label>Image description <input value={block.alt} onChange={(event) => update({ ...block, alt: event.target.value })} /></label>
                <label>Caption <input value={block.caption ?? ''} onChange={(event) => update({ ...block, caption: event.target.value })} /></label>
              </>
            )}
            <Scope chosen={block.builds} builds={builds} parent={scope} onChange={(chosen) => update({ ...block, builds: chosen })} />
            <div className="prose-editor-actions">
              <button type="button" disabled={index === 0} onClick={() => onChange({ ...section, blocks: move(section.blocks, index, -1) })}>Move block up</button>
              <button type="button" disabled={index === section.blocks.length - 1} onClick={() => onChange({ ...section, blocks: move(section.blocks, index, 1) })}>Move block down</button>
              <button type="button" onClick={() => onChange({ ...section, blocks: section.blocks.filter((item) => item.id !== block.id) })}>Remove block</button>
            </div>
          </div>
        );
      })}
      {section.sections.map((child, index) => (
        <ProseSectionEditor key={child.id} section={child} depth={depth + 1} builds={builds} parentScope={scope} wikiImages={wikiImages} upload={upload}
          onChange={(next) => onChange({ ...section, sections: replace(section.sections, index, next) })}
          onMove={(direction) => onChange({ ...section, sections: move(section.sections, index, direction) })}
          onRemove={() => onChange({ ...section, sections: section.sections.filter((item) => item.id !== child.id) })}
        />
      ))}
      <div className="prose-editor-actions">
        <button type="button" onClick={() => onChange({ ...section, blocks: [...section.blocks, { id: crypto.randomUUID(), kind: 'markdown', source: '' }] })}>Add text</button>
        {depth < 3 && <button type="button" onClick={() => onChange({ ...section, sections: [...section.sections, newSection()] })}>Add subsection</button>}
        {onMove && <button type="button" onClick={() => onMove(-1)}>Move section up</button>}
        {onMove && <button type="button" onClick={() => onMove(1)}>Move section down</button>}
        <button type="button" onClick={onRemove}>Remove section</button>
      </div>
      <label>Upload image <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setUploading(true);
        setUploadError('');
        try { addImage(await upload(file)); }
        catch (error) { setUploadError(error instanceof Error ? error.message : 'Upload failed'); }
        finally { setUploading(false); }
      }} /></label>
      {uploading && <p role="status">Uploading image…</p>}
      {uploadError && <p role="alert">{uploadError}</p>}
      {Object.keys(wikiImages).length > 0 && (
        <details>
          <summary>Add Image from the Wiki</summary>
          <label>Search icons <input value={assetSearch} onChange={(event) => { setAssetSearch(event.target.value); setAsset(''); }} /></label>
          <select aria-label="Wiki icon" value={asset} onChange={(event) => setAsset(event.target.value)}>
            <option value="">Choose an image</option>
            {Object.keys(wikiImages).filter((key) => key.toLowerCase().includes(assetSearch.toLowerCase())).slice(0, 100).map((key) => <option key={key}>{key}</option>)}
          </select>
          {asset && <img className="prose-icon-preview" src={wikiImages[asset]} alt={asset} />}
          <button type="button" disabled={!asset} onClick={() => addImage({ kind: 'wiki', asset })}>Insert wiki image</button>
        </details>
      )}
    </fieldset>
  );
}
