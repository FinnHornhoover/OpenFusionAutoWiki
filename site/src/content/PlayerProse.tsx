import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useRouteMap } from '../data/routeMap';
import { proseSectionDate, proseSectionEditor, sectionsForBuild, type PageProse, type ProseBlock, type ProseContributor, type ProseDocument, type ProseSection } from './document';

import { PROSE_IMAGE_KEY, WIKI_ICON_KEY } from './images';
import ProseImage from './ProseImage';

const ProseEditor = lazy(() => import('./ProseEditor'));

const WIKI_PREFIX = 'wiki:';
const BUILD_LINK_PREFIX = 'wiki-build:';

interface EditorTarget {
  query: string;
  sectionId?: string;
}

function editorReturnTarget(query: string, params: URLSearchParams): EditorTarget | undefined {
  if (!params.has('edit-prose')) return undefined;
  const sectionId = params.get('prose-section') ?? undefined;
  return { query, sectionId: params.get('prose-section-scope') === 'specific' ? undefined : sectionId };
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

const sectionHeadings = ['h2', 'h3', 'h4', 'h5', 'h6'] as const;

function ProseHeading({ children, depth, section, build, editor }: {
  children: ReactNode;
  depth: number;
  section?: ProseSection;
  build?: string;
  editor?: ProseContributor;
}) {
  const Heading = sectionHeadings[Math.min(depth, sectionHeadings.length - 1)];
  const date = section && proseSectionDate(section, build);
  const author = section ? proseSectionEditor(section, build, editor) : editor;
  const formattedDate = date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString().slice(0, 16).replace('T', ' ') : undefined;
  return (
    <header className="player-prose-heading">
      <Heading>{children}</Heading>
      <div className="player-prose-edited muted">
        {formattedDate && <span>Edited <time dateTime={date} title="UTC">{formattedDate}</time></span>}
        {author && <span>by <a href={`https://github.com/${encodeURIComponent(author.login)}`}>@{author.login}</a></span>}
      </div>
    </header>
  );
}

function ProseMarkdown({ build, linkBuild = build, source, section, editor }: {
  build?: string;
  linkBuild?: string;
  source: string;
  section?: ProseSection;
  editor?: ProseContributor;
}) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      disallowedElements={['img', 'input']}
      urlTransform={(url) => (url.startsWith(WIKI_PREFIX) || url.startsWith(BUILD_LINK_PREFIX)) ? url : defaultUrlTransform(url)}
      components={{
        h1: ({ children }) => <ProseHeading depth={0} section={section} build={build} editor={editor}>{children}</ProseHeading>,
        h2: ({ children }) => <ProseHeading depth={1} section={section} build={build} editor={editor}>{children}</ProseHeading>,
        h3: ({ children }) => <ProseHeading depth={2} section={section} build={build} editor={editor}>{children}</ProseHeading>,
        h4: ({ children }) => <ProseHeading depth={3} section={section} build={build} editor={editor}>{children}</ProseHeading>,
        h5: ({ children }) => <ProseHeading depth={4} section={section} build={build} editor={editor}>{children}</ProseHeading>,
        h6: ({ children }) => <ProseHeading depth={4} section={section} build={build} editor={editor}>{children}</ProseHeading>,
        blockquote: ({ children }) => <blockquote className="prose-quote">{children}</blockquote>,
        a: ({ href, children }) => {
          if (href?.startsWith(BUILD_LINK_PREFIX)) {
            const path = href.slice(BUILD_LINK_PREFIX.length);
            return linkBuild && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')
              ? <Link to={`/${linkBuild}${path === '/' ? '' : path}`}>{children}</Link>
              : <>{children}</>;
          }
          if (href?.startsWith(WIKI_PREFIX)) return <WikiLink build={linkBuild} target={href.slice(WIKI_PREFIX.length)}>{children}</WikiLink>;
          return href ? <a href={href} rel="noopener noreferrer ugc">{children}</a> : <>{children}</>;
        },
        table: ({ children }) => <div className="table-scroll" tabIndex={0}><table className="prose-table">{children}</table></div>,
      }}
    >
      {source}
    </Markdown>
  );
}

