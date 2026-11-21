import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Dropdown from '../components/Dropdown';
import { useRouteMap } from '../data/routeMap';
import { sectionsForBuild, type PageProse, type ProseDocument, type ProseScope, type ProseSection } from './document';

import { PROSE_IMAGE_KEY } from './images';

const ProseEditor = lazy(() => import('./ProseEditor'));

const WIKI_PREFIX = 'wiki:';

const proseScopes = ['general', 'specific'] as const;

interface EditorTarget {
  query: string;
  scope?: ProseScope;
  section?: { id: string; scope: ProseScope };
}

function editorReturnTarget(query: string, params: URLSearchParams): EditorTarget | undefined {
  if (!params.has('edit-prose')) return undefined;
  const scope = params.get('prose-scope');
  const sectionId = params.get('prose-section');
  const sectionScope = params.get('prose-section-scope') ?? scope;
  return {
    query,
    scope: scope === 'general' || scope === 'specific' ? scope : undefined,
    section: sectionId && (sectionScope === 'general' || sectionScope === 'specific')
      ? { id: sectionId, scope: sectionScope }
      : undefined,
  };
}

function EditIcon({ label = 'Edit prose', onClick }: { label?: string; onClick(): void }) {
  return (
    <button type="button" className="prose-button prose-edit-icon" title={label} aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m14.5 5.5 4 4M4 20l4.5-1 12-12a2.8 2.8 0 0 0-4-4l-12 12L4 20Z" />
      </svg>
    </button>
  );
}

function WikiLink({ build, target, children }: { build?: string; target: string; children: React.ReactNode }) {
  const match = /^([a-z-]+)\/(.+)$/.exec(target);
  const routes = useRouteMap(build, match?.[1]);
  const resolved = build && match && routes && Object.hasOwn(routes, match[2]) ? routes[match[2]] : undefined;
  return match && resolved ? <Link to={`/${build}/${match[1]}/${resolved.canonical}`}>{children}</Link> : <>{children}</>;
}

function ProseMarkdown({ build, source }: { build?: string; source: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      disallowedElements={['img', 'input']}
      urlTransform={(url) => url.startsWith(WIKI_PREFIX) ? url : defaultUrlTransform(url)}
      components={{
        h1: ({ children }) => <h2>{children}</h2>,
        h2: ({ children }) => <h3>{children}</h3>,
        h3: ({ children }) => <h4>{children}</h4>,
        h4: ({ children }) => <h5>{children}</h5>,
        h5: ({ children }) => <h6>{children}</h6>,
        a: ({ href, children }) => href?.startsWith(WIKI_PREFIX)
          ? <WikiLink build={build} target={href.slice(WIKI_PREFIX.length)}>{children}</WikiLink>
          : href ? <a href={href} rel="noopener noreferrer ugc">{children}</a> : <>{children}</>,
        table: ({ children }) => <div className="table-scroll" tabIndex={0}><table>{children}</table></div>,
      }}
    >
      {source}
    </Markdown>
  );
}

const subsectionHeadings = ['h3', 'h4', 'h5', 'h6'] as const;

function Section({ section, build, linkBuild, wikiImages, localImages, preview, onEdit, depth = 0 }: {
  section: ProseSection;
  build?: string;
  linkBuild?: string;
  wikiImages?: PageProse['wikiImages'];
  localImages?: ReadonlyMap<string, string>;
  preview?: boolean;
  onEdit?(sectionId: string): void;
  depth?: number;
}) {
  const body = (
    <>
      {section.blocks.map((block) => {
        if (block.kind === 'markdown') return <ProseMarkdown key={block.id} build={linkBuild ?? build} source={block.source} />;
        if (block.kind === 'scope') return null;
        const local = block.image.kind === 'upload' ? localImages?.get(block.image.key) : undefined;
        const src = local ?? (block.image.kind === 'upload'
          ? PROSE_IMAGE_KEY.test(block.image.key) ? `/api/prose/images/${block.image.key}` : undefined
          : wikiImages?.[block.image.asset]);
        if (!src || (!local && (!src.startsWith('/') || src.startsWith('//') || src.includes('\\')))) return null;
        return (
          <figure key={block.id}>
            <div className="table-scroll" tabIndex={0}><img src={src} alt={block.alt} loading="lazy" /></div>
            {block.caption && <figcaption>{block.caption}</figcaption>}
          </figure>
        );
      })}
      {section.sections.map((child) => <Section key={child.id} section={child} build={build} linkBuild={linkBuild} wikiImages={wikiImages} localImages={localImages} preview={preview} depth={depth + 1} />)}
    </>
  );

  if (depth > 0) {
    const Heading = subsectionHeadings[Math.min(depth - 1, subsectionHeadings.length - 1)];
    return (
      <section className="player-prose-subsection" data-depth={depth}>
        <Heading>{section.title}</Heading>
        {body}
      </section>
    );
  }

  const date = (build ? section.updatedAtByBuild?.[build] : undefined) ?? section.updatedAt;
  const dropdown = (
    <Dropdown className="player-prose-section" open={preview} summary={
      <h2>{section.title} <small className="muted">Last edited <time dateTime={date}>{date.slice(0, 10)}</time></small></h2>
    }>
      <div className="player-prose-body">{body}</div>
    </Dropdown>
  );

  return onEdit ? (
    <div className="player-prose-row">
      {dropdown}
      <EditIcon onClick={() => onEdit(section.id)} />
    </div>
  ) : dropdown;
}

