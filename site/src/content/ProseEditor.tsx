import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useManifest } from '../data/useManifest';
import type { ImageReference, PageProse, ProseDocument } from './document';
import { PROSE_IMAGE_MAX_BYTES, PROSE_IMAGE_MAX_DIMENSION, PROSE_IMAGE_TYPES } from './images';
import { existingWikiIcon } from './wikiImageLookup';
import { ProsePreview } from './PlayerProse';
import ProseConflictResolver from './ProseConflictResolver';
import ProseSourceEditor from './ProseSourceEditor';
import { planProseMerge } from './proseMerge';
import { readProseSource, sourceBuildContext, sourceBuildScopes, writeProseSource } from './proseSource';

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
  sectionId?: string;
  name: string;
  entityId?: string;
  pageProse: PageProse;
  onClose(): void;
  onSave(document: ProseDocument): void;
}

const SOURCE_VERSION = 2;

interface EditorSession {
  user: { id: number; login: string } | null;
  csrf?: string;
  development?: boolean;
}

interface StoredDraft {
  base: Snapshot;
  draft: ProseDocument;
  source?: string;
  sourceVersion?: number;
}

function draftKey(path: string, userId?: number) {
  return 'wiki-prose:' + (userId === undefined ? path : `github:${userId}:${path}`);
}

function storeDraft(key: string, draft: StoredDraft) {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

function removeDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
}

async function payload(response: Response) {
  const data = await response.json();
  if (!response.ok && response.status !== 409) throw new Error(data.error ?? 'The request failed');
  return data;
}

function restore(key: string) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as StoredDraft : undefined;
  } catch {
    return undefined;
  }
}

