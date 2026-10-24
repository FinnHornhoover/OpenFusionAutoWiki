import type { ReactNode } from 'react';
import type { Ref } from '../data/types';
import EntityLink from './EntityLink';

export default function JournalPanel({ title, summary, speaker, children }: {
  title: string;
  summary?: string;
  speaker?: Ref | null;
  children: ReactNode;
}) {
  return (
    <section className="journal-panel" aria-label={title}>
      <header className="journal-panel-heading"><h4>{title}</h4></header>
      <div className={`journal-panel-body${speaker ? ' journal-panel-with-speaker' : ''}`}>
        {speaker && <div className="journal-panel-speaker"><EntityLink entity={speaker} iconSize={96} /></div>}
        <div className="journal-panel-copy">
          {summary && <p className="journal-panel-summary">{summary}</p>}
          {children}
        </div>
      </div>
    </section>
  );
}
