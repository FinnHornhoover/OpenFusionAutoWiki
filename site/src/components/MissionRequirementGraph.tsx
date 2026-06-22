import dagre from 'dagre';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { Mission, MissionIndexEntry, Ref } from '../data/types';
import { useIndex } from '../data/useIndex';
import EntityLink from './EntityLink';

type RequirementNodeKind = 'required' | 'current' | 'unlocks' | 'related';

interface RequirementNode {
  key: string;
  ref: Ref;
  kind: RequirementNodeKind;
  x: number;
  y: number;
}

interface RequirementEdge {
  from: string;
  to: string;
  points: Array<{ x: number; y: number }>;
}

interface MissionGraphEntry {
  id: number;
  name: string;
  icon?: string;
  requiredMissions: Ref[];
  requiredByMissions: Ref[];
}

function refId(ref: Ref): number | null {
  const id = typeof ref.id === 'number' ? ref.id : parseInt(String(ref.id), 10);
  return Number.isFinite(id) ? id : null;
}

function uniqueMissionRefs(refs: Ref[]): Ref[] {
  const byId = new Map<number, Ref>();
  for (const ref of refs) {
    const id = refId(ref);
    if (id === null || ref.type !== 'mission') continue;
    if (!byId.has(id)) byId.set(id, ref);
  }
  return [...byId.values()];
}

function edgePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return 'M ' + points[0].x + ' ' + points[0].y;
  return points.map((point, i) => (i === 0 ? 'M ' : 'L ') + point.x + ' ' + point.y).join(' ');
}

