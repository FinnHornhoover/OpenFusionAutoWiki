import type { MissionTask, Ref } from '../data/types';
import { missionJournal } from '../data/missionJournal';
import JournalPanel from './JournalPanel';

export default function MissionJournal({ tasks, mode, speaker }: { tasks: MissionTask[]; mode: 'offer' | 'completion'; speaker?: Ref | null }) {
  const journal = missionJournal(tasks);
  if (mode === 'offer') {
    if (!journal.summary && !journal.offer) return null;
    return (
      <JournalPanel title="Mission offer" summary={journal.summary} speaker={speaker}>
        {journal.offer && <p>{journal.offer}</p>}
      </JournalPanel>
    );
  }
  const summary = journal.completedListSummary !== journal.summary ? journal.completedListSummary : '';
  if (!journal.turnIn && !journal.completed && !summary) return null;
  return (
    <div className="mission-journal">
      {journal.turnIn && (
        <JournalPanel title="Mission summary" speaker={speaker}>
          <p>{journal.turnIn}</p>
        </JournalPanel>
      )}
      {(journal.completed || summary) && (
        <JournalPanel title="My notes" summary={summary}>
          {journal.completed && <p>{journal.completed}</p>}
        </JournalPanel>
      )}
    </div>
  );
}
