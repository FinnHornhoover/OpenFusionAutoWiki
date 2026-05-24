import type { CSSProperties, ReactNode } from 'react';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Shimmer placeholder. Use sparingly — only where the eventual content is the
 * focus of the page so the user knows it's loading rather than empty.
 */
export default function Skeleton({ width, height, className, style, children }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={'skeleton' + (className ? ' ' + className : '')}
      style={{ width, height, ...style }}
    >
      {children}
    </span>
  );
}
