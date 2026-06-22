import dagre from 'dagre';
import { useMemo, useState } from 'react';
import type { GuideEmail, MissionTask, TaskMessage } from '../data/types';
import Dropdown from './Dropdown';
import EntityLink from './EntityLink';
import InlineMeta from './InlineMeta';
import MapSpot from './MapSpot';
import { missionWaypointIcon } from '../data/mapMarkers';

function formatTimeLimit(seconds: number): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return seconds + 's';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? m + 'm ' + s + 's' : m + 'm';
}

function stateLabel(state: string): string {
  if (state === 'FailRepeatTask') return 'Fail repeat';
  if (state === 'UnreachableTask') return 'Unreachable';
  return 'Success';
}

function isSuccessTask(task: MissionTask): boolean {
  return !task.state || task.state === 'SuccessTask';
}

function successBoundaryIds(tasks: MissionTask[]): { startTaskId: number | null; endTaskId: number | null } {
  const successTasks = tasks.filter(isSuccessTask);
  return {
    startTaskId: successTasks[0]?.id ?? null,
    endTaskId: successTasks[successTasks.length - 1]?.id ?? null,
  };
}

function MessageSection({ label, msg }: { label: string; msg: TaskMessage | null }) {
  if (!msg) return null;
  const j = msg.journal;
  const hasJournal = j.detailedMission || j.detailedTask || j.missionSummary || j.missionCompleteSummary;
  if (!msg.text && !msg.sender && !msg.bubble && !hasJournal) return null;
  return (
    <div className="task-message">
      <h4>{label}</h4>
      {msg.sender && <p className="task-message-from"><span>From</span><EntityLink entity={msg.sender} /></p>}
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
            <span>From</span>
            {e.senderRef ? <EntityLink entity={e.senderRef} /> : <strong>{e.sender || 'Unknown'}</strong>}
          </header>
          <blockquote>{e.body}</blockquote>
        </article>
      ))}
    </div>
  );
}

type TaskGraphEdge = { from: number; to: number; kind: 'end' | 'fail' };

interface TaskGraphNode {
  task: MissionTask;
  x: number;
  y: number;
  selfEdges: TaskGraphEdge[];
}

interface TaskGraphLayoutEdge extends TaskGraphEdge {
  points: Array<{ x: number; y: number }>;
}

function graphEdges(tasks: MissionTask[]): TaskGraphEdge[] {
  const taskIds = new Set(tasks.map((task) => task.id));
  return tasks.flatMap((task) => {
    const out: TaskGraphEdge[] = [];
    if (task.nextTaskOnEnd > 0 && taskIds.has(task.nextTaskOnEnd)) out.push({ from: task.id, to: task.nextTaskOnEnd, kind: 'end' });
    if (task.nextTaskOnFail > 0 && taskIds.has(task.nextTaskOnFail)) out.push({ from: task.id, to: task.nextTaskOnFail, kind: 'fail' });
    return out;
  });
}

function edgePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return 'M ' + points[0].x + ' ' + points[0].y;
  return points.map((point, i) => (i === 0 ? 'M ' : 'L ') + point.x + ' ' + point.y).join(' ');
}

function edgeAnchor(
  from: TaskGraphNode,
  to: TaskGraphNode,
  nodeW: number,
  nodeH: number,
  side: 'from' | 'to',
): { x: number; y: number } {
  const fromCx = from.x + nodeW / 2;
  const fromCy = from.y + nodeH / 2;
  const toCx = to.x + nodeW / 2;
  const toCy = to.y + nodeH / 2;
  const dx = toCx - fromCx;
  const dy = toCy - fromCy;
  const source = side === 'from' ? from : to;
  const sign = side === 'from' ? 1 : -1;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      x: source.x + (sign * dx >= 0 ? nodeW : 0),
      y: source.y + nodeH / 2,
    };
  }
  return {
    x: source.x + nodeW / 2,
    y: source.y + (sign * dy >= 0 ? nodeH : 0),
  };
}

