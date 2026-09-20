import Currency from '../components/Currency';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import EntityLink from '../components/EntityLink';
import Icon from '../components/Icon';
import ErrorState from '../components/ErrorState';
import { combinationCostPercentile, compatible, optimizeCombination, statsDonor } from '../data/combinations';
import type { CombinationData, CombinationItem, CombinationStep } from '../data/combinations';
import { useBuildEntry } from '../data/useBuildEntry';
import { useBuildMeta } from '../data/useBuildMeta';
import { useIndex } from '../data/useIndex';
import { TITLE_SEPARATOR, useDocumentTitle } from '../data/useDocumentTitle';

const rarities = ['Common', 'Uncommon', 'Rare', 'Ultra Rare'];
const money = (value: number) => <Currency amount={Math.ceil(value)} />;
const itemRef = (item: CombinationItem) => ({ type: 'item' as const, id: item.id, name: item.name, icon: item.icon });
const itemType = (item: CombinationItem) => item.typeId === 0 ? item.weaponType : ['Weapon', 'Body', 'Legs', 'Shoes'][item.typeId];
const itemLabel = (item: CombinationItem) => item.name + ' — Lv' + item.level + ' ' + item.rarity + ' · ' + itemType(item) + ' · ' + item.gender + (item.obtainable ? '' : ' · Unobtainable');

function CombinationItemLink({ item, combined = false, showMeta = false, iconSize = 96, separateIcon = false }: { item: CombinationItem; combined?: boolean; showMeta?: boolean; iconSize?: number; separateIcon?: boolean }) {
  if (!separateIcon) return <div className="combination-item-link"><EntityLink entity={itemRef(item)} iconSize={iconSize} /></div>;
  return <div className="combination-item-link">
    <div className="combination-preview-icon" style={{ flexBasis: iconSize }}>
      <Icon src={item.icon} alt={item.name} size={iconSize} className="icon-item" />
      {combined && <img className="combination-badge" src="/ui/combined_item_icon.png" alt="Combined" />}
    </div>
    <div><EntityLink entity={itemRef(item)} withIcon={false} />
      {showMeta && <small className="muted">Lv {item.level} {item.rarity} {itemType(item)}</small>}
      {!item.obtainable && <small className="muted">Unobtainable</small>}
    </div>
  </div>;
}

function StatIcons({ item, available = true }: { item: CombinationItem; available?: boolean }) {
  const size = 64;
  return <dl className="combination-stat-preview" aria-label={item.name + ' stats'} aria-live="polite">
    {[
      { icon: 'item_vs_one.png', label: 'Single-target damage', value: item.singleDamage },
      { icon: 'item_vs_many.png', label: 'Multi-target damage', value: item.multiDamage },
      { icon: 'item_defense.png', label: 'Defense', value: item.defense },
    ].map(stat => <div key={stat.icon}>
      <dt><img src={'/ui/' + stat.icon} alt={stat.label} title={stat.label} width={size} height={size} /></dt>
      <dd>{available ? stat.value.toLocaleString() : '—'}</dd>
    </div>)}
  </dl>;
}

function StylePicker({ items, selected, onSelect }: { items: CombinationItem[]; selected: CombinationItem; onSelect: (item: CombinationItem) => void }) {
  const [query, setQuery] = useState(selected.name);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    const tokens = text.split(/\s+/).filter(Boolean);
    return items.filter(item => tokens.every(token => itemLabel(item).toLowerCase().includes(token)))
      .map(item => ({ item, score: !text ? (item.id === selected.id ? 0 : 1) : item.name.toLowerCase() === text ? 0 : item.name.toLowerCase().startsWith(text) ? 1 : item.name.toLowerCase().includes(text) ? 2 : 3 }))
      .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
      .slice(0, 50).map(match => match.item);
  }, [items, query, selected.id]);
  useEffect(() => {
    if (open) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);
  function choose(item: CombinationItem) {
    setQuery(item.name);
    setOpen(false);
    onSelect(item);
  }
  return <div className="combination-picker" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(selected.name); }
  }}>
    <input id="combination-search" role="combobox" aria-label="Style item" aria-autocomplete="list"
      aria-expanded={open} aria-controls="combination-options" aria-activedescendant={open && matches[active] ? 'combination-option-' + matches[active].id : undefined}
      autoComplete="off" placeholder="Search items" value={query}
      onFocus={() => { setQuery(''); setActive(0); setOpen(true); }}
      onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          setActive(value => Math.max(0, Math.min(matches.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1))));
        } else if (event.key === 'Enter' && open && matches[active]) { event.preventDefault(); choose(matches[active]); }
        else if (event.key === 'Escape') { setOpen(false); setQuery(selected.name); }
      }} />
    {open && <div className="combination-options" id="combination-options" role="listbox" aria-label="Matching style items" ref={list}>
      {matches.map((item, index) => <button type="button" role="option" tabIndex={-1} id={'combination-option-' + item.id}
        aria-selected={selected.id === item.id} data-active={active === index} key={item.id}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}>
        <Icon src={item.icon} size={64} className="icon-item" />
        <span><strong>{item.name}</strong><small>Lv{item.level} · {item.rarity} · {itemType(item)} · {item.gender}{!item.obtainable && ' · Unobtainable'}</small></span>
      </button>)}
      {!matches.length && <p role="status">No matching items.</p>}
    </div>}
  </div>;
}

