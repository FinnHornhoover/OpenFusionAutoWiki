import { type ReactNode, useEffect, useRef, useState } from 'react';

interface IndexFilterDropdownProps {
  summary: ReactNode;
  children: ReactNode;
}

export default function IndexFilterDropdown({ summary, children }: IndexFilterDropdownProps) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const root = ref.current;
      if (!root || root.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <details ref={ref} className="index-filter-dropdown" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{summary}</summary>
      <div className="index-filter-menu">{children}</div>
    </details>
  );
}