export function ProseBlockContent({ block, build, linkBuild, wikiImages, localImages, section, editor }: {
  block: Exclude<ProseBlock, { kind: 'scope' }>;
  build?: string;
  linkBuild?: string;
  wikiImages?: PageProse['wikiImages'];
  localImages?: ReadonlyMap<string, string>;
  section?: ProseSection;
  editor?: ProseContributor;
}) {
  if (block.kind === 'markdown') return <ProseMarkdown build={build} linkBuild={linkBuild} source={block.source} section={section} editor={editor} />;
  const local = block.image.kind === 'upload' ? localImages?.get(block.image.key) : undefined;
  const src = local ?? (block.image.kind === 'upload'
    ? PROSE_IMAGE_KEY.test(block.image.key) ? `/api/prose/images/${block.image.key}` : undefined
    : block.image.kind === 'icon' ? WIKI_ICON_KEY.test(block.image.key) ? `/icons/${block.image.key}` : undefined
    : wikiImages?.[block.image.asset]);
  if (!src || (!local && (!src.startsWith('/') || src.startsWith('//') || src.includes('\\')))) return null;
  return <ProseImage src={src} alt={block.alt} caption={block.caption} />;
}

function Section({ section, build, linkBuild, wikiImages, localImages, editor, depth = 0 }: {
  section: ProseSection;
  build?: string;
  linkBuild?: string;
  wikiImages?: PageProse['wikiImages'];
  localImages?: ReadonlyMap<string, string>;
  editor?: ProseContributor;
  depth?: number;
}) {
  return (
    <section className="player-prose-section" data-depth={depth}>
      <ProseHeading depth={depth} section={section} build={build} editor={editor}>{section.title}</ProseHeading>
      {section.blocks.map((block) => block.kind !== 'scope' && (
        <ProseBlockContent key={block.id} block={block} build={build} linkBuild={linkBuild} wikiImages={wikiImages} localImages={localImages} section={section} editor={editor} />
      ))}
      {section.sections.map((child) => <Section key={child.id} section={child} build={build} linkBuild={linkBuild} wikiImages={wikiImages} localImages={localImages} editor={editor} depth={depth + 1} />)}
    </section>
  );
}

export function ProsePreview({ document, additionalDocument, build, entityId, linkBuild, wikiImages, localImages, preview, onEdit }: {
  document: ProseDocument;
  additionalDocument?: ProseDocument;
  build?: string;
  entityId?: string;
  linkBuild?: string;
  wikiImages?: PageProse['wikiImages'];
  localImages?: ReadonlyMap<string, string>;
  preview?: boolean;
  onEdit?(): void;
}) {
  const documents = additionalDocument ? [document, additionalDocument] : [document];
  const sections = documents.flatMap((doc, index) => sectionsForBuild(doc.sections, build, entityId)
    .map((section) => ({ section, editor: doc.editedBy, key: `${index}-${section.id}` })));
  const contributors = [...new Map(documents.flatMap((doc) => doc.contributors ?? (doc.editedBy ? [doc.editedBy] : []))
    .map((contributor) => [contributor.id, contributor])).values()];
  const showCredits = !preview && sections.length > 0 && contributors.length > 0;
  if (!sections.length && !onEdit) return null;
  return (
    <div className="player-prose-body">
      {(onEdit || showCredits) && (
        <div className="player-prose-toolbar">
          {!preview && sections.length === 0 && (
            <div className="player-prose-credits muted">Contribute to this Wiki page.</div>
          )}
          {showCredits && (
            <div className="player-prose-credits muted">
              <span>Contributors</span>
              <ul aria-label="Prose contributors">
                {contributors.map(({ id, login }) => (
                  <li key={id}><a href={`https://github.com/${encodeURIComponent(login)}`}>@{login}</a></li>
                ))}
              </ul>
            </div>
          )}
          {onEdit && <EditIcon onClick={onEdit} />}
        </div>
      )}
      {sections.map(({ section, editor, key }) => (
        <Section key={key} section={section} build={build} linkBuild={linkBuild} wikiImages={wikiImages} localImages={localImages} editor={editor} />
      ))}
    </div>
  );
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
  const editable = prose?.scopes?.includes('general');
  const activeId = prose?.entityId ?? (prose?.scopes?.includes('specific') ? entityId : undefined);
  const sections = prose && (editable || prose.general || prose.specific) ? (
    <aside className="player-prose" aria-label="Player contributions">
      <ProsePreview document={prose.general ?? prose.specific ?? { version: 1, sections: [] }}
        additionalDocument={prose.general ? prose.specific : undefined} build={build} entityId={activeId} wikiImages={prose.wikiImages}
        onEdit={editable ? () => setEditing({ query }) : undefined} />
    </aside>
  ) : null;

  return (
    <>
      {children({ prose: sections, proseAction: null })}
      {editing?.query === query && editable && prose && (
        <Suspense fallback={<p>Loading editor…</p>}>
          <ProseEditor
            build={build}
            query={query}
            sectionId={editing.sectionId}
            name={name}
            entityId={activeId}
            pageProse={prose}
            onClose={() => setEditing(undefined)}
            onSave={(document: ProseDocument) => setResult({ query, prose: { ...prose, general: document } })}
          />
        </Suspense>
      )}
    </>
  );
}