function StepCard({ step: originalStep, number, style }: { step: CombinationStep; number: number; style: CombinationItem }) {
  const [selection, setSelection] = useState<{ source: CombinationStep; id: string } | null>(null);
  const choices = [originalStep, ...(originalStep.alternatives ?? [])];
  const step = choices.find(choice => selection?.source === originalStep && choice.item.id === selection.id) ?? originalStep;
  const alternatives = choices.filter(choice => choice.item.id !== step.item.id);
  return <li><details className="combination-step">
    <summary>
      <span className="combination-step-number">{number}</span>
      <span className="combination-step-pair">
        <span className="combination-step-item">
          <span className="combination-step-icon"><Icon src={style.icon} size={64} className="icon-item" />{number > 1 && <img className="combination-badge" src="/ui/combined_item_icon.png" alt="Combined" />}</span>
          <span><strong>{style.name}</strong><small>Lv {step.from.level} {number > 1 ? 'Special' : style.rarity}</small></span>
        </span>
        <svg className="combination-step-arrow" viewBox="0 0 48 24" role="img" aria-label="receives stats from">
          <path className="mission-task-arrow mission-task-arrow-end" d="M 46 12 H 18" />
          <path className="mission-task-arrow-head-end" d="M 2 12 L 22 2 L 22 22 Z" />
        </svg>
        <span className="combination-step-item">
          <Icon src={step.item.icon} size={64} className="icon-item" />
          <span><strong>{step.item.name}</strong><small>Lv {step.item.level} {step.item.rarity}</small>{Boolean(alternatives.length) && <small>({alternatives.length} {alternatives.length === 1 ? 'alternative' : 'alternatives'})</small>}</span>
        </span>
      </span>
      <span className="combination-step-total"><strong>{money(step.total)}</strong><small>{(step.probability * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}% success</small></span>
      <span className="combination-step-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div className="combination-step-details">
      <CombinationItemLink item={step.item} iconSize={64} />
      <StatIcons item={step.item} />
      <dl className="combination-costs">
        <dt>Item cost{step.ignoreObtainCost && <small>Excluded from total</small>}</dt><dd>{money(step.item.obtainCost)}<small>{step.item.priceSource === 'player' ? 'Player price' : step.item.priceSource === 'vendor' ? 'Cheapest vendor' : 'Estimated price'}</small></dd>
        <dt>Combine cost per attempt</dt><dd>{money(step.fee)}</dd>
        <dt>Expected combine cost</dt><dd>{money(step.expectedFee)}<small>{(1 / step.probability).toLocaleString(undefined, { maximumFractionDigits: 2 })} attempts on average</small></dd>
        <dt>Expected total</dt><dd><strong>{money(step.total)}</strong></dd>
      </dl>
      {step.item.vendor && <div className="combination-vendor">Buy from <EntityLink entity={step.item.vendor} iconSize={48} /></div>}
      {Boolean(alternatives.length) && <div className="combination-alternatives">
        <h4>Equally viable items</h4>
        <ul>{alternatives.map(alternative => <li key={alternative.item.id}>
          <button type="button" className="combination-alternative-choice" onClick={() => setSelection({ source: originalStep, id: alternative.item.id })} aria-label={'Use ' + alternative.item.name}>
            <span className="combination-item-link"><Icon src={alternative.item.icon} size={64} className="icon-item" /><strong>{alternative.item.name}</strong></span>
            <span className="combination-cost-breakdown">
              <span>Item cost{alternative.ignoreObtainCost && ' (excluded)'}</span><span>{money(alternative.item.obtainCost)}</span>
              <span>Expected combine cost</span><span>{money(alternative.expectedFee)}</span>
            </span>
          </button>
        </li>)}</ul>
      </div>}
    </div>
  </details></li>;
}

function CostBreakdown({ steps }: { steps: CombinationStep[] }) {
  const obtainCost = steps.reduce((total, step) => total + (step.ignoreObtainCost ? 0 : step.item.obtainCost), 0);
  const attemptCost = steps.reduce((total, step) => total + step.expectedFee, 0);
  const excluded = steps.some(step => step.ignoreObtainCost);
  return <dl className="combination-cost-breakdown">
    <dt>Item cost{excluded && ' (excluded)'}</dt><dd>{money(obtainCost)}</dd>
    <dt>Expected combine cost</dt><dd>{money(attemptCost)}</dd>
  </dl>;
}

function Calculator({ data, academyLevelZeroBonus }: { data: CombinationData; academyLevelZeroBonus: boolean }) {
  const [params, setParams] = useSearchParams();
  const style = data.items.find(item => item.id === params.get('style')) ?? data.items.find(item => item.obtainable) ?? data.items[0];
  const [targetLevel, setTargetLevel] = useState<number | null>(null);
  const [targetRarity, setTargetRarity] = useState(4);
  const [ignoreObtainCost, setIgnoreObtainCost] = useState(false);
  const [priceLimitInput, setPriceLimitInput] = useState('40000');
  const [allowedRarities, setAllowedRarities] = useState<number[]>([1, 2, 3, 4]);
  const rarityDropdown = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: Event) => {
      const dropdown = rarityDropdown.current;
      if (dropdown && event.target instanceof Node && !dropdown.contains(event.target)) dropdown.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
    };
  }, []);
  const priceLimit = priceLimitInput === '' ? null : Math.max(0, Number(priceLimitInput));
  const candidates = useMemo(() => style ? data.items.filter(item => statsDonor(item) && compatible(style, item)) : [], [data, style]);
  const levels = useMemo(() => [...new Set(candidates.map(item => item.level))].sort((a, b) => a - b), [candidates]);
  const level = targetLevel !== null && levels.includes(targetLevel) ? targetLevel : levels.at(-1) ?? 0;
  const availableRarities = [...new Set(candidates.filter(item => item.level === level).map(item => item.rarityId))].sort();
  const rarity = availableRarities.includes(targetRarity) ? targetRarity : availableRarities.at(-1) ?? 1;
  const result = useMemo(() => style && candidates.length ? optimizeCombination(data, style, level, rarity, { ignoreObtainCost, priceLimit, allowedRarities, academyLevelZeroBonus }) : null, [data, style, candidates, level, rarity, ignoreObtainCost, priceLimit, allowedRarities, academyLevelZeroBonus]);
  const luckCosts = useMemo(() => result ? {
    multi: combinationCostPercentile(result.steps, 0.75),
    direct: result.direct ? combinationCostPercentile([result.direct], 0.25) : null,
  } : null, [result]);
  if (!style) return <p>No combinable items are available.</p>;
  const finalItem = result?.steps.at(-1)?.item ?? style;
  return <>
    <div className="combination-controls">
      <section className="combination-section" aria-labelledby="combination-style-heading">
        <h2 id="combination-style-heading">Style</h2>
        <StylePicker key={style.id} items={data.items} selected={style} onSelect={item => setParams({ style: item.id }, { replace: true })} />
        <div className="combination-preview">
          <CombinationItemLink item={style} combined={Boolean(result?.steps.length)} showMeta separateIcon />
        </div>
      </section>
      <section className="combination-section" aria-labelledby="combination-stats-heading">
        <h2 id="combination-stats-heading">Stats</h2>
        <StatIcons item={finalItem} available={Boolean(result)} />
        <div className="combination-target-controls">
          <label>Level<select className="styled-select" id="combination-level" value={level} disabled={!levels.length} onChange={event => setTargetLevel(Number(event.target.value))}>
            {levels.map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label>Rarity<select className="styled-select" id="combination-rarity" value={rarity} disabled={!availableRarities.length} onChange={event => setTargetRarity(Number(event.target.value))}>
            {availableRarities.map(value => <option key={value} value={value}>{rarities[value - 1]}</option>)}
          </select></label>
        </div>
      </section>
      <section className="combination-section" aria-labelledby="combination-options-heading">
        <h2 id="combination-options-heading">Options for Intermediate Items</h2>
        <div className="combination-option-controls">
          <label>Price limit<input type="number" min="0" step="1" placeholder="No limit" value={priceLimitInput} onChange={event => setPriceLimitInput(event.target.value)} /></label>
          <div className="combination-rarity-control">
            <span id="combination-allowed-rarities-label">Allowed rarities</span>
            <details ref={rarityDropdown} className="combination-rarity-dropdown" onKeyDown={event => {
              if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
            }}>
              <summary className="styled-select" aria-labelledby="combination-allowed-rarities-label combination-rarity-selection"><span id="combination-rarity-selection">{allowedRarities.length === 4 ? 'All rarities' : allowedRarities.length === 0 ? 'None' : allowedRarities.length === 1 ? rarities[allowedRarities[0] - 1] : allowedRarities.length + ' selected'}</span></summary>
              <div className="combination-rarity-options combination-settings" role="group" aria-labelledby="combination-allowed-rarities-label">
                {rarities.map((name, index) => <label key={name}><input type="checkbox" checked={allowedRarities.includes(index + 1)} onChange={event => {
                  const checked = event.currentTarget.checked;
                  setAllowedRarities(values => checked ? [...new Set([...values, index + 1])].sort() : values.filter(value => value !== index + 1));
                }} />{name}</label>)}
              </div>
            </details>
          </div>
        </div>
        <div className="combination-settings">
          <label><input type="checkbox" checked={ignoreObtainCost} onChange={event => setIgnoreObtainCost(event.target.checked)} />Disregard stat item obtain cost</label>
        </div>
      </section>
    </div>
    <section className="combination-section" aria-labelledby="combination-comparison-heading">
      <h2 id="combination-comparison-heading">Comparison</h2>
      {!result ? <p role="status">No obtainable combination path for this target.</p> : <>
        <div className="combination-comparison" aria-live="polite">
          <div className="combination-summary"><span>Multi-Step Expected Cost</span><div className="combination-total"><strong>{money(result.total)}</strong>{result.direct && <span className="combination-savings"> (saves {money(Math.max(0, result.direct.total - result.total))})</span>}</div><CostBreakdown steps={result.steps} /><div className="combination-luck-cost" title="Estimated 75th percentile of total cost across the complete route"><span>Bottom 25% luck</span><span>≈ {money(luckCosts!.multi)}</span></div><small>{result.steps.length} {result.steps.length === 1 ? 'step' : 'steps'}</small></div>
          <div className="combination-summary"><span>Direct Expected Cost</span><strong>{result.direct ? money(result.direct.total) : 'Unavailable'}</strong>{result.direct && <><CostBreakdown steps={[result.direct]} /><div className="combination-luck-cost" title="25th percentile of total cost for the direct combination"><span>Top 25% luck</span><span>{money(luckCosts!.direct!)}</span></div></>}<small>1 step</small></div>
        </div>
      </>}
    </section>
    <section className="combination-section" aria-labelledby="combination-multi-heading">
      <h2 id="combination-multi-heading">Multi-Step</h2>
      {result?.steps.length ? <ol className="combination-steps">{result.steps.map((step, index) => <StepCard key={step.from.id + ':' + step.item.id} step={step} style={style} number={index + 1} />)}</ol>
        : <p className="muted">{result ? 'Already at the target stats.' : 'No available path.'}</p>}
    </section>
    <section className="combination-section" aria-labelledby="combination-direct-heading">
      <h2 id="combination-direct-heading">Direct</h2>
      {result?.direct ? <ol className="combination-steps"><StepCard key={result.direct.from.id + ':' + result.direct.item.id} step={result.direct} style={style} number={1} /></ol>
        : <p className="muted">No obtainable direct combination.</p>}
    </section>
  </>;
}

