import { Children } from 'react';
import type { ReactNode } from 'react';

interface InlineMetaProps {
  children: ReactNode;
  className?: string;
  leading?: boolean;
}

export default function InlineMeta({ children, className = 'muted', leading = false }: InlineMetaProps) {
  const items = Children.toArray(children).filter((child) => child !== '');
  if (items.length === 0) return null;

  return (
    <span className={[className, 'inline-meta', leading ? 'inline-meta-leading' : ''].filter(Boolean).join(' ')}>
      {items.map((child, i) => (
        <span className="inline-meta-item" key={i}>{child}</span>
      ))}
    </span>
  );
}
