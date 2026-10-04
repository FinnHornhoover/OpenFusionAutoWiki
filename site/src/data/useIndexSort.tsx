import { useMemo, useState } from 'react';

type SortValue = string | number | null | undefined;

/** Keep the list's existing order until the user chooses a column. */
export function useIndexSort<T>(rows: T[], columns: Record<string, (row: T) => SortValue>, onChange: () => void) {
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(null);
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const value = columns[sort.key];
    if (!value) return rows;
    return rows.slice().sort((a, b) => {
      const av = value(a), bv = value(b);
      // Missing values stay last in either direction.
      if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
      const delta = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
      return sort.descending ? -delta : delta;
    });
  }, [rows, columns, sort]);

  function sortHeader(key: string, label: string) {
    const active = sort?.key === key;
    return (
      <th aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}>
        <button
          type="button"
          className="index-sort-button"
          onClick={() => {
            setSort({ key, descending: active ? !sort.descending : false });
            onChange();
          }}
          title={`Sort by ${label} ${active && !sort.descending ? 'descending' : 'ascending'}`}
        >
          {label} <span aria-hidden="true">{active ? (sort.descending ? '▼' : '▲') : '▴▾'}</span>
        </button>
      </th>
    );
  }

  const resetSortButton = (
    <button
      type="button"
      className="index-control-button"
      disabled={!sort}
      onClick={() => {
        setSort(null);
        onChange();
      }}
    >
      Reset sorting
    </button>
  );

  return { sortedRows, sortHeader, resetSortButton };
}
