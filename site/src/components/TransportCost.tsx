import { useParams } from 'react-router-dom';

export default function TransportCost({ cost }: { cost: number | null }) {
  const { build } = useParams();
  if (cost == null) return null;
  return (
    <div className="transport-cost">
      {cost.toLocaleString()}
      <img src="/ui/taros.png" alt="Taros" width={16} height={16} />
      {build === 'retrobution' && (
        <>
          {' / '}
          <span className="transport-cost-turbo" title="Turbo cost">
            {(cost * 3).toLocaleString()}
          </span>
          <img src="/ui/taros.png" alt="Taros" width={16} height={16} />
        </>
      )}
    </div>
  );
}
