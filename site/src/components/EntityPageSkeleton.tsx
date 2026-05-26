import Skeleton from './Skeleton';

/** Placeholder layout shown while EntityPage waits for its chunk. */
export default function EntityPageSkeleton() {
  return (
    <section className="entity-page" aria-busy="true">
      <p className="breadcrumb">
        <Skeleton width={140} height={14} />
      </p>
      <h1><Skeleton width="60%" height={32} /></h1>
      <div className="entity-header">
        <div className="entity-header-icon"><Skeleton width={48} height={48} /></div>
        <div className="entity-meta">
          <Skeleton width={120} height={20} />
          <Skeleton width={80} height={20} />
        </div>
      </div>
      <Skeleton style={{ display: 'block', width: '100%', height: 120, margin: 'var(--space-4) 0' }} />
      <Skeleton style={{ display: 'block', width: '100%', height: 80, margin: 'var(--space-3) 0' }} />
      <Skeleton style={{ display: 'block', width: '100%', height: 60, margin: 'var(--space-3) 0' }} />
    </section>
  );
}
