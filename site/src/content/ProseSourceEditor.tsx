import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import { Decoration, EditorView, keymap, lineNumbers } from '@codemirror/view';
import type { BuildEntry } from '../data/useManifest';
import { inheritBuildScope, type ImageReference } from './document';
import { imageSource, sourceBuildContext, sourceMarker } from './proseSource';

const markerStyle = Decoration.replace({});
function scopeColor(key: string) {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `hsl(${(hash >>> 0) % 360} 75% 66%)`;
}

function scopeBackground(keys: string[]) {
  const tones = keys.map((key) => `color-mix(in srgb, ${scopeColor(key)} 18%, transparent)`);
  if (tones.length === 1) return `linear-gradient(90deg, ${tones[0]}, ${tones[0]})`;
  const stops = tones.map((tone, index) => `${tone} ${index * 100 / tones.length}% ${(index + 1) * 100 / tones.length}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function decorations(activeScope?: string) {
  return EditorView.decorations.compute(['doc'], (state) => {
    const ranges = [];
    const scopes = sourceBuildContext(state.doc.toString().split('\n'));
    for (let number = 1; number <= state.doc.lines; number++) {
      const line = state.doc.line(number);
      const { builds, entityIds } = scopes[number - 1];
      const idKeys = entityIds?.map((id) => 'id:' + id);
      if (builds?.length || idKeys?.length) {
        const classes = [];
        const styles = [];
        if (builds?.length) {
          classes.push('cm-build-specific');
          styles.push(`--prose-build-color: ${scopeColor(builds[0])}`, `--prose-build-background: ${scopeBackground(builds)}`);
        }
        if (idKeys?.length) {
          classes.push('cm-id-specific');
          styles.push(`--prose-id-color: ${scopeColor(idKeys[0])}`, `--prose-id-background: ${scopeBackground(idKeys)}`);
        }
        if (activeScope && (builds?.includes(activeScope) || idKeys?.includes(activeScope))) {
          classes.push('cm-scope-highlighted');
          styles.push(`--prose-highlight-color: ${scopeColor(activeScope)}`);
        }
        ranges.push(Decoration.line({ class: classes.join(' '), attributes: { style: styles.join('; ') } }).range(line.from));
      }
      const marker = sourceMarker(line.text);
      if (marker) ranges.push(markerStyle.range(line.from + marker.index, line.from + marker.index + marker[0].length));
    }
    return Decoration.set(ranges, true);
  });
}

const icons = {
  bullet: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  ordered: 'M10 6h11M10 12h11M10 18h11M3 5h1v3M3 11c3-2 4 1 0 3h3M3 17h3l-1 1c2 0 2 2-2 2',
  table: 'M3 4h18v16H3zM3 9h18M3 14h18M9 4v16M15 4v16',
  link: 'M10 13a4 4 0 0 0 6 0l3-3a4 4 0 1 0-6-6l-2 2m3 5a4 4 0 0 0-6 0l-3 3a4 4 0 1 0 6 6l2-2',
  image: 'M3 4h18v16H3zM3 16l5-5 4 4 3-3 6 6M15 8h.01',
} as const;

type Panel = 'builds' | 'ids';

interface Props {
  source: string;
  sectionId?: string;
  onChange(source: string): void;
  builds: BuildEntry[];
  entityId?: string;
  upload?(file: File): Promise<ImageReference>;
  disabled: boolean;
  error?: string;
}

export default function ProseSourceEditor({ source, sectionId, onChange, builds, entityId, upload, disabled, error }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const view = useRef<EditorView>();
  const change = useRef(onChange);
  const initialSource = useRef(source);
  const initialSection = useRef(sectionId);
  const [editable] = useState(() => new Compartment());
  const [scopeDecorations] = useState(() => new Compartment());
  const [hoveredScope, setHoveredScope] = useState<string>();
  const [focusedScope, setFocusedScope] = useState<string>();
  const legend = useMemo(() => {
    const scopes = sourceBuildContext(source.split('\n'));
    const buildKeys = new Set(scopes.flatMap(({ builds }) => builds ?? []));
    const ids = new Set(scopes.flatMap(({ entityIds }) => entityIds ?? []));
    return [
      ...Array.from(buildKeys, (key) => {
        const build = builds.find((entry) => entry.slug === key);
        return { key, label: build?.nickname || key, title: build?.displayName ?? key };
      }),
      ...Array.from(ids, (id) => ({ key: 'id:' + id, label: 'ID ' + id, title: 'ID ' + id })),
    ];
  }, [source, builds]);
  const [panel, setPanel] = useState<Panel>();
  const [selectedIds, setSelectedIds] = useState('');
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
    view.current?.dispatch({ effects: scopeDecorations.reconfigure(decorations(hoveredScope ?? focusedScope)) });
  }, [scopeDecorations, hoveredScope, focusedScope]);

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

  function scopeTarget(kind: Panel) {
    const editor = view.current;
    if (!editor) return undefined;
    const { doc, selection } = editor.state;
    const range = selection.main;
    const first = doc.lineAt(range.from);
    const last = doc.lineAt(Math.max(range.from, range.to - 1));
    const context = sourceBuildContext(doc.toString().split('\n'));
    const line = context[first.number - 1];
    const candidate = line.blockStart;
    const opening = (range.empty || line.beginsBlock) && candidate !== undefined && context[candidate].scopeKind === kind
      ? candidate : undefined;
    const existing = opening === undefined ? undefined : doc.line(opening + 1);
    const info = opening === undefined ? line : context[opening];
    const parent = kind === 'ids'
      ? existing ? info.parentIds : info.entityIds
      : existing ? info.parent : info.builds;
    return { first, last, info, existing, parent, context };
  }

  function applyScope() {
    const editor = view.current;
    if (!panel) return;
    const scope = scopeTarget(panel);
    if (!editor || !scope) return;
    const { first, last, info, existing, parent, context } = scope;
    const selected = panel === 'ids' ? selectedIds.split(/[,\s]+/).filter(Boolean) : selectedBuilds;
    if (selected.some((id) => !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(id) || (parent && !parent.includes(id)))) {
      setScopeError('Choose valid values within the enclosing scope.');
      return;
    }
    const value = inheritBuildScope(selected.length ? selected : undefined, parent)?.join(', ');
    const directive = '::: ' + panel + ' ';
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
        editor.dispatch({ changes: { from: existing.from, to: existing.to, insert: directive + value + marker } });
      } else {
        const end = context.findIndex((line, index) => index >= existing.number && line.endsBlock && line.blockStart === existing.number - 1);
        if (end === -1) {
          setScopeError('Close the scope before removing it.');
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
    } else if ((info.depth !== undefined || info.beginsBlock || info.endsBlock) && value) {
      insert(directive + value + '\n' + (panel === 'ids' ? 'ID-specific text' : 'Build-specific text') + '\n:::', 'line');
    } else if (value) {
      const { doc } = editor.state;
      const reference = sourceMarker(first.text);
      const text = doc.sliceString(first.from, last.to);
      const body = reference ? text.slice(0, reference.index) + text.slice(reference.index + reference[0].length) : text;
      editor.dispatch({ changes: { from: first.from, to: last.to, insert: directive + value + marker + '\n' + body + '\n:::' } });
    }
    setPanel(undefined);
    editor.focus();
  }

  function openPanel(next: Panel) {
    if (panel === next) { setPanel(undefined); return; }
    setScopeError('');
    const scope = scopeTarget(next);
    if (next === 'builds') {
      setAllowedBuilds(scope?.parent);
      setSelectedBuilds(scope?.existing ? [...scope.info.selectedBuilds ?? []] : []);
    } else {
      setSelectedIds(scope?.existing ? (scope.info.selectedIds ?? []).join(', ') : entityId ?? '');
    }
    setPanel(next);
  }

  function tool(icon: keyof typeof icons | null, name: string, action: () => void, mobile = false, active?: boolean, text?: string) {
    return (
      <button type="button" title={name} aria-label={name} aria-pressed={active} disabled={disabled} data-desktop-only={mobile || undefined}
        onMouseDown={(event) => event.preventDefault()} onClick={action}>
        {icon ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[icon]} /></svg> : text}
      </button>
    );
  }

  return (
    <>
      <div className="prose-source-toolbar" role="group" aria-label="Markdown tools">
        {[1, 2, 3].map((level) => <span key={level}>{tool(null, 'Heading ' + level, () => insert('#'.repeat(level) + ' Heading', 'line'), false, undefined, 'H' + level)}</span>)}
        {tool('bullet', 'Unordered list', () => insert('- First item\n- Second item', 'block'))}
        {tool('ordered', 'Ordered list', () => insert('1. First item\n2. Second item', 'block'))}
        {tool('table', 'Insert table', () => insert('| Heading | Heading |\n| --- | --- |\n| Cell | Cell |', 'block'), true)}
        {tool('link', 'Insert link', () => insert('[Link text](https://example.com)'))}
        {upload && tool('image', 'Add image', () => fileInput.current?.click())}
        {tool(null, 'Build-specific info block', () => openPanel('builds'), false, panel === 'builds', 'BSIB')}
        {tool(null, 'ID-specific info block', () => openPanel('ids'), false, panel === 'ids', 'IDSIB')}
      </div>
      {legend.length > 0 && (
        <div className="prose-build-legend" role="group" aria-label="Build and ID color legend">
          {legend.map(({ key, label, title }) => (
            <button key={key} type="button" title={title}
              style={{ '--prose-legend-color': scopeColor(key) } as CSSProperties}
              onPointerEnter={() => setHoveredScope(key)} onPointerLeave={() => setHoveredScope(undefined)}
              onFocus={() => setFocusedScope(key)} onBlur={() => setFocusedScope(undefined)}>
              <span aria-hidden="true" />{label}
            </button>
          ))}
        </div>
      )}
      {panel === 'ids' && (
        <div className="prose-source-panel">
          <label>Entity IDs <input value={selectedIds} placeholder="720, 773" onChange={(event) => setSelectedIds(event.target.value)} /></label>
          <button type="button" disabled={disabled} onClick={applyScope}>Apply ID visibility</button>
          {scopeError && <p role="alert">{scopeError}</p>}
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
