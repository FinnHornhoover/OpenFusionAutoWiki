import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useRouteMap } from '../data/routeMap';
import { sectionsForBuild, type PageProse, type ProseDocument, type ProseScope, type ProseSection } from './document';

import { PROSE_IMAGE_KEY } from './images';

const ProseEditor = lazy(() => import('./ProseEditor'));

const WIKI_PREFIX = 'wiki:';
const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/3.0/';

function WikiLink({ build, target, children }: { build: string; target: string; children: React.ReactNode }) {
  const match = /^([a-z-]+)\/(.+)$/.exec(target);
  const routes = useRouteMap(build, match?.[1]);
  const resolved = match && routes && Object.hasOwn(routes, match[2]) ? routes[match[2]] : undefined;
  return match && resolved ? <Link to={`/${build}/${match[1]}/${resolved.canonical}`}>{children}</Link> : <>{children}</>;
}

function ProseMarkdown({ build, source }: { build: string; source: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      disallowedElements={['img', 'input']}
      urlTransform={(url) => url.startsWith(WIKI_PREFIX) ? url : defaultUrlTransform(url)}
      components={{
        h1: ({ children }) => <h2>{children}</h2>,
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

function Section({ section, build, wikiImages, preview }: { section: ProseSection; build: string; wikiImages?: PageProse['wikiImages']; preview?: boolean }) {
  const date = section.updatedAtByBuild?.[build] ?? section.updatedAt;
  return (
    <details className="player-prose-section" open={preview || undefined}>
      <summary>{section.title} <small className="muted">Player edited · <time dateTime={date}>{date.slice(0, 10)}</time></small></summary>
      {section.blocks.map((block) => {
        if (block.kind === 'markdown') return <ProseMarkdown key={block.id} build={build} source={block.source} />;
        const src = block.image.kind === 'upload'
          ? PROSE_IMAGE_KEY.test(block.image.key) ? `/api/prose/images/${block.image.key}` : undefined
          : wikiImages?.[block.image.asset];
        if (!src || !src.startsWith('/') || src.startsWith('//') || src.includes('\\')) return null;
        return (
          <figure key={block.id}>
            <div className="table-scroll" tabIndex={0}><img src={src} alt={block.alt} loading="lazy" /></div>
            {block.caption && <figcaption>{block.caption}</figcaption>}
          </figure>
        );
      })}
      {section.sections.map((child) => <Section key={child.id} section={child} build={build} wikiImages={wikiImages} preview={preview} />)}
    </details>
  );
}

export function ProsePreview({ document, build, wikiImages, preview }: { document: ProseDocument; build: string; wikiImages?: PageProse['wikiImages']; preview?: boolean }) {
  return sectionsForBuild(document.sections, build).map((section) => (
    <Section key={section.id} section={section} build={build} wikiImages={wikiImages} preview={preview} />
  ));
}

export default function PlayerProse({ build, type, route }: { build: string; type: string; route: string }) {
  const query = new URLSearchParams({ build, type, route }).toString();
  const [result, setResult] = useState<{ query: string; prose: PageProse }>();

  const [editing, setEditing] = useState<string | undefined>(() => new URLSearchParams(window.location.search).has('edit-prose') ? query : undefined);

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
  return (
    <aside className="player-prose" aria-label="Player contributions">
      {[prose?.general, prose?.specific].map((document, index) => document?.version === 1 && (
        <div key={index} aria-label={index === 0 ? 'General prose' : 'Prose for this ID'}>
          <ProsePreview document={document} build={build} wikiImages={prose?.wikiImages} />
        </div>
      ))}
      {Boolean(prose?.scopes?.length) && <button type="button" onClick={() => setEditing(query)}>Edit prose</button>}
      {editing === query && prose?.scopes && (
        <Suspense fallback={<p>Loading editor…</p>}>
          <ProseEditor
            build={build}
            query={query}
            scopes={prose.scopes}
            onClose={() => setEditing(undefined)}
            onSave={(scope: ProseScope, document: ProseDocument) => setResult({ query, prose: { ...prose, [scope]: document } })}
          />
        </Suspense>
      )}
      <a href={LICENSE_URL} className="badge badge-category" aria-label="Player contributions license, CC BY-SA 3.0">CC BY-SA 3.0</a>
    </aside>
  );
}
