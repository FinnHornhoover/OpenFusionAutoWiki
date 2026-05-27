import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import EntityLink from '../../components/EntityLink';
import type { CodeIndexEntry } from '../../data/types';
import { useDelayedFlag } from '../../data/useDelayedFlag';

const PAGE_SIZE = 50;

interface Props {
  build: string;
  rows: CodeIndexEntry[];
  loading: boolean;
}

export default function CodeIndex({ build, rows, loading }: Props) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const showSkeleton = useDelayedFlag(loading);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let pool = rows;
    if (needle) pool = pool.filter((r) => r.code.toLowerCase().includes(needle) || r.items.some((item) => item.name.toLowerCase().includes(needle)));
    return pool.slice().sort((a, b) => a.code.localeCompare(b.code));
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
          placeholder="Filter by code or item…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
          style={{ width: '100%', maxWidth: 360 }}
          aria-label="Filter codes"
        />
      </div>

      {loading && showSkeleton && <EntityIndexSkeleton />}
      {!loading && filtered.length === 0 && <p className="muted">No matches.</p>}
      {!loading && filtered.length > 0 && (
        <>
          <table className="location-table source-table entity-index-table">
            <thead><tr><th>Code</th><th>Items</th></tr></thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id}>
                  <td><Link className="entity-index-link" to={`/${build}/codes/${r.id}`}><code className="entity-index-id-code">{r.code}</code></Link></td>
                  <td>
                    <div className="code-index-items">
                      {r.items.map((item) => <EntityLink key={item.id} entity={item} iconSize={64} />)}
                    </div>
                  </td>
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
