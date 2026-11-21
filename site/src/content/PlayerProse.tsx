import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Dropdown from '../components/Dropdown';
import { useRouteMap } from '../data/routeMap';
import { proseSectionDate, sectionsForBuild, type PageProse, type ProseBlock, type ProseDocument, type ProseSection } from './document';

import { PROSE_IMAGE_KEY, WIKI_ICON_KEY } from './images';

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

function ProseMarkdown({ build, source }: { build?: string; source: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      disallowedElements={['img', 'input']}
      urlTransform={(url) => (url.startsWith(WIKI_PREFIX) || url.startsWith(BUILD_LINK_PREFIX)) ? url : defaultUrlTransform(url)}
      components={{
        h1: ({ children }) => <h2>{children}</h2>,
        h2: ({ children }) => <h3>{children}</h3>,
        h3: ({ children }) => <h4>{children}</h4>,
        h4: ({ children }) => <h5>{children}</h5>,
        h5: ({ children }) => <h6>{children}</h6>,
        a: ({ href, children }) => {
          if (href?.startsWith(BUILD_LINK_PREFIX)) {
            const path = href.slice(BUILD_LINK_PREFIX.length);
            return build && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')
              ? <Link to={`/${build}${path === '/' ? '' : path}`}>{children}</Link>
              : <>{children}</>;
          }
          if (href?.startsWith(WIKI_PREFIX)) return <WikiLink build={build} target={href.slice(WIKI_PREFIX.length)}>{children}</WikiLink>;
          return href ? <a href={href} rel="noopener noreferrer ugc">{children}</a> : <>{children}</>;
        },
        table: ({ children }) => <div className="table-scroll" tabIndex={0}><table className="prose-table">{children}</table></div>,
      }}
    >
      {source}
    </Markdown>
  );
}

const subsectionHeadings = ['h3', 'h4', 'h5', 'h6'] as const;

export function ProseBlockContent({ block, build, wikiImages, localImages }: {
  block: Exclude<ProseBlock, { kind: 'scope' }>;
  build?: string;
  wikiImages?: PageProse['wikiImages'];
  localImages?: ReadonlyMap<string, string>;
}) {
  if (block.kind === 'markdown') return <ProseMarkdown build={build} source={block.source} />;
  const local = block.image.kind === 'upload' ? localImages?.get(block.image.key) : undefined;
  const src = local ?? (block.image.kind === 'upload'
    ? PROSE_IMAGE_KEY.test(block.image.key) ? `/api/prose/images/${block.image.key}` : undefined
    : block.image.kind === 'icon' ? WIKI_ICON_KEY.test(block.image.key) ? `/icons/${block.image.key}` : undefined
    : wikiImages?.[block.image.asset]);
  if (!src || (!local && (!src.startsWith('/') || src.startsWith('//') || src.includes('\\')))) return null;
  return (
    <figure>
      <div className="table-scroll" tabIndex={0}><img src={src} alt={block.alt} loading="lazy" /></div>
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>
  );
}

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
      {section.blocks.map((block) => block.kind !== 'scope' && (
        <ProseBlockContent key={block.id} block={block} build={linkBuild ?? build} wikiImages={wikiImages} localImages={localImages} />
      ))}
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

  const date = proseSectionDate(section, build);
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

export function ProsePreview({ document, build, entityId, linkBuild, wikiImages, localImages, preview, onEdit }: {
  document: ProseDocument;
  build?: string;
  entityId?: string;
  linkBuild?: string;
  wikiImages?: PageProse['wikiImages'];
  localImages?: ReadonlyMap<string, string>;
  preview?: boolean;
  onEdit?(sectionId: string): void;
}) {
  const sections = sectionsForBuild(document.sections, build, entityId);
  const contributors = document.contributors ?? (document.editedBy ? [document.editedBy] : []);
  return (
    <>
      {sections.map((section) => (
        <Section key={section.id} section={section} build={build} linkBuild={linkBuild} wikiImages={wikiImages} localImages={localImages} preview={preview} onEdit={onEdit} />
      ))}
      {!preview && sections.length > 0 && contributors.length > 0 && (
        <div className="player-prose-credits muted">
          <span>Contributors</span>
          <ul aria-label="Prose contributors">
            {contributors.map(({ id, login }) => (
              <li key={id}><a href={`https://github.com/${encodeURIComponent(login)}`}>@{login}</a></li>
            ))}
          </ul>
        </div>
      )}
    </>
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
  const proseAction = editable ? <EditIcon label="Add prose" onClick={() => setEditing({ query })} /> : null;
  const sections = prose && (prose.general || prose.specific) ? (
    <aside className="player-prose" aria-label="Player contributions">
      {prose.general && (
        <ProsePreview document={prose.general} build={build} entityId={activeId} wikiImages={prose.wikiImages}
          onEdit={editable ? (sectionId) => setEditing({ query, sectionId }) : undefined} />
      )}
      {prose.specific && <ProsePreview document={prose.specific} build={build} entityId={activeId} wikiImages={prose.wikiImages} />}
    </aside>
  ) : null;

  return (
    <>
      {children({ prose: sections, proseAction })}
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
