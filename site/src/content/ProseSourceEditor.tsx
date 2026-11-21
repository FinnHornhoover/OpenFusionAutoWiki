import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import { Decoration, EditorView, keymap, lineNumbers } from '@codemirror/view';
import type { BuildEntry } from '../data/useManifest';
import { inheritBuildScope, type ImageReference } from './document';
import { imageSource, sourceBuildContext, sourceBuildScopes, sourceMarker } from './proseSource';

const markerStyle = Decoration.replace({});
function buildColor(slug: string) {
  let hash = 2166136261;
  for (const character of slug) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `hsl(${(hash >>> 0) % 360} 75% 66%)`;
}

function scopeBackground(builds: string[]) {
  const tones = builds.map((build) => `color-mix(in srgb, ${buildColor(build)} 18%, transparent)`);
  if (tones.length === 1) return tones[0];
  const stops = tones.map((tone, index) => `${tone} ${index * 100 / tones.length}% ${(index + 1) * 100 / tones.length}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function decorations(activeBuild?: string) {
  return EditorView.decorations.compute(['doc'], (state) => {
    const ranges = [];
    const scopes = sourceBuildScopes(state.doc.toString().split('\n'));
    for (let number = 1; number <= state.doc.lines; number++) {
      const line = state.doc.line(number);
      const builds = scopes[number - 1];
      if (builds?.length) {
        const highlighted = activeBuild && builds.includes(activeBuild);
        const color = buildColor(highlighted ? activeBuild : builds[0]);
        const background = scopeBackground(builds);
        ranges.push(Decoration.line({
          class: highlighted ? 'cm-build-specific cm-build-highlighted' : 'cm-build-specific',
          attributes: { style: `--prose-build-color: ${color}; --prose-build-background: ${background}` },
        }).range(line.from));
      }
      const marker = sourceMarker(line.text);
      if (marker) ranges.push(markerStyle.range(line.from + marker.index, line.from + marker.index + marker[0].length));
    }
    return Decoration.set(ranges, true);
  });
}

const icons = {
  heading: 'M5 5v14M19 5v14M5 12h14',
  bullet: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  ordered: 'M10 6h11M10 12h11M10 18h11M3 5h1v3M3 11c3-2 4 1 0 3h3M3 17h3l-1 1c2 0 2 2-2 2',
  table: 'M3 4h18v16H3zM3 9h18M3 14h18M9 4v16M15 4v16',
  link: 'M10 13a4 4 0 0 0 6 0l3-3a4 4 0 1 0-6-6l-2 2m3 5a4 4 0 0 0-6 0l-3 3a4 4 0 1 0 6 6l2-2',
  wiki: 'M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14',
  image: 'M3 4h18v16H3zM3 16l5-5 4 4 3-3 6 6M15 8h.01',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
  builds: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 4 9 5 9-5',
} as const;

type Panel = 'heading' | 'wiki' | 'image' | 'builds';

interface Props {
  source: string;
  sectionId?: string;
  onChange(source: string): void;
  builds: BuildEntry[];
  wikiImages: Record<string, string>;
  upload?(file: File): Promise<ImageReference>;
  disabled: boolean;
  error?: string;
}

export default function ProseSourceEditor({ source, sectionId, onChange, builds, wikiImages, upload, disabled, error }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const view = useRef<EditorView>();
  const change = useRef(onChange);
  const initialSource = useRef(source);
  const initialSection = useRef(sectionId);
  const [editable] = useState(() => new Compartment());
  const [scopeDecorations] = useState(() => new Compartment());
  const [hoveredBuild, setHoveredBuild] = useState<string>();
  const [focusedBuild, setFocusedBuild] = useState<string>();
  const scopedBuilds = useMemo(() => [...new Set(sourceBuildScopes(source.split('\n')).flatMap((scope) => scope ?? []))], [source]);
  const [panel, setPanel] = useState<Panel>();
  const [target, setTarget] = useState('');
  const [label, setLabel] = useState('');
  const [asset, setAsset] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [selectedBuilds, setSelectedBuilds] = useState<string[]>([]);
  const [allowedBuilds, setAllowedBuilds] = useState<string[]>();
  const [uploadError, setUploadError] = useState('');
  const [scopeError, setScopeError] = useState('');
  change.current = onChange;

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initialSource.current,
        extensions: [
          scopeDecorations.of(decorations()), history(), keymap.of([...defaultKeymap, ...historyKeymap]), markdown(),
          lineNumbers(), EditorView.lineWrapping, editable.of(EditorView.editable.of(true)),
          EditorView.contentAttributes.of({ 'aria-label': 'Markdown source', 'aria-multiline': 'true', spellcheck: 'true' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    if (initialSection.current) {
      const { doc } = editor.state;
      for (let number = 1; number <= doc.lines; number++) {
        const line = doc.line(number);
        if (sourceMarker(line.text)?.[1] !== initialSection.current) continue;
        editor.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start' }) });
        break;
      }
    }
    return () => { view.current = undefined; editor.destroy(); };
  }, [editable, scopeDecorations]);

  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== source) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: source } });
    }
  }, [source]);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.reconfigure([
      EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled),
    ]) });
  }, [disabled, editable]);

  useEffect(() => {
    view.current?.dispatch({ effects: scopeDecorations.reconfigure(decorations(hoveredBuild ?? focusedBuild)) });
  }, [scopeDecorations, hoveredBuild, focusedBuild]);

  function insert(value: string, placement: 'inline' | 'block' | 'line' = 'inline') {
    const editor = view.current;
    if (!editor) return;
    const { from, to } = editor.state.selection.main;
    const { doc } = editor.state;
    // Keep the current line's stable marker attached when inserting a new block.
    const line = doc.lineAt(to);
    const standalone = placement !== 'inline';
    const anchor = standalone ? line.to : to;
    const separator = placement === 'block' ? '\n\n' : '\n';
    const before = standalone && anchor > 0 ? separator : '';
    const after = standalone && anchor < doc.length ? separator : '';
    const text = before + value + after;
    editor.dispatch({ changes: { from: standalone ? anchor : from, to: anchor, insert: text }, selection: { anchor: (standalone ? anchor : from) + before.length + value.length } });
    editor.focus();
  }

  function scopeTarget() {
    const editor = view.current;
    if (!editor) return undefined;
    const { doc, selection } = editor.state;
    const range = selection.main;
    const first = doc.lineAt(range.from);
    const last = doc.lineAt(Math.max(range.from, range.to - 1));
    const context = sourceBuildContext(doc.toString().split('\n'));
    const line = context[first.number - 1];
    const opening = (range.empty || line.beginsBlock) ? line.blockStart : undefined;
    const existing = opening === undefined ? undefined : doc.line(opening + 1);
    const info = opening === undefined ? line : context[opening];
    const parent = existing || line.depth !== undefined ? info.parent : info.builds;
    return { first, last, info, existing, parent, context };
  }

  function applyScope() {
    const editor = view.current;
    const scope = scopeTarget();
    if (!editor || !scope) return;
    const { first, last, info, existing, parent, context } = scope;
    const value = inheritBuildScope(selectedBuilds.length ? selectedBuilds : undefined, parent)?.join(', ');
    if (info.inCode) {
      setScopeError('Select text outside the code fence.');
      return;
    }
    if (!existing && first.number !== last.number) {
      const crossesBoundary = context.slice(first.number, last.number)
        .some((line) => line.depth !== undefined || line.beginsBlock || line.endsBlock || line.id || line.blockStart !== info.blockStart);
      if (info.depth !== undefined || crossesBoundary) {
        setScopeError('Choose one heading or select text within a single block.');
        return;
      }
    }
    const marker = info.id ? ' <!--wiki:' + info.id + '-->' : '';
    if (existing) {
      if (value) {
        editor.dispatch({ changes: { from: existing.from, to: existing.to, insert: '::: builds ' + value + marker } });
      } else {
        const end = context.findIndex((line, index) => index >= existing.number && line.endsBlock && line.blockStart === existing.number - 1);
        if (end === -1) {
          setScopeError('Close the build scope before removing it.');
          return;
        }
        const { doc } = editor.state;
        const body = context.slice(existing.number, end).map((_, index) => doc.line(existing.number + index + 1).text);
        if (body.length && context.slice(existing.number, end).every((line) => !line.id && !line.beginsBlock && !line.endsBlock)) {
          body[0] += marker;
        }
        const lastLine = doc.line(end + 1);
        const to = body.length || lastLine.to === doc.length ? lastLine.to : lastLine.to + 1;
        editor.dispatch({ changes: { from: existing.from, to, insert: body.join('\n') } });
      }
    } else if (info.depth !== undefined && info.section) {
      editor.dispatch({ changes: { from: first.from, to: first.to, insert: info.section + (value ? ' {builds: ' + value + '}' : '') + marker } });
    } else if (value) {
      const { doc } = editor.state;
      const reference = sourceMarker(first.text);
      const text = doc.sliceString(first.from, last.to);
      const body = reference ? text.slice(0, reference.index) + text.slice(reference.index + reference[0].length) : text;
      editor.dispatch({ changes: { from: first.from, to: last.to, insert: '::: builds ' + value + marker + '\n' + body + '\n:::' } });
    }
    setPanel(undefined);
    editor.focus();
  }

  function openPanel(next: Panel) {
    if (panel === next) { setPanel(undefined); return; }
    if (next === 'builds') {
      setScopeError('');
      const scope = scopeTarget();
      setAllowedBuilds(scope?.parent);
      setSelectedBuilds(scope?.existing || scope?.info.depth !== undefined
        ? (scope?.info.selectedBuilds ?? []).filter((build) => !scope?.parent || scope.parent.includes(build))
        : []);
    }
    setPanel(next);
  }

  function tool(icon: keyof typeof icons, name: string, action: () => void, mobile = false, active?: boolean) {
    return (
      <button type="button" title={name} aria-label={name} aria-pressed={active} disabled={disabled} data-desktop-only={mobile || undefined}
        onMouseDown={(event) => event.preventDefault()} onClick={action}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[icon]} /></svg>
      </button>
    );
  }

  return (
    <>
      <div className="prose-source-toolbar" role="group" aria-label="Markdown tools">
        {tool('heading', 'Add heading', () => openPanel('heading'), false, panel === 'heading')}
        {tool('bullet', 'Bulleted list', () => insert('- First item\n- Second item', 'block'))}
        {tool('ordered', 'Numbered list', () => insert('1. First item\n2. Second item', 'block'))}
        {tool('table', 'Insert table', () => insert('| Heading | Heading |\n| --- | --- |\n| Cell | Cell |', 'block'), true)}
        {tool('link', 'Insert external link', () => insert('[Link text](https://example.com)'))}
        {tool('wiki', 'Link from the Wiki', () => openPanel('wiki'), false, panel === 'wiki')}
        {tool('image', 'Add Image from the Wiki', () => openPanel('image'), false, panel === 'image')}
        {upload && tool('upload', 'Add image', () => fileInput.current?.click())}
        {tool('builds', 'Set build visibility', () => openPanel('builds'), false, panel === 'builds')}
      </div>
      {scopedBuilds.length > 0 && (
        <div className="prose-build-legend" role="group" aria-label="Build color legend">
          {scopedBuilds.map((slug) => {
            const build = builds.find((entry) => entry.slug === slug);
            return (
              <button key={slug} type="button" title={build?.displayName ?? slug}
                style={{ '--prose-build-color': buildColor(slug) } as CSSProperties}
                onPointerEnter={() => setHoveredBuild(slug)} onPointerLeave={() => setHoveredBuild(undefined)}
                onFocus={() => setFocusedBuild(slug)} onBlur={() => setFocusedBuild(undefined)}>
                <span aria-hidden="true" />{build?.nickname || slug}
              </button>
            );
          })}
        </div>
      )}
      {panel === 'heading' && (
        <div className="prose-source-panel prose-heading-options" role="group" aria-label="Heading level">
          {[1, 2, 3, 4, 5, 6].map((level) => (
            <button key={level} type="button" disabled={disabled} onClick={() => {
              insert('#'.repeat(level) + ' Heading', 'line');
              setPanel(undefined);
            }}>Heading {level}</button>
          ))}
        </div>
      )}
      {panel === 'wiki' && (
        <div className="prose-source-panel">
          <label>Link text <input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
          <label>Wiki target <input value={target} placeholder="npcs/buttercup" onChange={(event) => setTarget(event.target.value)} /></label>
          <button type="button" disabled={disabled || !label.trim() || !/^[a-z-]+\/[\w-]+$/.test(target)} onClick={() => {
            insert('[' + label.trim().replace(/[\[\]\\]/g, '\\$&') + '](wiki:' + target + ')');
            setPanel(undefined);
          }}>Insert wiki link</button>
        </div>
      )}
      {panel === 'image' && (
        <div className="prose-source-panel">
          {Object.keys(wikiImages).length === 0 ? <p>No wiki images are available for this page.</p> : <>
            <label>Search icons <input value={assetSearch} onChange={(event) => { setAssetSearch(event.target.value); setAsset(''); }} /></label>
            <div className="prose-image-picker-actions">
              <select className="styled-select" aria-label="Wiki icon" value={asset} onChange={(event) => setAsset(event.target.value)}>
                <option value="">Choose an image</option>
                {Object.keys(wikiImages).filter((key) => key.toLowerCase().includes(assetSearch.toLowerCase())).slice(0, 100).map((key) => <option key={key}>{key}</option>)}
              </select>
              {asset && <img className="prose-icon-preview" src={wikiImages[asset]} alt={asset} />}
              <button type="button" disabled={disabled || !asset} onClick={() => { insert(imageSource({ kind: 'wiki', asset }), 'line'); setPanel(undefined); }}>Insert image</button>
            </div>
          </>}
        </div>
      )}
      {panel === 'builds' && (
        <div className="prose-source-panel">
          <div className="prose-build-options">
            <label><input type="checkbox" checked={selectedBuilds.length === 0} onChange={() => setSelectedBuilds([])} /> Any build</label>
            {builds.filter(({ slug }) => !allowedBuilds || allowedBuilds.includes(slug)).map(({ slug, displayName }) => (
              <label key={slug}><input type="checkbox" checked={selectedBuilds.includes(slug)} onChange={(event) => setSelectedBuilds(
                event.target.checked ? [...selectedBuilds, slug] : selectedBuilds.filter((item) => item !== slug),
              )} /> {displayName}</label>
            ))}
          </div>
          <button type="button" disabled={disabled} onClick={applyScope}>Apply build visibility</button>
          {scopeError && <p role="alert">{scopeError}</p>}
        </div>
      )}
      {upload && <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setUploadError('');
        try { insert(imageSource(await upload(file)), 'line'); }
        catch (failure) { setUploadError(failure instanceof Error ? failure.message : 'Upload failed'); }
      }} />}
      {uploadError && <p role="alert">{uploadError}</p>}
      <div className="prose-markdown-editor" ref={host} />
      {error && <p role="alert">{error}</p>}
    </>
  );
}