function edgeAnchor(
  from: RequirementNode,
  to: RequirementNode,
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

function buildGraphEntries(mission: Mission, indexRows: MissionIndexEntry[] | null): Map<number, MissionGraphEntry> {
  const entries = new Map<number, MissionGraphEntry>();

  for (const row of indexRows ?? []) {
    entries.set(row.id, {
      id: row.id,
      name: row.name,
      icon: row.displayNPC?.icon ?? row.startNPC?.icon ?? '',
      requiredMissions: uniqueMissionRefs(row.requiredMissions ?? []),
      requiredByMissions: uniqueMissionRefs(row.requiredByMissions ?? []),
    });
  }

  const current = entries.get(mission.id);
  entries.set(mission.id, {
    id: mission.id,
    name: mission.name,
    icon: current?.icon ?? (mission.startNPC ?? mission.journalNPC)?.icon ?? '',
    requiredMissions: uniqueMissionRefs([...(current?.requiredMissions ?? []), ...mission.requiredMissions]),
    requiredByMissions: uniqueMissionRefs([...(current?.requiredByMissions ?? []), ...mission.requiredByMissions]),
  });

  for (const entry of [...entries.values()]) {
    for (const req of entry.requiredMissions) {
      const id = refId(req);
      if (id === null || entries.has(id)) continue;
      entries.set(id, { id, name: req.name, icon: req.icon ?? '', requiredMissions: [], requiredByMissions: [] });
    }
    for (const unlock of entry.requiredByMissions) {
      const id = refId(unlock);
      if (id === null || entries.has(id)) continue;
      entries.set(id, { id, name: unlock.name, icon: unlock.icon ?? '', requiredMissions: [], requiredByMissions: [] });
    }
  }

  return entries;
}

function addEdge(edges: Map<string, { from: number; to: number }>, from: number, to: number): void {
  if (from === to) return;
  edges.set(from + '-' + to, { from, to });
}

function walk(start: number, adjacency: Map<number, number[]>): Set<number> {
  const seen = new Set<number>();
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

export default function MissionRequirementGraph({ mission }: { mission: Mission }) {
  const { build } = useParams();
  const { rows: missionIndexRows } = useIndex<MissionIndexEntry>(build, 'missions');
  const layout = useMemo(() => {
    const currentId = mission.id;
    const entries = buildGraphEntries(mission, missionIndexRows);
    const edgeMap = new Map<string, { from: number; to: number }>();

    for (const entry of entries.values()) {
      for (const req of entry.requiredMissions) {
        const reqId = refId(req);
        if (reqId !== null) addEdge(edgeMap, reqId, entry.id);
      }
      for (const unlock of entry.requiredByMissions) {
        const unlockId = refId(unlock);
        if (unlockId !== null) addEdge(edgeMap, entry.id, unlockId);
      }
    }

    if (edgeMap.size === 0) return null;

    const outgoing = new Map<number, number[]>();
    const incoming = new Map<number, number[]>();
    const undirected = new Map<number, number[]>();
    for (const edge of edgeMap.values()) {
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
      incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
      undirected.set(edge.from, [...(undirected.get(edge.from) ?? []), edge.to]);
      undirected.set(edge.to, [...(undirected.get(edge.to) ?? []), edge.from]);
    }

    const componentIds = walk(currentId, undirected);
    const ancestorIds = walk(currentId, incoming);
    const descendantIds = walk(currentId, outgoing);
    const visibleEdges = [...edgeMap.values()].filter((edge) => componentIds.has(edge.from) && componentIds.has(edge.to));
    if (visibleEdges.length === 0) return null;

    const nodeW = 220;
    const nodeH = 82;
    const pad = 18;
    const graph = new dagre.graphlib.Graph<{ from: string; to: string }>({ multigraph: true });
    graph.setGraph({ rankdir: 'LR', ranksep: 76, nodesep: 22, edgesep: 12, marginx: pad, marginy: pad });
    graph.setDefaultEdgeLabel(() => ({ from: '', to: '' }));

    const nodes: Array<Omit<RequirementNode, 'x' | 'y'>> = [...componentIds]
      .map((id) => entries.get(id))
      .filter((entry): entry is MissionGraphEntry => Boolean(entry))
      .map((entry) => {
        let kind: RequirementNodeKind = 'related';
        if (entry.id === currentId) kind = 'current';
        else if (ancestorIds.has(entry.id) && descendantIds.has(entry.id)) kind = 'related';
        else if (ancestorIds.has(entry.id)) kind = 'required';
        else if (descendantIds.has(entry.id)) kind = 'unlocks';
        return {
          key: 'mission-' + entry.id,
          ref: { type: 'mission', id: entry.id, name: entry.name, icon: entry.icon ?? '' },
          kind,
        };
      });

    for (const node of nodes) graph.setNode(node.key, { width: nodeW, height: nodeH });
    for (const edge of visibleEdges) {
      graph.setEdge('mission-' + edge.from, 'mission-' + edge.to, { from: 'mission-' + edge.from, to: 'mission-' + edge.to }, edge.from + '-' + edge.to);
    }

    dagre.layout(graph);

    const laidOutNodes: RequirementNode[] = nodes.map((node) => {
      const graphNode = graph.node(node.key);
      return {
        ...node,
        x: (graphNode?.x ?? nodeW / 2) - nodeW / 2,
        y: (graphNode?.y ?? nodeH / 2) - nodeH / 2,
      };
    });
    const nodeByKey = new Map(laidOutNodes.map((node) => [node.key, node]));
    const edges: RequirementEdge[] = graph.edges().map((edgeRef) => {
      const edge = graph.edge(edgeRef) as { from: string; to: string; points?: Array<{ x: number; y: number }> };
      const from = nodeByKey.get(edge.from);
      const to = nodeByKey.get(edge.to);
      const routed = edge.points ?? [];
      if (!from || !to) return { from: edge.from, to: edge.to, points: routed };
      return {
        from: edge.from,
        to: edge.to,
        points: [
          edgeAnchor(from, to, nodeW, nodeH, 'from'),
          ...routed.slice(1, -1),
          edgeAnchor(from, to, nodeW, nodeH, 'to'),
        ],
      };
    });

    const graphBox = graph.graph();
    return {
      width: Math.max(1, graphBox.width ?? nodeW + pad * 2),
      height: Math.max(1, graphBox.height ?? nodeH + pad * 2),
      nodeW,
      nodeH,
      nodes: laidOutNodes,
      edges,
    };
  }, [mission, missionIndexRows]);

  if (!layout) return null;

  return (
    <section className="mission-requirement-graph-section" aria-labelledby="mission-requirement-graph-title">
      <h2 id="mission-requirement-graph-title">Requirement graph</h2>
      <div className="mission-requirement-graph-scroll">
        <div className="mission-requirement-graph" style={{ width: layout.width, height: layout.height }}>
          <svg className="mission-requirement-graph-svg" viewBox={'0 0 ' + layout.width + ' ' + layout.height} aria-hidden>
            <defs>
              <marker id="mission-requirement-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                <path d="M 0 0 L 8 4 L 0 8 z" className="mission-requirement-arrow-head" />
              </marker>
            </defs>
            {layout.edges.map((edge, i) => (
              <path key={edge.from + '-' + edge.to + '-' + i} className="mission-requirement-arrow" d={edgePath(edge.points)} markerEnd="url(#mission-requirement-arrow)" />
            ))}
          </svg>
          {layout.nodes.map((node) => (
            <div
              key={node.key}
              className={'mission-requirement-node mission-requirement-node-' + node.kind}
              style={{ left: node.x, top: node.y, width: layout.nodeW, height: layout.nodeH }}
            >
              <span className="mission-requirement-node-role">
                {node.kind === 'required' ? 'Prerequisite' : node.kind === 'unlocks' ? 'Unlocks' : node.kind === 'related' ? 'Related' : 'Current'}
              </span>
              <EntityLink entity={node.ref} withIcon={false} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
