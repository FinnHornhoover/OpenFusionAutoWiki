import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import InfiniteScroll from '../../components/InfiniteScroll';
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

  const renderedRows = filtered.slice(0, (page + 1) * PAGE_SIZE);
  const hasMore = renderedRows.length < filtered.length;

  return (
    <>
      <p className="muted">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()}</p>
      <div className="index-controls">
        <input
          type="search"
          placeholder="Filter by code or item..."
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
          <div className="table-scroll">
            <table className="location-table source-table entity-index-table code-index-table">
              <thead><tr><th>Code</th></tr></thead>
              <tbody>
                {renderedRows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="entity-index-link code-index-code" to={`/${build}/codes/${r.routeId ?? r.id}`}><code className="entity-index-id-code">{r.code}</code></Link>
                      <div className="code-index-items">
                        {r.items.map((item) => (
                          <EntityLink key={item.id} entity={item} iconSize={64} />
                        ))}
                      </div>
                    </td>
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
