import type { GuideEmail, MissionTask, TaskMessage } from '../data/types';
import Dropdown from './Dropdown';
import EntityLink from './EntityLink';
import InlineMeta from './InlineMeta';
import MapSpot from './MapSpot';
import { missionWaypointIcon } from '../data/mapMarkers';

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
          <InlineMeta leading>
            {task.type && <span>{task.type}</span>}
            {timeLimit && <span>⏱ {timeLimit}</span>}
          </InlineMeta>
        </span>
      }
    >
      <table className="task-detail-table">
        <tbody>
          {task.monsterRequirements.length > 0 && (
            <tr>
              <th scope="row">Defeat</th>
              <td>
                <ul className="task-ref-list">
                  {task.monsterRequirements.map((m) => (
                    <li key={m.ref.id} className="task-defeat-target">
                      <div className="task-defeat-target-main">
                        {m.killCount > 0 && <strong>{m.killCount}x</strong>}
                        <EntityLink entity={m.ref} />
                        {m.questItem && m.questItemNeededCount > 0 && (
                          <span className="task-quest-item muted">
                            collect {m.questItemNeededCount}x {m.questItem}
                            {m.questItemDropPercent > 0 && <> ({m.questItemDropPercent}% drop)</>}
                          </span>
                        )}
                      </div>
                      {m.location && (
                        <span className="task-mapspot">
                          <MapSpot
                          x={m.location.x}
                          y={m.location.y}
                          z={m.location.z}
                          areaId={m.location.areaId}
                          title={m.location.areaZone}
                          instanceName={m.location.instanceName}
                          instanceID={m.location.instanceID}
                          points={m.location.points}
                            icon={m.mapIcon}
                          />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          )}
          {task.escortNPC && (
            <tr>
              <th scope="row">Escort</th>
              <td><EntityLink entity={task.escortNPC} /></td>
            </tr>
          )}
          {task.waypointNPC && (
            <tr>
              <th scope="row">Go to</th>
              <td className="task-waypoint-cell">
                <EntityLink entity={task.waypointNPC} />
                {task.waypointPoint && (
                  <span className="task-mapspot">
                    <MapSpot
                    x={task.waypointPoint.x}
                    y={task.waypointPoint.y}
                    z={task.waypointPoint.z}
                    size={256}
                    areaId={task.waypointPoint.areaId}
                    title={task.waypointPoint.areaZone}
                    instanceName={task.waypointPoint.instanceName}
                    instanceID={task.waypointPoint.instanceID}
                      icon={missionWaypointIcon(task.type, Boolean(task.waypointNPC))}
                    />
                  </span>
                )}
              </td>
            </tr>
          )}
          {task.requiredInstance && (
            <tr>
              <th scope="row">Inside</th>
              <td><EntityLink entity={task.requiredInstance} /></td>
            </tr>
          )}
          {task.onEndObjective && (
            <tr>
              <th scope="row">Then</th>
              <td>{task.onEndObjective}</td>
            </tr>
          )}
        </tbody>
      </table>
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
