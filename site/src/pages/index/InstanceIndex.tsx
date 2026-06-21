import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import EntityLink from '../../components/EntityLink';
import type { InstanceIndexEntry } from '../../data/types';
import { useDelayedFlag } from '../../data/useDelayedFlag';

const PAGE_SIZE = 50;

interface Props {
  build: string;
  rows: InstanceIndexEntry[];
  loading: boolean;
}

export default function InstanceIndex({ build, rows, loading }: Props) {
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

  const start = page * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

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
          aria-label="Filter instances"
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={hideOutOfGame}
            onChange={(e) => { setHideOutOfGame(e.target.checked); setPage(0); }}
          />
          <span>Hide out-of-game instances</span>
        </label>
      </div>

      {loading && showSkeleton && <EntityIndexSkeleton />}
      {!loading && filtered.length === 0 && <p className="muted">No matches.</p>}
      {!loading && filtered.length > 0 && (
        <>
          <table className="location-table source-table entity-index-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Instance</th>
                <th>Infected zone</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className={r.inGame ? undefined : 'entity-index-row-muted'}>
                  <td><code className="entity-index-id-code">{r.id}</code></td>
                  <td><Link className="entity-index-link" to={`/${build}/instances/${r.id}`}>{r.name}</Link></td>
                  <td>{r.infectedZone ? <EntityLink entity={r.infectedZone} iconSize={64} /> : <span className="muted">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <nav className="pager" aria-label="Pagination">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>‹ Prev</button>
              <span className="muted">Page {page + 1} / {totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>Next ›</button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
