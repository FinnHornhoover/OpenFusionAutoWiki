import type { GuideEmail, MissionTask, TaskMessage } from '../data/types';
import Dropdown from './Dropdown';
import EntityLink from './EntityLink';
import MapSpot from './MapSpot';

function formatTimeLimit(seconds: number): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function MessageSection({ label, msg }: { label: string; msg: TaskMessage | null }) {
  if (!msg) return null;
  const j = msg.journal;
  const hasJournal = j.detailedMission || j.detailedTask || j.missionSummary || j.missionCompleteSummary;
  if (!msg.text && !msg.sender && !msg.bubble && !hasJournal) return null;
  return (
    <div className="task-message">
      <h4>{label}</h4>
      {msg.sender && <p>From <EntityLink entity={msg.sender} /></p>}
      {msg.text && <blockquote>{msg.text}</blockquote>}
      {msg.bubble && (msg.bubble.sender || msg.bubble.text) && (
        <p className="dialog-bubble">
          {msg.bubble.sender && <EntityLink entity={msg.bubble.sender} withIcon={false} />}
          {msg.bubble.sender && msg.bubble.text && ': '}
          {msg.bubble.text && <em>"{msg.bubble.text}"</em>}
        </p>
      )}
      {hasJournal && (
        <table className="task-journal-text">
          <tbody>
            {j.detailedMission && <tr><th scope="row">Mission detail</th><td>{j.detailedMission}</td></tr>}
            {j.detailedTask && <tr><th scope="row">Task detail</th><td>{j.detailedTask}</td></tr>}
            {j.missionSummary && <tr><th scope="row">Summary</th><td>{j.missionSummary}</td></tr>}
            {j.missionCompleteSummary && <tr><th scope="row">On complete</th><td>{j.missionCompleteSummary}</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

function GuideEmailsSection({ emails }: { emails: GuideEmail[] }) {
  if (!emails.length) return null;
  return (
    <div className="guide-emails">
      <h4>Guide email{emails.length === 1 ? '' : 's'}</h4>
      {emails.map((e, i) => (
        <article key={i} className="guide-email">
          <header className="guide-email-from">
            From{' '}
            {e.senderRef ? <EntityLink entity={e.senderRef} withIcon={false} /> : <strong>{e.sender || 'Unknown'}</strong>}
          </header>
          <blockquote>{e.body}</blockquote>
        </article>
      ))}
    </div>
  );
}

function TaskItem({ task, index }: { task: MissionTask; index: number }) {
  const timeLimit = formatTimeLimit(task.timeLimitSeconds);
  return (
    <Dropdown
      open={index === 0}
      summary={
        <span>
          <span className="task-index">{index + 1}.</span>{' '}
          <strong>{task.objective || task.type}</strong>
          {task.type && <span className="muted"> · {task.type}</span>}
          {timeLimit && <span className="muted"> · ⏱ {timeLimit}</span>}
        </span>
      }
    >
      {task.monsterRequirements.length > 0 && (
        <div className="task-row">
          <span className="task-label">Defeat:</span>
          <ul>
            {task.monsterRequirements.map((m) => (
              <li key={m.ref.id}>
                {m.killCount > 0 && <strong>{m.killCount}× </strong>}
                <EntityLink entity={m.ref} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {task.escortNPC && (
        <div className="task-row">
          <span className="task-label">Escort:</span> <EntityLink entity={task.escortNPC} />
        </div>
      )}
      {task.waypointNPC && (
        <div className="task-row task-row-waypoint">
          <span className="task-label">Go to:</span>
          <EntityLink entity={task.waypointNPC} />
          {task.waypointPoint && (
            <MapSpot
              x={task.waypointPoint.x}
              y={task.waypointPoint.y}
              z={task.waypointPoint.z}
              size={256}
              areaId={task.waypointPoint.areaId}
              title={task.waypointPoint.areaZone}
              instanceName={task.waypointPoint.instanceName}
              instanceID={task.waypointPoint.instanceID}
            />
          )}
        </div>
      )}
      {task.requiredInstance && (
        <div className="task-row">
          <span className="task-label">Inside:</span> <EntityLink entity={task.requiredInstance} />
        </div>
      )}
      {task.onEndObjective && (
        <div className="task-row">
          <span className="task-label">Then:</span> {task.onEndObjective}
        </div>
      )}
      <MessageSection label="On start" msg={task.messages.start} />
      <MessageSection label="On complete" msg={task.messages.end} />
      <MessageSection label="On fail" msg={task.messages.fail} />
      <GuideEmailsSection emails={task.guideEmails} />
    </Dropdown>
  );
}

interface TaskListProps {
  tasks: MissionTask[];
}

export default function TaskList({ tasks }: TaskListProps) {
  if (!tasks.length) return <p className="muted">No tasks.</p>;
  return (
    <div className="task-list">
      {tasks.map((t, i) => <TaskItem key={t.id} task={t} index={i} />)}
    </div>
  );
}
