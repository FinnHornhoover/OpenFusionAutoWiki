import type { GuideEmail, MissionTask } from '../data/types';
import JournalPanel from './JournalPanel';

export default function MissionOfferEmails({ tasks }: { tasks: MissionTask[] }) {
  const emails = new Map<string, GuideEmail>();
  for (const task of tasks) {
    if (task.state === 'UnreachableTask') continue;
    for (const email of task.guideEmails) {
      const sender = email.senderRef ? `${email.senderRef.type}:${email.senderRef.id}` : email.sender.trim().toLowerCase();
      const key = JSON.stringify([sender, email.body]);
      if (!emails.has(key)) emails.set(key, email);
    }
  }
  return (
    <>
      {Array.from(emails, ([key, email]) => (
        <JournalPanel key={key} title="Mission offer email" summary="Email" speaker={email.senderRef}>
          {!email.senderRef && <p className="journal-panel-summary">From {email.sender || 'Unknown'}</p>}
          <p>{email.body}</p>
        </JournalPanel>
      ))}
    </>
  );
}
