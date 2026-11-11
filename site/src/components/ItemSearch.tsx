import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from './Icon';

interface SearchItem { id: string; name: string; icon: string }
interface Props<T extends SearchItem> {
  items: T[];
  selected?: T;
  onSelect: (item: T) => void;
  describe: (item: T) => string;
  searchText?: (item: T) => string;
  label: string;
  clearOnSelect?: boolean;
}

export default function ItemSearch<T extends SearchItem>({ items, selected, onSelect, describe, searchText = describe, label, clearOnSelect = false }: Props<T>) {
  const [query, setQuery] = useState(selected?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    const tokens = text.split(/\s+/).filter(Boolean);
    return items.filter((item) => tokens.every((token) => `${item.name} ${searchText(item)}`.toLowerCase().includes(token)))
      .map((item) => ({ item, score: !text ? (item.id === selected?.id ? 0 : 1) : item.name.toLowerCase() === text ? 0 : item.name.toLowerCase().startsWith(text) ? 1 : item.name.toLowerCase().includes(text) ? 2 : 3 }))
      .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
      .slice(0, 50).map((match) => match.item);
  }, [items, query, selected?.id, searchText]);

  useEffect(() => {
    if (open) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (item: T): void => {
    setQuery(clearOnSelect ? '' : item.name);
    setOpen(false);
    onSelect(item);
  };
  return <div className="combination-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(clearOnSelect ? '' : selected?.name ?? ''); }
  }}>
    <input role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open}
      aria-controls={`${id}-options`} aria-activedescendant={open && matches[active] ? `${id}-${matches[active].id}` : undefined}
      autoComplete="off" placeholder="Search items" value={query}
      onFocus={() => { setQuery(''); setActive(0); setOpen(true); }}
      onClick={() => setOpen(true)}
      onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          setActive((value) => Math.max(0, Math.min(matches.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1))));
        } else if (event.key === 'Enter' && open && matches[active]) { event.preventDefault(); choose(matches[active]); }
        else if (event.key === 'Escape') { setOpen(false); setQuery(clearOnSelect ? '' : selected?.name ?? ''); }
      }} />
    {open && <div className="combination-options" id={`${id}-options`} role="listbox" aria-label={`Matching ${label.toLowerCase()}`} ref={list}>
      {matches.map((item, index) => <button type="button" role="option" tabIndex={-1} id={`${id}-${item.id}`}
        aria-selected={selected?.id === item.id} data-active={active === index} key={item.id}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
        <Icon src={item.icon} size={64} className="icon-item" />
        <span><strong>{item.name}</strong><small>{describe(item)}</small></span>
      </button>)}
      {!matches.length && <p role="status">No matching items.</p>}
    </div>}
  </div>;
}
