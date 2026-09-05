import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import InfiniteScroll from '../../components/InfiniteScroll';
import Icon from '../../components/Icon';
import MapSpot from '../../components/MapSpot';
import type { InfectedZoneIndexEntry } from '../../data/types';
import { useDelayedFlag } from '../../data/useDelayedFlag';

const PAGE_SIZE = 50;

function formatTime(seconds: number, sourceLabel: string): string | null {
  if (seconds <= 0) return sourceLabel || null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

interface Props {
  build: string;
  rows: InfectedZoneIndexEntry[];
  loading: boolean;
}

export default function InfectedZoneIndex({ build, rows, loading }: Props) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [hideOutOfGame, setHideOutOfGame] = useState(true);
  const showSkeleton = useDelayedFlag(loading);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let pool = rows;
    if (hideOutOfGame) pool = pool.filter((r) => r.inGame);
    if (needle) pool = pool.filter((r) => r.name.toLowerCase().includes(needle));
    return pool.slice().sort((a, b) => a.id - b.id);
  }, [rows, q, hideOutOfGame]);

  const renderedRows = filtered.slice(0, (page + 1) * PAGE_SIZE);
  const hasMore = renderedRows.length < filtered.length;

  return (
    <>
      <p className="muted">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()}</p>
      <div className="index-controls">
        <input
          type="search"
          placeholder="Filter by name…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
          style={{ width: '100%', maxWidth: 360 }}
          aria-label="Filter infected zones"
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={hideOutOfGame}
            onChange={(e) => { setHideOutOfGame(e.target.checked); setPage(0); }}
          />
          <span>Hide out-of-game infected zones</span>
        </label>
      </div>

      {loading && showSkeleton && <EntityIndexSkeleton />}
      {!loading && filtered.length === 0 && <p className="muted">No matches.</p>}
      {!loading && filtered.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="location-table source-table entity-index-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Infected zone</th>
                  <th>Location</th>
                  <th>Pods</th>
                  <th>Time</th>
                  <th>Max score</th>
                  <th>Warps</th>
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((r) => (
                  <tr key={r.id}>
                    <td><code className="entity-index-id-code">{r.id}</code></td>
                    <td>
                      <Link className="infected-zone-index-card" to={`/${build}/infected-zones/${r.routeId ?? r.id}`}>
                        {r.icon ? <Icon src={r.icon} alt="" size={239} /> : <span className="icon icon-empty" aria-hidden />}
                        <span className="entity-index-link">{r.name}</span>
                      </Link>
                    </td>
                    <td>{r.areaId ? <MapSpot x={r.firstEntryX} y={r.firstEntryY} z={r.firstEntryZ} areaId={r.areaId} title={r.areaZone} icon="/minimap/mapicons/warp_npc.png" /> : r.areaZone || <span className="muted">-</span>}</td>
                    <td>{r.podCount.toLocaleString()}</td>
                    <td>{formatTime(r.timeLimitSeconds, r.timeLimit) ?? <span className="muted">-</span>}</td>
                    <td>{r.maxScore > 0 ? r.maxScore.toLocaleString() : <span className="muted">-</span>}</td>
                    <td>{r.entryWarpCount.toLocaleString()} / {r.exitWarpCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <InfiniteScroll
            hasMore={hasMore}
            shown={renderedRows.length}
            total={filtered.length}
            onLoadMore={() => setPage((current) => current + 1)}
          />
        </>
      )}
    </>
  );
}