export default function ProseEditor({ build, query, sectionId, name, entityId, pageProse, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const login = useRef<HTMLAnchorElement>(null);
  const localImages = useRef(new Map<string, string>());
  const [session, setSession] = useState<EditorSession>();
  const [localPreview, setLocalPreview] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>();
  const [base, setBase] = useState<Snapshot>();
  const [source, setSource] = useState('');
  const [metadata, setMetadata] = useState<ProseDocument>();
  const [draftIdentity] = useState(() => ({ id: crypto.randomUUID(), date: new Date().toISOString() }));
  const parsed = useMemo(() => metadata && readProseSource(source, metadata, draftIdentity.id, draftIdentity.date), [source, metadata, draftIdentity]);
  const draft = parsed?.document;
  const [latest, setLatest] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [uploads, setUploads] = useState(0);
  const [resolving, setResolving] = useState(false);
  const [tab, setTab] = useState<'source' | 'preview'>('source');
  const [previewBuild, setPreviewBuild] = useState('');
  const [previewId, setPreviewId] = useState(entityId ?? '');
  const scopedIds = useMemo(() => [...new Set([...(entityId ? [entityId] : []),
    ...sourceBuildContext(source.split('\n')).flatMap((line) => line.entityIds ?? [])])], [source, entityId]);
  const scopedBuilds = useMemo(() => [...new Set(sourceBuildScopes(source.split('\n')).flatMap((scope) => scope ?? []))], [source]);
  const selectedPreviewBuild = scopedBuilds.includes(previewBuild) ? previewBuild : '';
  const { manifest } = useManifest();
  const endpoint = `/api/prose/editor?${query}`;
  const baseSource = base && writeProseSource(base.document);
  const dirty = baseSource !== undefined && source !== baseSource;
  const showingConflicts = !!latest && resolving && !parsed?.error;
  const signedOut = session?.user === null && !localPreview;
  const userId = session?.user?.id;
  const storageKey = loaded && (localPreview || userId !== undefined)
    ? draftKey(loaded.path, localPreview ? undefined : userId)
    : undefined;
  const busy = saving || discarding || loggingOut || uploads > 0;

  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  useLayoutEffect(() => {
    const modal = dialog.current!;
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const imageUrls = localImages.current;
    modal.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      modal.close();
      for (const url of imageUrls.values()) URL.revokeObjectURL(url);
      imageUrls.clear();
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/session', { signal: controller.signal }).then(payload).then(setSession)
      .catch(() => { if (!controller.signal.aborted) setError('Could not check GitHub sign-in. Reopen the editor to retry.'); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!endpoint || userId === undefined || localPreview) return;
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal }).then(payload).then((current: Loaded) => {
      if (controller.signal.aborted) return;
      const key = draftKey(current.path, userId);
      const legacyKey = draftKey(current.path);
      const savedDraft = restore(key);
      const previous = savedDraft ?? restore(legacyKey);
      if (!savedDraft && previous && storeDraft(key, previous)) removeDraft(legacyKey);
      setLoaded(current);
      setBase(previous?.base ?? current);
      setMetadata(previous?.draft ?? current.document);
      setSource(previous?.sourceVersion === SOURCE_VERSION && previous.source !== undefined ? previous.source : writeProseSource(previous?.draft ?? current.document));
      if (previous && previous.base.revision !== current.revision) {
        setLatest(current);
        setResolving(true);
      }
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [endpoint, userId, localPreview]);

  useEffect(() => {
    if (!storageKey || !base || !draft) return;
    if (dirty) storeDraft(storageKey, { base, draft, source, sourceVersion: SOURCE_VERSION });
    else removeDraft(storageKey);
  }, [storageKey, base, draft, dirty, source]);

  useEffect(() => {
    if (signedOut) login.current?.focus({ preventScroll: true });
  }, [signedOut]);

  const revision = base?.revision;
  useEffect(() => {
    if (!endpoint || revision === undefined || saving || discarding || loggingOut || latest || localPreview) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      fetch(endpoint, { signal: controller.signal }).then(payload).then((current: Snapshot) => {
        if (controller.signal.aborted || current.revision === revision) return;
        setLatest(current);
        setResolving(true);
      }).catch(() => { /* Save checks the authoritative revision again. */ });
    }, 60_000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [endpoint, revision, saving, discarding, loggingOut, latest, localPreview]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function discard() {
    if (busy) return;
    if (loaded) {
      setDiscarding(true);
      let prompt: string | undefined;
      try {
        const url = localPreview ? `/api/prose?${query}` : endpoint;
        const current = await payload(await fetch(url, { cache: 'no-store' }));
        const document: ProseDocument = localPreview ? current.general ?? { version: 1, sections: [] } : current.document;
        if (source !== writeProseSource(document)) prompt = 'Discard this draft?';
      } catch {
        prompt = 'Could not check the latest saved prose. Discard this draft anyway?';
      } finally {
        setDiscarding(false);
      }
      if (!dialog.current?.open || (prompt && !window.confirm(prompt))) return;
    }
    if (storageKey) removeDraft(storageKey);
    onClose();
  }

  function openLocal() {
    const path = 'localhost:' + query + ':general';
    const current: Loaded = { path, revision: null, document: pageProse.general ?? { version: 1, sections: [] }, wikiImages: pageProse.wikiImages };
    const previous = restore(draftKey(path));
    setLoaded(current);
    setBase(previous?.base ?? current);
    setMetadata(previous?.draft ?? current.document);
    setSource(previous?.sourceVersion === SOURCE_VERSION && previous.source !== undefined ? previous.source : writeProseSource(previous?.draft ?? current.document));
  }

  async function upload(file: File): Promise<ImageReference> {
    if (file.size > PROSE_IMAGE_MAX_BYTES) throw new Error('Images must be 2 MiB or smaller');
    setUploads((count) => count + 1);
    try {
      if (localPreview) {
        const extension = (Object.keys(PROSE_IMAGE_TYPES) as (keyof typeof PROSE_IMAGE_TYPES)[])
          .find((type) => PROSE_IMAGE_TYPES[type] === file.type);
        if (!extension) throw new Error('Choose a PNG, JPEG, or WebP image');
        const image = await createImageBitmap(file).catch(() => { throw new Error('Choose a readable image'); });
        const exceedsDimensions = Math.max(image.width, image.height) > PROSE_IMAGE_MAX_DIMENSION;
        image.close();
        if (exceedsDimensions) throw new Error('Images must be at most 4096 pixels wide and tall');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const icon = await existingWikiIcon(bytes, extension, (path) => fetch(path));
        if (icon) return { kind: 'icon', key: icon };
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        const key = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('') + '.' + extension;
        if (!localImages.current.has(key)) localImages.current.set(key, URL.createObjectURL(file));
        return { kind: 'upload', key };
      }
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
    if (busy || latest || localPreview || !draft || parsed?.error || !base || !loaded) return;
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
        setResolving(true);
        return;
      }
      setBase(result);
      setMetadata(result.document);
      setSource(writeProseSource(result.document));
      if (storageKey) removeDraft(storageKey);
      onSave(result.document);
      setStatus('Saved.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    if (busy || !session?.user || !session.csrf) return;
    const kept = !dirty || (storageKey && base && draft && storeDraft(storageKey, {
      base, draft, source, sourceVersion: SOURCE_VERSION,
    }));
    const prompt = !dirty ? 'Log out of the wiki?' : kept
      ? 'Log out of the wiki? Your draft will be kept on this device.'
      : 'Log out and discard this unsaved draft?';
    if (!window.confirm(prompt)) return;

    setLoggingOut(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Wiki-CSRF': session.csrf } });
      if (response.status === 403) {
        const current: EditorSession = await payload(await fetch('/api/auth/session'));
        if (current.user) throw new Error('Could not log out. Please try again.');
      } else if (!response.ok) {
        throw new Error('Could not log out. Please try again.');
      }
      setSession({ user: null, development: session.development });
      setLoaded(undefined);
      setBase(undefined);
      setMetadata(undefined);
      setSource('');
      setLatest(undefined);
      setResolving(false);
      setTab('source');
      setPreviewBuild('');
      setStatus('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not log out. Please try again.');
    } finally {
      setLoggingOut(false);
    }
  }

  const merge = useMemo(() => showingConflicts && base && draft && latest
    ? planProseMerge(base.document, draft, latest.document) : undefined, [showingConflicts, base, draft, latest]);

  function applyResolution(merged: ProseDocument) {
    if (!latest) return;
    setMetadata(merged);
    setSource(writeProseSource(merged));
    setBase(latest);
    setLatest(undefined);
    setResolving(false);
  }

  const returnUrl = new URL(window.location.href);
  returnUrl.searchParams.set('edit-prose', '1');
  returnUrl.searchParams.delete('prose-scope');
  returnUrl.searchParams.delete('prose-section-scope');
  if (sectionId) returnUrl.searchParams.set('prose-section', sectionId);
  else returnUrl.searchParams.delete('prose-section');
  const returnTo = returnUrl.pathname + returnUrl.search + returnUrl.hash;
  return (
    <dialog className="prose-editor" data-panes={!!loaded && !!draft && !showingConflicts} ref={dialog} aria-labelledby="prose-editor-title" onCancel={(event) => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      discard();
    }}>
      <header className="prose-editor-actions prose-editor-header">
        <h2 id="prose-editor-title">Edit prose: {name}</h2>
        <button className="prose-save-button" type="button" onClick={save}
          disabled={localPreview || !draft || !!parsed?.error || !base || busy || !!latest}>
          {latest ? 'Resolve conflicts' : saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={discard} disabled={busy}>{discarding ? 'Checking latest prose…' : 'Discard'}</button>
      </header>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {session?.user && (
        <div className="prose-editor-actions prose-account">
          <p>Signed in with GitHub as <strong>@{session.user.login}</strong></p>
          <button type="button" onClick={logout} disabled={busy}>{loggingOut ? 'Logging out…' : 'Log out'}</button>
        </div>
      )}
      {signedOut && (
        <section className="prose-sign-in">
          <p>You need a GitHub account to edit this wiki.</p>
          <div className="prose-editor-actions">
            <a className="prose-button prose-github-login" ref={login} aria-label="Login with GitHub" href={`/api/auth/login?${new URLSearchParams({ returnTo })}`}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                <path d="M12 .75a11.25 11.25 0 0 0-3.557 21.923c.562.104.768-.244.768-.542 0-.267-.01-.975-.015-1.914-3.13.68-3.79-1.508-3.79-1.508-.512-1.301-1.25-1.647-1.25-1.647-1.022-.699.077-.685.077-.685 1.13.08 1.725 1.16 1.725 1.16 1.005 1.722 2.637 1.224 3.28.936.102-.728.393-1.224.714-1.506-2.498-.284-5.124-1.249-5.124-5.561 0-1.229.44-2.233 1.16-3.02-.116-.285-.503-1.43.11-2.98 0 0 .946-.303 3.094 1.153A10.78 10.78 0 0 1 12 6.18c.956.005 1.92.129 2.82.379 2.147-1.456 3.092-1.153 3.092-1.153.614 1.55.227 2.695.111 2.98.722.787 1.159 1.791 1.159 3.02 0 4.323-2.63 5.274-5.137 5.553.404.35.765 1.039.765 2.095 0 1.512-.014 2.732-.014 3.104 0 .301.203.651.774.541A11.25 11.25 0 0 0 12 .75Z" />
              </svg>
              Login
            </a>
            <a className="prose-button prose-github-register" href="https://github.com/signup" target="_blank"
              rel="noopener noreferrer" aria-label="Register for a GitHub account">Register</a>
            {loopback && !session?.development && <button type="button" onClick={() => {
              setLocalPreview(true);
              openLocal();
            }}>Open local editor preview</button>}
          </div>
        </section>
      )}
      {!session && !error && <p role="status">Checking sign-in…</p>}
      {session?.user && !loaded && !error && <p role="status">Loading latest prose…</p>}
      {loaded && draft && (
        <>
          {!showingConflicts && <p className="prose-scope-note">Content outside build-specific and ID-specific blocks applies to all builds and all IDs on this page.</p>}
          {latest && !showingConflicts && <p role="status">This document changed while you were editing.</p>}
          {merge ? (
            <ProseConflictResolver decisions={merge.decisions} merge={merge.apply}
              context={{ build, builds: manifest ?? [], wikiImages: loaded.wikiImages }} busy={busy} onApply={applyResolution} />
          ) : (
            <>
              <div className="prose-editor-tabs" role="tablist" aria-label="Editor view">
                {(['source', 'preview'] as const).map((pane) => (
                  <button key={pane} id={`prose-tab-${pane}`} type="button" role="tab" aria-selected={tab === pane}
                    aria-controls={`prose-panel-${pane}`} tabIndex={tab === pane ? 0 : -1} onClick={() => setTab(pane)}
                    onKeyDown={(event) => {
                      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                      event.preventDefault();
                      const next = event.key === 'Home' ? 'source' : event.key === 'End' ? 'preview' : pane === 'source' ? 'preview' : 'source';
                      setTab(next);
                      dialog.current?.querySelector<HTMLButtonElement>(`#prose-tab-${next}`)?.focus();
                    }}>
                    {pane === 'source' ? 'Source' : 'Preview'}
                  </button>
                ))}
              </div>
              <div className="prose-editor-panes">
                <section className="prose-editor-source" role="tabpanel" id="prose-panel-source" aria-labelledby="prose-tab-source" hidden={tab !== 'source'}>
                  <ProseSourceEditor
                    source={source}
                    sectionId={sectionId}
                    onChange={setSource}
                    builds={manifest ?? []}
                    entityId={entityId}
                    upload={upload}
                    disabled={busy}
                    error={parsed?.error}
                  />
                </section>
                <section className="prose-editor-preview" role="tabpanel" id="prose-panel-preview" aria-labelledby="prose-tab-preview" hidden={tab !== 'preview'}>
                  <label className="prose-preview-build">
                    Preview build
                    <select className="styled-select" value={selectedPreviewBuild} onChange={(event) => setPreviewBuild(event.target.value)}>
                      <option value="">Any build</option>
                      {scopedBuilds.map((slug) => <option value={slug} key={slug}>{manifest?.find((entry) => entry.slug === slug)?.displayName ?? slug}</option>)}
                    </select>
                  </label>
                  {scopedIds.length > 0 && (
                    <label className="prose-preview-build">
                      Preview ID
                      <select className="styled-select" value={scopedIds.includes(previewId) ? previewId : ''} onChange={(event) => setPreviewId(event.target.value)}>
                        <option value="">Any ID</option>
                        {scopedIds.map((id) => <option key={id}>{id}</option>)}
                      </select>
                    </label>
                  )}
                  <div className="prose-preview-scroll">
                    {tab === 'preview' && (
                      <ProsePreview document={draft} entityId={scopedIds.includes(previewId) ? previewId : undefined} build={selectedPreviewBuild || undefined} linkBuild={selectedPreviewBuild || build} wikiImages={loaded.wikiImages} localImages={localPreview ? localImages.current : undefined} preview />
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
        </>
      )}
    </dialog>
  );
}