function TaskGraph({ tasks, startTaskId, endTaskId }: { tasks: MissionTask[]; startTaskId: number | null; endTaskId: number | null }) {
  const layout = useMemo(() => {
    const nodeW = 230;
    const nodeH = 96;
    const pad = 18;
    const graph = new dagre.graphlib.Graph<TaskGraphEdge>({ multigraph: true });
    graph.setGraph({ rankdir: 'LR', ranksep: 78, nodesep: 28, edgesep: 16, marginx: pad, marginy: pad });
    graph.setDefaultEdgeLabel(() => ({ from: 0, to: 0, kind: 'end' }));

    for (const task of tasks) {
      graph.setNode(String(task.id), { width: nodeW, height: nodeH });
    }

    const edges = graphEdges(tasks);
    const dagreEdges = edges.filter((edge) => edge.from !== edge.to);
    const selfEdges = edges.filter((edge) => edge.from === edge.to);
    for (const edge of dagreEdges) {
      graph.setEdge(String(edge.from), String(edge.to), edge, edge.kind + '-' + edge.from + '-' + edge.to);
    }

    dagre.layout(graph);

    const selfEdgesByTask = new Map<number, TaskGraphEdge[]>();
    for (const edge of selfEdges) {
      const list = selfEdgesByTask.get(edge.from) ?? [];
      list.push(edge);
      selfEdgesByTask.set(edge.from, list);
    }

    const nodes: TaskGraphNode[] = tasks.map((task) => {
      const node = graph.node(String(task.id));
      return {
        task,
        x: (node?.x ?? nodeW / 2) - nodeW / 2,
        y: (node?.y ?? nodeH / 2) - nodeH / 2,
        selfEdges: selfEdgesByTask.get(task.id) ?? [],
      };
    });

    const nodeById = new Map(nodes.map((node) => [node.task.id, node]));
    const layoutEdges: TaskGraphLayoutEdge[] = graph.edges().map((edgeRef) => {
      const edge = graph.edge(edgeRef) as TaskGraphEdge & { points?: Array<{ x: number; y: number }> };
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      const routed = edge.points ?? [];
      if (!from || !to) return { ...edge, points: routed };
      return {
        ...edge,
        points: [
          edgeAnchor(from, to, nodeW, nodeH, 'from'),
          ...routed.slice(1, -1),
          edgeAnchor(from, to, nodeW, nodeH, 'to'),
        ],
      };
    });

    const graphBox = graph.graph();
    const width = Math.max(1, graphBox.width ?? nodeW + pad * 2);
    const height = Math.max(1, graphBox.height ?? nodeH + pad * 2);
    return { nodeW, nodeH, width, height, nodes, edges: layoutEdges };
  }, [tasks]);

  if (!tasks.length) return null;
  return (
    <div className="mission-task-graph-scroll">
      <div className="mission-task-graph" aria-label="Mission task graph" style={{ width: layout.width, height: layout.height }}>
        <svg className="mission-task-graph-svg" viewBox={'0 0 ' + layout.width + ' ' + layout.height} aria-hidden>
          <defs>
            <marker id="task-arrow-end" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M 0 0 L 8 4 L 0 8 z" className="mission-task-arrow-head mission-task-arrow-head-end" />
            </marker>
            <marker id="task-arrow-fail" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M 0 0 L 8 4 L 0 8 z" className="mission-task-arrow-head mission-task-arrow-head-fail" />
            </marker>
          </defs>
          {layout.edges.map((edge, i) => (
            <path
              key={edge.from + '-' + edge.to + '-' + edge.kind + '-' + i}
              className={'mission-task-arrow mission-task-arrow-' + edge.kind}
              d={edgePath(edge.points)}
              markerEnd={edge.kind === 'fail' ? 'url(#task-arrow-fail)' : 'url(#task-arrow-end)'}
            />
          ))}
        </svg>
        {layout.nodes.map(({ task, x, y, selfEdges }) => (
          <div
            key={task.id}
            className={[
              'mission-task-node',
              'mission-task-node-' + (task.state || 'SuccessTask'),
              task.id === startTaskId ? 'mission-task-boundary-start' : '',
              task.id === endTaskId ? 'mission-task-boundary-end' : '',
            ].filter(Boolean).join(' ')}
            style={{ left: x, top: y }}
          >
            <span className="mission-task-node-label">{task.objective || task.type}</span>
            {selfEdges.length > 0 && (
              <span className="mission-task-self-repeat">
                {selfEdges.some((edge) => edge.kind === 'fail') ? 'Repeat if failed' : 'Repeat'}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mission-task-graph-legend muted">
        <span><span className="mission-task-legend-line mission-task-legend-end" /> Success</span>
        <span><span className="mission-task-legend-line mission-task-legend-fail" /> Fail</span>
        <span><span className="mission-task-legend-node mission-task-legend-start" /> Start task</span>
        <span><span className="mission-task-legend-node mission-task-legend-finish" /> End task</span>
        <span><span className="mission-task-legend-node mission-task-legend-unused" /> Unused task</span>
        <span><span className="mission-task-legend-node mission-task-legend-repeat" /> Fail-repeat task</span>
      </div>
    </div>
  );
}

function TaskItem({ task, index, startTaskId, endTaskId }: { task: MissionTask; index: number; startTaskId: number | null; endTaskId: number | null }) {
  const timeLimit = formatTimeLimit(task.timeLimitSeconds);
  const waypointLabel = task.type === 'Talk' ? 'Talk' : 'Go to';
  return (
    <Dropdown
      open={index === 0}
      className={[
        'task-dropdown',
        'task-state-' + (task.state || 'SuccessTask'),
        task.id === startTaskId ? 'task-boundary-start' : '',
        task.id === endTaskId ? 'task-boundary-end' : '',
      ].filter(Boolean).join(' ')}
      summary={
        <span>
          <span className="task-index">{index + 1}.</span>{' '}
          <strong>{task.objective || task.type}</strong>
          <InlineMeta leading>
            {task.type && <span>{task.type}</span>}
            {task.state && !isSuccessTask(task) && <span>{stateLabel(task.state)}</span>}
            {timeLimit && <span>{timeLimit}</span>}
          </InlineMeta>
        </span>
      }
    >
      <table className="task-detail-table">
        <tbody>
          {task.waypointNPC && (
            <tr>
              <th scope="row">{waypointLabel}</th>
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
          {task.escortNPC && <tr><th scope="row">Escort</th><td><EntityLink entity={task.escortNPC} /></td></tr>}
          {timeLimit && <tr><th scope="row">Time limit</th><td>{timeLimit}</td></tr>}
          {task.requiredInstance && <tr><th scope="row">Inside</th><td><EntityLink entity={task.requiredInstance} /></td></tr>}
          {task.onEndObjective && <tr className="task-transition-row task-transition-start"><th scope="row">Next</th><td>{task.onEndObjective}</td></tr>}
          {task.onFailObjective && <tr className={'task-transition-row' + (!task.onEndObjective ? ' task-transition-start' : '')}><th scope="row">On Fail</th><td>{task.onFailObjective}</td></tr>}
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
  const [showFailRepeat, setShowFailRepeat] = useState(false);
  const [showUnreachable, setShowUnreachable] = useState(false);
  if (!tasks.length) return <p className="muted">No tasks.</p>;
  const visibleTasks = tasks.filter((task) => {
    if (task.state === 'FailRepeatTask') return showFailRepeat;
    if (task.state === 'UnreachableTask') return showUnreachable;
    return true;
  });
  const failRepeatCount = tasks.filter((task) => task.state === 'FailRepeatTask').length;
  const unreachableCount = tasks.filter((task) => task.state === 'UnreachableTask').length;
  const { startTaskId, endTaskId } = successBoundaryIds(visibleTasks);
  return (
    <div className="task-list">
      <TaskGraph tasks={visibleTasks} startTaskId={startTaskId} endTaskId={endTaskId} />
      {(failRepeatCount > 0 || unreachableCount > 0) && (
        <div className="mission-task-controls">
          {failRepeatCount > 0 && (
            <label className="checkbox">
              <input type="checkbox" checked={showFailRepeat} onChange={(e) => setShowFailRepeat(e.target.checked)} />
              <span>Show fail-repeat tasks ({failRepeatCount})</span>
            </label>
          )}
          {unreachableCount > 0 && (
            <label className="checkbox">
              <input type="checkbox" checked={showUnreachable} onChange={(e) => setShowUnreachable(e.target.checked)} />
              <span>Show unreachable tasks ({unreachableCount})</span>
            </label>
          )}
        </div>
      )}
      {visibleTasks.map((t, i) => <TaskItem key={t.id} task={t} index={i} startTaskId={startTaskId} endTaskId={endTaskId} />)}
    </div>
  );
}
