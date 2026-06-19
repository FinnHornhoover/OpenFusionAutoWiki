import type { ReactNode } from 'react';

interface DropdownProps {
  summary: ReactNode;
  open?: boolean;
  children: ReactNode;
  className?: string;
}

export default function Dropdown({ summary, open = false, children, className = '' }: DropdownProps) {
  return (
    <details className={['dropdown', className].filter(Boolean).join(' ')} open={open}>
      <summary>{summary}</summary>
      <div className="dropdown-body">{children}</div>
    </details>
  );
}
