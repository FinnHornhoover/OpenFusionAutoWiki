import { useEffect, useRef, useState } from 'react';
import type { BuildEntry } from '../data/useManifest';
import type { PageProse, ProseDocument } from './document';
import { ProseBlockContent } from './PlayerProse';
import { duplicateProseContent, proseChildren, proseContentKey, proseContentLabel, type MergeChoices, type MergeDecision, type ProseContent } from './proseMerge';

interface PreviewContext {
  build: string;
  builds: BuildEntry[];
  wikiImages?: PageProse['wikiImages'];
}

function ContentPreview({ item, original, compare, context }: {
  item: ProseContent;
  original?: ProseContent;
  compare?: boolean;
  context: PreviewContext;
}) {
  const previousChildren = proseChildren(original);
  const children = proseChildren(item);
  const removed = previousChildren.filter((old) => !children.some((child) => child.id === old.id)).length;
  const changed = compare && (!original || proseContentKey(original) !== proseContentKey(item));
  const ids = 'entityIds' in item ? item.entityIds : undefined;

  return (
    <div className="prose-conflict-content">
      <div className="prose-conflict-block" data-changed={changed || undefined}>
        {'title' in item && <p className="prose-conflict-section-title">{item.title}</p>}
        {item.builds && (
          <p className="prose-conflict-scope">
            <strong>Builds</strong> {item.builds.map((slug) => context.builds.find((entry) => entry.slug === slug)?.displayName ?? slug).join(', ')}
          </p>
        )}
        {ids && <p className="prose-conflict-scope"><strong>Page IDs</strong> {ids.join(', ')}</p>}
        {'kind' in item && item.kind !== 'scope' && <ProseBlockContent block={item} build={context.build} wikiImages={context.wikiImages} />}
      </div>
      {children.length > 0 && (
        <div className="prose-conflict-children">
          {children.map((child) => (
            <ContentPreview key={child.id} item={child} original={previousChildren.find((old) => old.id === child.id)} compare={compare} context={context} />
          ))}
        </div>
      )}
      {removed > 0 && <p className="prose-conflict-removed">{removed === 1 ? '1 part removed' : `${removed} parts removed`}</p>}
    </div>
  );
}

function DecisionPreview({ version, decision, context }: {
  version: 'original' | 'yours' | 'saved';
  decision: MergeDecision;
  context: PreviewContext;
}) {
  const contents = decision.versions[version] ?? [];
  if (!contents.length) return <p className="prose-conflict-removed">No content here in this version.</p>;
  if (decision.order) return <ol>{contents.map((item) => <li key={item.id}>{proseContentLabel(item)}</li>)}</ol>;
  return contents.map((item) => (
    <ContentPreview key={item.id} item={item} original={version === 'original' ? undefined : decision.versions.original?.[0]}
      compare={version !== 'original'} context={context} />
  ));
}

export default function ProseConflictResolver({ decisions, merge, context, busy, onApply }: {
  decisions: MergeDecision[];
  merge(choices: MergeChoices): ProseDocument;
  context: PreviewContext;
  busy: boolean;
  onApply(document: ProseDocument): void;
}) {
  const [choices, setChoices] = useState<MergeChoices>(() => new Map());
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  function selectAll(side: 'yours' | 'saved') {
    setError('');
    setChoices(new Map(decisions.map(({ id }) => [id, side])));
  }

  function apply() {
    const document = merge(choices);
    const duplicate = duplicateProseContent(document);
    if (duplicate) {
      setError(`“${proseContentLabel(duplicate)}” was kept in two places. Choose which location to keep.`);
      return;
    }
    onApply(document);
  }

  return (
    <section className="prose-conflicts" aria-labelledby="prose-conflicts-title">
      <h3 id="prose-conflicts-title" tabIndex={-1} ref={heading}>Review page changes</h3>
      <p>{decisions.length
        ? 'Choose which version to keep for each change, then review the result in the editor.'
        : 'Your draft matches the latest saved prose.'}</p>
      {decisions.length > 1 && (
        <div className="prose-editor-actions">
          <button type="button" disabled={busy} onClick={() => selectAll('yours')}>Choose draft for all</button>
          <button type="button" disabled={busy} onClick={() => selectAll('saved')}>Choose saved for all</button>
        </div>
      )}
      {decisions.map((decision) => (
        <fieldset className="prose-conflict-section" key={decision.id} disabled={busy}>
          <legend>{decision.label}</legend>
          {decision.location && <p className="prose-conflict-location muted">{decision.location}</p>}
          <div className="prose-conflict-versions">
            {(['yours', 'saved'] as const).map((side) => (
              <div className="prose-conflict-version" key={side} data-selected={choices.get(decision.id) === side}>
                <label className="prose-conflict-choice">
                  <input type="radio" name={`prose-conflict-${decision.id}`} checked={choices.get(decision.id) === side}
                    onChange={() => {
                      setError('');
                      setChoices((previous) => new Map(previous).set(decision.id, side));
                    }} />
                  {side === 'yours' ? 'Use your draft' : 'Use latest saved'}
                </label>
                <div className="prose-conflict-preview player-prose-body">
                  <DecisionPreview version={side} decision={decision} context={context} />
                </div>
              </div>
            ))}
          </div>
          {decision.versions.original && (
            <details className="prose-conflict-original">
              <summary>View original version</summary>
              <div className="prose-conflict-preview player-prose-body">
                <DecisionPreview version="original" decision={decision} context={context} />
              </div>
            </details>
          )}
        </fieldset>
      ))}
      {error && <p role="alert">{error}</p>}
      <div className="prose-conflict-actions">
        {decisions.length > 0 && <span role="status">{choices.size} of {decisions.length} choices made</span>}
        <button type="button" className="prose-save-button" disabled={busy || choices.size !== decisions.length} onClick={apply}>
          {decisions.length ? 'Apply choices' : 'Return to editor'}
        </button>
      </div>
    </section>
  );
}
