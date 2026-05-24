import Skeleton from './Skeleton';

interface Props { rows?: number; }

/** Placeholder list shown while an entity-index page waits for its index file. */
export default function EntityIndexSkeleton({ rows = 8 }: Props) {
  return (
    <ul className="entity-index" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="entity-index-row">
          <Skeleton width={28} height={28} />
          <span className="entity-index-main">
            <Skeleton width="35%" height={16} />
            {' '}
            <Skeleton width="25%" height={14} />
          </span>
        </li>
      ))}
    </ul>
  );
}