export default function Combinations() {
  const { build } = useParams();
  const entry = useBuildEntry(build);
  const meta = useBuildMeta(build);
  const supported = meta?.builtTypes.includes('combinations') ?? false;
  const { rows, loading, error } = useIndex<CombinationData>(supported ? build : undefined, supported ? 'combinations' : undefined);
  const academyLevelZeroBonus = Boolean(entry?.date && entry.date >= '2011-02-13');
  const calculatorData = useMemo(() => rows?.[0] ? {
    ...rows[0], items: rows[0].items.map(item => ({ ...item, level: item.level ?? 0 })),
  } : null, [rows]);
  const label = entry?.displayName ?? build;
  useDocumentTitle('Combination Calculator' + TITLE_SEPARATOR + (label ?? ''));
  return <section className="combination-page">
    <p className="breadcrumb muted"><Link to={'/' + build}>{label}</Link></p>
    <h1>Combination Calculator</h1>
    {(!meta || loading) && <p role="status">Loading combination data…</p>}
    {meta && !supported && <p>Combination data is not available for this build.</p>}
    {error && <ErrorState title="Couldn't load combination data" message="The calculator data failed to load." detail={error} />}
    {calculatorData && <Calculator key={build} data={calculatorData} academyLevelZeroBonus={academyLevelZeroBonus} />}
  </section>;
}
