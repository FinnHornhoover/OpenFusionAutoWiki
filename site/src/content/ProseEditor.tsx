import { useEffect, useRef, useState } from 'react';
import { useManifest } from '../data/useManifest';
import type { ImageReference, PageProse, ProseDocument, ProseScope, ProseSection } from './document';
import { PROSE_IMAGE_MAX_BYTES } from './images';
import { ProsePreview } from './PlayerProse';
import ProseSectionEditor, { move, newSection } from './ProseSectionEditor';

interface Snapshot {
  revision: string | null;
  document: ProseDocument;
}

interface Loaded extends Snapshot {
  path: string;
  wikiImages?: PageProse['wikiImages'];
}

interface Props {
  build: string;
  query: string;
  scopes: ProseScope[];
  onClose(): void;
  onSave(scope: ProseScope, document: ProseDocument): void;
}

const scopeLabel = { general: 'General page', specific: 'This ID' };

async function payload(response: Response) {
  const data = await response.json();
  if (!response.ok && response.status !== 409) throw new Error(data.error ?? 'The request failed');
  return data;
}

function versionText(section?: ProseSection) {
  if (!section) return 'Section absent';
  return JSON.stringify(section, (key, value) => key === 'updatedAt' || key === 'updatedAtByBuild' ? undefined : value, 2);
}

function compareSections(base: ProseDocument, draft: ProseDocument, latest: ProseDocument) {
  const baseOrder = base.sections.map(({ id }) => id).join(',');
  const draftOrder = draft.sections.map(({ id }) => id).join(',');
  const preferred = baseOrder === draftOrder ? latest.sections : draft.sections;
  const ids = [...new Set([...preferred, ...draft.sections, ...latest.sections, ...base.sections].map(({ id }) => id))];
  return ids.map((id) => {
    const original = base.sections.find((section) => section.id === id);
    const yours = draft.sections.find((section) => section.id === id);
    const saved = latest.sections.find((section) => section.id === id);
    const mineChanged = versionText(yours) !== versionText(original);
    const theirsChanged = versionText(saved) !== versionText(original);
    return { id, original, yours, saved, overlap: mineChanged && theirsChanged && versionText(yours) !== versionText(saved), merged: mineChanged ? yours : saved };
  });
}

function restore(path: string) {
  try {
    const raw = localStorage.getItem('wiki-prose:' + path);
    return raw ? JSON.parse(raw) as { base: Snapshot; draft: ProseDocument } : undefined;
  } catch {
    return undefined;
  }
}

