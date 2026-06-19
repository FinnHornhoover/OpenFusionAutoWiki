import { useEffect, useMemo, useRef, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';

import { useSearchIndex } from '../data/useSearchIndex';
import type { SearchRow } from '../data/useSearchIndex';
import Icon from './Icon';

const MAX_RESULTS = 20;
const TYPE_LABEL: Record<SearchRow['type'], string> = {
  missions: 'Mission',
  npcs: 'NPC',
  items: 'Item',
  codes: 'Code',
  monsters: 'Monster',
  areas: 'Area',
  instances: 'Instance',
  'infected-zones': 'Infected Zone',
  nanos: 'Nano',
  'player-stats': 'Reference',
};

/** Rank a row for a given lowercase query. Lower = better. */
function score(name: string, needle: string): number {
  const lower = name.toLowerCase();
  if (lower === needle) return 0;
  if (lower.startsWith(needle)) return 1;
  if (lower.indexOf(' ' + needle) >= 0) return 2;
  if (lower.includes(needle)) return 3;
  return Number.POSITIVE_INFINITY;
}

function SearchIcon() {
  return (
    <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

interface OverlayProps { build: string | undefined; onClose: () => void; }

function SearchOverlay({ build, onClose }: OverlayProps) {
  const navigate = useNavigate();
  const { rows } = useSearchIndex(build);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 100);
    return () => clearTimeout(t);
  }, [q]);

  const results = useMemo(() => {
    const needle = debounced.trim().toLowerCase();
    if (!needle || !rows) return [];
    const scored: Array<{ row: SearchRow; rank: number }> = [];
    for (const r of rows) {
      const rank = score(r.name, needle);
      if (rank === Number.POSITIVE_INFINITY) continue;
      scored.push({ row: r, rank });
      if (scored.length > MAX_RESULTS * 4) break;
    }
    scored.sort((a, b) => a.rank - b.rank || a.row.name.localeCompare(b.row.name));
    return scored.slice(0, MAX_RESULTS).map((s) => s.row);
  }, [debounced, rows]);

  useEffect(() => { setHighlight(0); }, [results]);

  function go(row: SearchRow) {
    if (!build) return;
    onClose();
    navigate(row.id === '' ? `/${build}/${row.type}` : `/${build}/${row.type}/${row.id}`);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && results[highlight]) {
      e.preventDefault();
      go(results[highlight]);
    }
  }

  return (
    <div className="search-overlay" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Search">
      <div className="search-dialog" ref={dialogRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-dialog-input">
          <SearchIcon />
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={build ? 'Search…' : 'Pick a build first…'}
            disabled={!build}
            aria-label="Search wiki"
            autoComplete="off"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="search-dialog-results" role="listbox">
          {build && q.trim() && rows && results.length === 0 && (
            <div className="search-empty muted">No matches.</div>
          )}
          {build && q.trim() && !rows && (
            <div className="search-empty muted">Loading…</div>
          )}
          {!q.trim() && (
            <div className="search-empty muted">
              Type to search across missions, NPCs, items, codes, monsters, areas, instances, infected zones, nanos, and build references.
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.type}-${r.id}`}
              type="button"
              role="option"
              aria-selected={i === highlight}
              className={'search-result' + (i === highlight ? ' active' : '')}
              onMouseDown={(e) => { e.preventDefault(); go(r); }}
              onMouseEnter={() => setHighlight(i)}
            >
              {r.icon
                ? <Icon src={r.icon} alt="" size={96} />
                : <span className="icon icon-empty" aria-hidden style={{ width: 96, height: 96 }} />}
              <span className="search-result-name">{r.name}</span>
              <span className="search-result-type">{TYPE_LABEL[r.type]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SearchBar() {
  const match = useMatch('/:build/*');
  const build = match?.params.build;
  const [open, setOpen] = useState(false);
  const mac = isMac();

  // Cmd/Ctrl+K opens; Esc closes (global so it works anywhere in the dialog).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = mac ? e.metaKey : e.ctrlKey;
      if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mac]);

  // Body scroll lock while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="search-trigger"
        onClick={() => setOpen(true)}
        aria-label="Open search"
      >
        <SearchIcon />
        <span className="search-trigger-label">Search…</span>
        <kbd className="search-trigger-kbd">{mac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      {open && <SearchOverlay build={build} onClose={() => setOpen(false)} />}
    </>
  );
}
