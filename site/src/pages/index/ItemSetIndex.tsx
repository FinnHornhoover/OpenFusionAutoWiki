import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import EntityIndexSkeleton from '../../components/EntityIndexSkeleton';
import EntityLink from '../../components/EntityLink';
import InfiniteScroll from '../../components/InfiniteScroll';
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

  const renderedRows = filtered.slice(0, (page + 1) * PAGE_SIZE);
  const hasMore = renderedRows.length < filtered.length;

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
            <table className="location-table source-table entity-index-table code-index-table">
              <thead>
                <tr>
                  <th>Set</th>
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="item-set-index-heading">
                        <Link className="entity-index-link" to={`/${build}/item-sets/${r.routeId ?? r.id}`}>{r.name}</Link>
                        <span className="muted">{r.itemCount.toLocaleString()} items</span>
                      </div>
                      {(r.items?.length ?? 0) > 0 && <div className="code-index-items">
                        {(r.items ?? []).slice(0, 5).map((item) => <EntityLink key={item.id} entity={item} iconSize={64} />)}
                        {r.itemCount > 5 && <Link
                          className="item-set-index-more"
                          to={`/${build}/item-sets/${r.routeId ?? r.id}`}
                          aria-label={`Show all ${r.itemCount} items in ${r.name}`}
                        >…</Link>}
                      </div>}
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