export default function ProseEditor({ build, query, scopes, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState<{ user: { login: string } | null; csrf?: string }>();
  const [scope, setScope] = useState<ProseScope | undefined>(scopes.length === 1 ? scopes[0] : undefined);
  const [loaded, setLoaded] = useState<Loaded>();
  const [base, setBase] = useState<Snapshot>();
  const [draft, setDraft] = useState<ProseDocument>();
  const [latest, setLatest] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploads, setUploads] = useState(0);
  const [resolving, setResolving] = useState(false);
  const [choices, setChoices] = useState<Record<string, 'yours' | 'saved'>>({});
  const [tab, setTab] = useState<'source' | 'preview'>('source');
  const [previewBuild, setPreviewBuild] = useState(build);
  const { manifest } = useManifest();
  const endpoint = scope ? `/api/prose/editor?${query}&scope=${scope}` : undefined;
  const dirty = draft && base && JSON.stringify(draft) !== JSON.stringify(base.document);

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/session', { signal: controller.signal }).then(payload).then(setSession)
      .catch(() => { if (!controller.signal.aborted) setError('Could not check GitHub sign-in. Reopen the editor to retry.'); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!endpoint || !session?.user) return;
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal }).then(payload).then((current: Loaded) => {
      if (controller.signal.aborted) return;
      const previous = restore(current.path);
      setLoaded(current);
      setBase(previous?.base ?? current);
      setDraft(previous?.draft ?? current.document);
      if (previous && previous.base.revision !== current.revision) setLatest(current);
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [endpoint, session?.user]);

  useEffect(() => {
    if (!loaded || !base || !draft || !dirty) return;
    try { localStorage.setItem('wiki-prose:' + loaded.path, JSON.stringify({ base, draft })); }
    catch { /* The draft remains available in this editor. */ }
  }, [loaded, base, draft, dirty]);

  const revision = base?.revision;
  useEffect(() => {
    if (!endpoint || revision === undefined || saving || latest) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      fetch(endpoint, { signal: controller.signal }).then(payload).then((current: Snapshot) => {
        if (!controller.signal.aborted && current.revision !== revision) setLatest(current);
      }).catch(() => { /* Save checks the authoritative revision again. */ });
    }, 60_000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [endpoint, revision, saving, latest]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function close() {
    if (saving || uploads) return;
    if (!dirty || window.confirm('Close the editor? Your draft is kept on this device when local storage is available.')) onClose();
  }

  async function upload(file: File): Promise<ImageReference> {
    if (file.size > PROSE_IMAGE_MAX_BYTES) throw new Error('Images must be 2 MiB or smaller');
    setUploads((count) => count + 1);
    try {
      const response = await fetch('/api/prose/images', {
        method: 'POST',
        headers: { 'X-Wiki-CSRF': session?.csrf ?? '' },
        body: file,
      });
      return (await payload(response)).image;
    } finally {
      setUploads((count) => count - 1);
    }
  }

  async function save() {
    if (!draft || !base || !endpoint || !scope || !loaded) return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Wiki-CSRF': session?.csrf ?? '' },
        body: JSON.stringify({ revision: base.revision, document: draft }),
      });
      const result = await payload(response);
      if (response.status === 409) {
        setLatest(result);
        setResolving(false);
        return;
      }
      setBase(result);
      setDraft(result.document);
      try { localStorage.removeItem('wiki-prose:' + loaded.path); } catch { /* Storage may be disabled. */ }
      onSave(scope, result.document);
      setStatus('Saved to the wiki.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const conflicts = resolving && base && draft && latest ? compareSections(base.document, draft, latest.document) : [];
  const returnUrl = new URL(window.location.href);
  returnUrl.searchParams.set('edit-prose', '1');
  const returnTo = returnUrl.pathname + returnUrl.search + returnUrl.hash;
  return (
    <dialog className="prose-editor" ref={dialog} aria-labelledby="prose-editor-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <header className="prose-editor-actions">
        <h2 id="prose-editor-title">Edit prose {scope && '· ' + scopeLabel[scope]}</h2>
        <button type="button" onClick={close} disabled={saving || uploads > 0}>Close</button>
      </header>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {session?.user === null && <a href={`/api/auth/login?${new URLSearchParams({ returnTo })}`}>Sign in with GitHub</a>}
      {!session && !error && <p role="status">Checking sign-in…</p>}
      {session?.user && !scope && (
        <div className="prose-editor-actions">
          {scopes.map((item) => <button key={item} type="button" onClick={() => setScope(item)}>{scopeLabel[item]}</button>)}
        </div>
      )}
      {session?.user && scope && !loaded && !error && <p role="status">Loading latest prose…</p>}
      {loaded && draft && (
        <>
          {latest && <p role="status">This document changed while you were editing.</p>}
          {resolving && latest ? (
            <div>
              {conflicts.filter(({ overlap }) => overlap).map((item) => (
                <fieldset key={item.id}>
                  <legend>{item.yours?.title ?? item.saved?.title ?? item.original?.title}</legend>
                  <div className="prose-conflict-versions">
                    <div><h3>Original version</h3><pre>{versionText(item.original)}</pre></div>
                    <div><h3>Your draft</h3><pre>{versionText(item.yours)}</pre></div>
                    <div><h3>Latest saved version</h3><pre>{versionText(item.saved)}</pre></div>
                  </div>
                  <label><input type="radio" name={item.id} checked={choices[item.id] === 'yours'} onChange={() => setChoices({ ...choices, [item.id]: 'yours' })} /> Use your draft</label>
                  <label><input type="radio" name={item.id} checked={choices[item.id] === 'saved'} onChange={() => setChoices({ ...choices, [item.id]: 'saved' })} /> Use latest saved version</label>
                </fieldset>
              ))}
              <button type="button" disabled={conflicts.some(({ overlap, id }) => overlap && !choices[id])} onClick={() => {
                const sections = conflicts.flatMap((item) => {
                  const section = item.overlap ? item[choices[item.id]] : item.merged;
                  return section ? [section] : [];
                });
                setDraft({ ...draft, sections });
                setBase(latest);
                setLatest(undefined);
                setResolving(false);
                setStatus('Conflict choices applied. Review your draft before saving.');
              }}>Apply conflict choices</button>
            </div>
          ) : (
            <>
              <div className="prose-editor-tabs" aria-label="Editor view">
                <button type="button" aria-pressed={tab === 'source'} onClick={() => setTab('source')}>Source</button>
                <button type="button" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>Preview</button>
              </div>
              <div className="prose-editor-panes" data-tab={tab}>
                <section className="prose-editor-source">
                  <h3>Source</h3>
                  <fieldset disabled={saving || uploads > 0}>
                    {draft.sections.map((section, index) => (
                      <ProseSectionEditor key={section.id} section={section} builds={manifest ?? []} wikiImages={loaded.wikiImages ?? {}} upload={upload}
                        onChange={(next) => setDraft({ ...draft, sections: draft.sections.map((item) => item.id === section.id ? next : item) })}
                        onRemove={() => setDraft({ ...draft, sections: draft.sections.filter((item) => item.id !== section.id) })}
                        onMove={(direction) => setDraft({ ...draft, sections: move(draft.sections, index, direction) })}
                      />
                    ))}
                    <button type="button" onClick={() => setDraft({ ...draft, sections: [...draft.sections, newSection()] })}>Add section</button>
                  </fieldset>
                </section>
                <section className="prose-editor-preview">
                  <h3>Preview</h3>
                  <label>Preview build <select value={previewBuild} onChange={(event) => setPreviewBuild(event.target.value)}>
                    {(manifest ?? []).map(({ slug, displayName }) => <option value={slug} key={slug}>{displayName}</option>)}
                    {!manifest?.some(({ slug }) => slug === build) && <option value={build}>{build}</option>}
                  </select></label>
                  <ProsePreview document={draft} build={previewBuild} wikiImages={loaded.wikiImages} preview />
                </section>
              </div>
              <footer className="prose-editor-actions">
                {latest
                  ? <button type="button" disabled={uploads > 0} onClick={() => { setChoices({}); setResolving(true); }}>Resolve page conflicts</button>
                  : <button type="button" disabled={!dirty || saving || uploads > 0} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>}
              </footer>
            </>
          )}
        </>
      )}
    </dialog>
  );
}
