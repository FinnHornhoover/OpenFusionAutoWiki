import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import type { ItemSetIndexEntry } from '../../data/types';
import { useDelayedFlag } from '../../data/useDelayedFlag';

const PAGE_SIZE = 50;

interface Props {
  build: string;
  rows: ItemSetIndexEntry[];
  loading: boolean;
}

export default function ItemSetIndex({ build, rows, loading }: Props) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const showSkeleton = useDelayedFlag(loading);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let pool = rows;
    if (needle) pool = pool.filter((r) => r.name.toLowerCase().includes(needle) || String(r.id) === needle);
    return pool.slice().sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  }, [rows, q]);

  const start = page * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  return (
    <>
      <p className="muted">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()}</p>
      <div className="index-controls">
        <input
          type="search"
          placeholder="Filter by set name..."
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
          style={{ width: '100%', maxWidth: 360 }}
          aria-label="Filter item sets"
        />
      </div>

      {loading && showSkeleton && <EntityIndexSkeleton />}
      {!loading && filtered.length === 0 && <p className="muted">No matches.</p>}
      {!loading && filtered.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="location-table source-table entity-index-table">
              <thead>
                <tr>
                  <th>Set</th>
                  <th>Items</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id}>
                    <td><Link className="entity-index-link" to={`/${build}/item-sets/${r.routeId ?? r.id}`}>{r.name}</Link></td>
                    <td>{r.itemCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
