import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Gender, ModelPreview, OutfitCatalog, OutfitItem, PartSlot, PreviewVariant } from '../../../shared/objects';
import { composeOutfit } from '../../../shared/outfits.js';
import { previewJson } from '../objects/data';
import { chunkFor } from '../data/useEntity';
import ItemSearch from './ItemSearch';
import Icon from './Icon';
const ModelCanvas = lazy(() => import('./ModelCanvas'));

const SLOTS: [PartSlot, string][] = [['hat', 'Head'], ['glasses', 'Face accessory'], ['shirt', 'Body'], ['pants', 'Legs'], ['shoes', 'Shoes'], ['back', 'Back'], ['weapon', 'Weapon'], ['vehicle', 'Vehicle']];
const CLOTHING = new Set<PartSlot>(['shirt', 'pants', 'shoes']);
const describe = (item: OutfitItem): string => `Lv${item.level} · ${item.rarity}`;
const searchText = (item: OutfitItem): string => `${describe(item)} · ${item.type} · ${item.gender}${item.obtainable ? '' : ' · Unobtainable'}`;

export default function OutfitPreview({ initial, variant, build, baseUrl, catalog, onGenderChange }: { initial: string[]; variant: PreviewVariant; build: string; baseUrl: string; catalog: OutfitCatalog; onGenderChange: (gender: Gender) => void }) {
  const [selected, setSelected] = useState(initial);
  const [preview, setPreview] = useState(variant);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const available = useMemo(() => catalog.items.filter((item) => item.genders.includes(variant.gender!)), [catalog, variant.gender]);
  const equipped = useMemo(() => {
    const slots = new Set<PartSlot>();
    return selected.flatMap((id) => {
      const item = catalog.items.find((item) => item.id === id && item.genders.includes(variant.gender!));
      if (!item || slots.has(item.slot)) return [];
      slots.add(item.slot);
      return [item];
    });
  }, [catalog, selected, variant.gender]);

  useEffect(() => {
    if (!selected.length) {
      setPreview(variant);
      setLoading(false);
      setError('');
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    void (async () => {
      const items = await Promise.all(equipped.map(async (item) => {
        const rows = await previewJson<Record<string, ModelPreview>>(`/data/${build}/previews/items/${chunkFor('items', item.id)}.json`);
        const choice = rows?.[item.id]?.variants.find((v) => v.gender === variant.gender);
        if (!choice) throw new Error(`Could not load ${item.name}.`);
        return choice;
      }));
      const base = catalog.defaults.find((v) => v.gender === variant.gender)!;
      if (alive) setPreview(composeOutfit(base, items));
    })().catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : 'Could not load outfit.');
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [catalog, equipped, build, variant, selected, attempt]);

  const choose = (slot: PartSlot, id: string): void => {
    setSelected((previous) => [...previous.filter((key) => catalog.items.find((item) => item.id === key)?.slot !== slot), ...(id ? [id] : [])]);
  };
  const controls = <section className="outfit-options" aria-label="Outfit options">
    <div className="outfit-toolbar">
      <label>Character
        <select className="styled-select" aria-label="Character" value={variant.gender} onChange={(event) => onGenderChange(event.target.value as Gender)}>
          {catalog.defaults.map((v) => <option key={v.gender} value={v.gender}>{v.label}</option>)}
        </select>
      </label>
      <button onClick={() => setSelected(initial)}>Reset outfit</button>
    </div>
    <div className="outfit-search">
      <h2>Add item</h2>
      <ItemSearch label="Outfit item" items={available} describe={describe} searchText={searchText} clearOnSelect onSelect={(item) => choose(item.slot, item.id)} />
    </div>
    <div className="outfit-slots" aria-label="Equipped items">
      {SLOTS.map(([slot, label]) => {
        const item = equipped.find((item) => item.slot === slot);
        const hidden = slot === 'weapon' && equipped.some((item) => item.slot === 'vehicle') || slot === 'glasses' && preview.hiddenSlots?.includes('glasses');
        return <section className="outfit-slot-card" key={slot} aria-label={label}>
          <h3>{label}{hidden && <small className="muted"> (hidden)</small>}</h3>
          <div className="combination-item-link">
            <Icon src={item?.icon ?? ''} size={64} className="icon-item" />
            <div><strong>{item?.name ?? (CLOTHING.has(slot) ? 'Default' : 'None')}</strong>{item && <small>{describe(item)}</small>}</div>
            {item && <button className="outfit-remove" aria-label={`Remove ${item.name}`} onClick={() => choose(slot, '')}>{CLOTHING.has(slot) ? 'Use default' : 'Remove'}</button>}
          </div>
        </section>;
      })}
    </div>
    {loading && <p role="status">Loading outfit…</p>}
    {error && <p role="alert">{error} <button onClick={() => setAttempt((n) => n + 1)}>Retry outfit</button></p>}
  </section>;

  return <div className="model-preview outfit-picker">
    <div className="outfit-view"><Suspense fallback={<p role="status">Loading viewer…</p>}>
      <ModelCanvas variant={preview.gender === variant.gender ? preview : variant} baseUrl={baseUrl} preserveView />
    </Suspense></div>
    {controls}
  </div>;
}
