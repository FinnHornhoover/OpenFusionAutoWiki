import { useEffect, useRef } from 'react';

interface Props {
  hasMore: boolean;
  shown: number;
  total: number;
  onLoadMore: () => void;
}

export default function InfiniteScroll({ hasMore, shown, total, onLoadMore }: Props) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!hasMore || !trigger || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadMoreRef.current();
    }, { rootMargin: '600px 0px' });
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [hasMore, shown]);

  if (!hasMore) return null;

  return (
    <div ref={triggerRef} className="pager infinite-scroll-trigger">
      <button type="button" onClick={onLoadMore}>Load more</button>
      <span className="muted">Showing {shown.toLocaleString()} of {total.toLocaleString()}</span>
    </div>
  );
}
