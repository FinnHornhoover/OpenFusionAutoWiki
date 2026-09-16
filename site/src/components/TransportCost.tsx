import { CurrencyIcon } from './Currency';
import { useParams } from 'react-router-dom';

export default function TransportCost({ cost, moveType }: { cost: number | null; moveType: string }) {
  const { build } = useParams();
  if (cost == null || moveType === 'Slider') return null;
  return (
    <div className="transport-cost">
      {cost.toLocaleString()}
      <CurrencyIcon />
      {build === 'retrobution' && moveType === 'MonkeySkyway' && (
        <>
          {' / '}
          <span className="transport-cost-turbo" title="Turbo cost">
            {(cost * 3).toLocaleString()}
          </span>
          <CurrencyIcon />
        </>
      )}
    </div>
  );
}
