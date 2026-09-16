type CurrencyKind = 'taros' | 'fm';

export function CurrencyIcon({ kind = 'taros' }: { kind?: CurrencyKind }) {
  const label = kind === 'taros' ? 'Taros' : 'Fusion Matter';
  return <img className="currency-icon" src={kind === 'taros' ? '/ui/taros.png' : '/ui/fusion-matter.png'} alt={label} title={label} width={16} height={16} />;
}

export default function Currency({ amount, kind = 'taros' }: { amount: number; kind?: CurrencyKind }) {
  return <span className="currency-amount">{amount.toLocaleString()} <CurrencyIcon kind={kind} /></span>;
}
