import type { ReactNode } from 'react';

interface DropdownProps {
  summary: ReactNode;
  open?: boolean;
  children: ReactNode;
}

export default function Dropdown({ summary, open = false, children }: DropdownProps) {
  return (
    <details className="dropdown" open={open}>
      <summary>{summary}</summary>
      <div className="dropdown-body">{children}</div>
    </details>
  );
}
