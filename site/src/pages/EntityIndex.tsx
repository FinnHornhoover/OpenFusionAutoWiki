import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import Icon from '../components/Icon';
import type { MissionIndexEntry } from '../data/types';
import { useBuildEntry } from '../data/useBuildEntry';
import { useBuildMeta } from '../data/useBuildMeta';
import { useIndex } from '../data/useIndex';

const PAGE_SIZE = 50;

/** Visible mission types, in display order. "None" is intentionally hidden. */
const MISSION_TYPE_TABS = ['Normal', 'Guide', 'Nano'] as const;
type MissionTab = (typeof MISSION_TYPE_TABS)[number] | 'All';

function tabFromParam(p: string | null): MissionTab {
  if (!p) return 'All';
  const lc = p.toLowerCase();
  for (const t of MISSION_TYPE_TABS) {
    if (t.toLowerCase() === lc) return t;
  }
  return 'All';
}

export default function EntityIndex() {
  const { build, type } = useParams();
  const entry = useBuildEntry(build);
  const meta = useBuildMeta(build);
  const supported = meta?.builtTypes?.includes(type ?? '') ?? false;
  const { rows, loading } = useIndex<MissionIndexEntry>(
    supported ? build : undefined,
    supported ? type : undefined,
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = tabFromParam(searchParams.get('type'));
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  // Counts per visible type (computed once per index load).
  const counts = useMemo(() => {
    const acc: Record<MissionTab, number> = { All: 0, Normal: 0, Guide: 0, Nano: 0 };
    if (!rows) return acc;
    for (const r of rows) {
      acc.All++;
      if ((MISSION_TYPE_TABS as readonly string[]).includes(r.type)) {
        acc[r.type as MissionTab]++;
      }
    }
    return acc;
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    const byType = activeTab === 'All' ? rows : rows.filter((r) => r.type === activeTab);
    const matched = needle ? byType.filter((r) => r.name.toLowerCase().includes(needle)) : byType;
    return matched.slice().sort((a, b) => a.id - b.id);
  }, [rows, q, activeTab]);

  const start = page * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const buildLabel = entry ? entry.displayName : build;

  function selectTab(t: MissionTab) {
    setPage(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (t === 'All') next.delete('type');
      else next.set('type', t.toLowerCase());
      return next;
    });
  }

  if (!supported) {
    return (
      <section>
        <h1>{type}</h1>
        <p className="muted">Build: {buildLabel}</p>
        <div className="placeholder">
          {type} aren't normalized yet for this build. Coming in a later phase.
        </div>
      </section>
    );
  }

  return (
    <section>
      <h1>Missions</h1>
      <p className="muted">
        Build: {buildLabel} · {filtered.length.toLocaleString()} of {rows?.length.toLocaleString() ?? 0}
      </p>

      <nav className="type-tabs" aria-label="Filter by mission type">
        {(['All', ...MISSION_TYPE_TABS] as MissionTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={'type-tab' + (activeTab === t ? ' active' : '')}
            onClick={() => selectTab(t)}
            disabled={t !== 'All' && counts[t] === 0}
          >
            {t} <span className="type-tab-count">({counts[t].toLocaleString()})</span>
          </button>
        ))}
      </nav>

      <input
        type="search"
        placeholder="Filter by name…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setPage(0); }}
        style={{ width: '100%', maxWidth: 360, marginBottom: 'var(--space-4)' }}
        aria-label="Filter missions"
      />
      {loading && <p className="muted">Loading…</p>}
      {!loading && filtered.length === 0 && <p className="muted">No matches.</p>}
      {!loading && filtered.length > 0 && (
        <>
          <ul className="entity-index">
            {pageRows.map((r) => (
              <li key={r.id} className="entity-index-row">
                {r.startNPC?.icon
                  ? <Icon src={r.startNPC.icon} alt={r.startNPC.name} size={28} />
                  : <span className="icon icon-empty" aria-hidden style={{ width: 28, height: 28 }} />}
                <span className="entity-index-main">
                  <Link to={`/${build}/${type}/${r.id}`}>{r.name}</Link>
                  <span className="muted">
                    {' · '}Lv {r.level}
                    {r.difficulty && r.difficulty !== 'Normal' && ` · ${r.difficulty}`}
                    {r.type && r.type !== 'Normal' && ` · ${r.type}`}
                    {r.startNPC?.name && ` · from ${r.startNPC.name}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <nav className="pager" aria-label="Pagination">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>‹ Prev</button>
              <span className="muted">Page {page + 1} / {totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>Next ›</button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