export function ProsePreview({ document, build, linkBuild, wikiImages, localImages, preview, onEdit }: {
  document: ProseDocument;
  build?: string;
  linkBuild?: string;
  wikiImages?: PageProse['wikiImages'];
  localImages?: ReadonlyMap<string, string>;
  preview?: boolean;
  onEdit?(sectionId: string): void;
}) {
  return sectionsForBuild(document.sections, build).map((section) => (
    <Section key={section.id} section={section} build={build} linkBuild={linkBuild} wikiImages={wikiImages} localImages={localImages} preview={preview} onEdit={onEdit} />
  ));
}

export interface PlayerProseSlots {
  prose: ReactNode;
  proseAction: ReactNode;
}

export default function PlayerProse({ build, type, route, name, entityId, children }: {
  build: string;
  type: string;
  route: string;
  name: string;
  entityId?: string;
  children(slots: PlayerProseSlots): ReactNode;
}) {
  const query = new URLSearchParams({ build, type, route }).toString();
  const [result, setResult] = useState<{ query: string; prose: PageProse }>();

  const [editing, setEditing] = useState<EditorTarget>();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const target = editorReturnTarget(query, params);
    if (!target) return;

    setEditing(target);
    for (const key of ['edit-prose', 'prose-scope', 'prose-section', 'prose-section-scope']) params.delete(key);
    navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, {
      replace: true,
      state: location.state,
    });
  }, [location, navigate, query]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/prose?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
        const prose: PageProse = await response.json();
        if (!controller.signal.aborted) setResult({ query, prose });
      })
      .catch(() => {
        // Generated entity content remains available if prose cannot load.
      });
    return () => controller.abort();
  }, [query]);

  const prose = result?.query === query ? result.prose : undefined;
  const scopes = prose?.scopes ?? [];
  const visibleDocuments = proseScopes.flatMap((scope) => {
    const document = prose?.[scope];
    return document?.version === 1 && sectionsForBuild(document.sections, build).length ? [{ scope, document }] : [];
  });
  const proseAction = scopes.length > 0
    ? <EditIcon label="Add prose" onClick={() => setEditing({ query })} />
    : null;
  const sections = visibleDocuments.length > 0 ? (
    <aside className="player-prose" aria-label="Player contributions">
      {visibleDocuments.map(({ scope, document }) => (
        <div key={scope} aria-label={scope === 'general' ? 'General prose' : 'Prose for this ID'}>
          <ProsePreview document={document} build={build} wikiImages={prose?.wikiImages}
            onEdit={scopes.includes(scope) ? (sectionId) => setEditing({ query, section: { id: sectionId, scope } }) : undefined} />
        </div>
      ))}
    </aside>
  ) : null;

  return (
    <>
      {children({ prose: sections, proseAction })}
      {editing?.query === query && prose?.scopes && (
        <Suspense fallback={<p>Loading editor…</p>}>
          <ProseEditor
            build={build}
            query={query}
            scopes={prose.scopes}
            initialScope={editing.scope}
            section={editing.section}
            name={name}
            entityId={entityId ?? route}
            pageProse={prose}
            onClose={() => setEditing(undefined)}
            onSave={(scope: ProseScope, document: ProseDocument) => setResult({ query, prose: { ...prose, [scope]: document } })}
          />
        </Suspense>
      )}
    </>
  );
}
