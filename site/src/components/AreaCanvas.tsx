import { useEffect, useRef, useState } from 'react';
import type { AreaPreviewRecipe, PopulationKind } from '../../../shared/objects';
import type { PopulationSelection } from '../objects/area-population';
import { mountAreaViewer, type AreaViewer } from '../objects/area-viewer';
import { mountWorldViewer, type WorldView } from '../objects/world-viewer';
import PreviewOptionsButton from './PreviewOptionsButton';

export default function AreaCanvas({ recipe, baseUrl, populationUrl, world }: { recipe: AreaPreviewRecipe; baseUrl: string; populationUrl: string; world?: WorldView }) {
  const stage = useRef<HTMLDivElement>(null);
  const viewer = useRef<AreaViewer>();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Loading area…');
  const [error, setError] = useState('');
  const [scenery, setScenery] = useState(true);
  const [grass, setGrass] = useState(true);
  const [effects, setEffects] = useState(true);
  const [motion, setMotion] = useState(true);
  const [population, setPopulation] = useState<Record<PopulationKind, boolean>>({ npcs: true, monsters: true, eggs: true });
  const [selection, setSelection] = useState<PopulationSelection | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPopulation({ npcs: true, monsters: true, eggs: true }); setSelection(null);
    const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setReady(false); setError(''); setScenery(!world || !matchMedia('(max-width: 600px)').matches); setGrass(!world); setEffects(!world); setMotion(animate);
    const onStatus = (text: string): void => { if (!controller.signal.aborted) setStatus(text); };
    const onSelection = (value: PopulationSelection | null): void => { if (!controller.signal.aborted) setSelection(value); };
    const mounted = world ? mountWorldViewer(stage.current!, world, baseUrl, controller.signal, onStatus, onSelection)
      : mountAreaViewer(stage.current!, recipe, baseUrl, controller.signal, onStatus, populationUrl, onSelection);
    void mounted.then((instance) => {
      if (controller.signal.aborted) { instance.dispose(); return; }
      instance.pause(!animate);
      viewer.current = instance;
      setReady(true);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load area'); });
    return () => { controller.abort(); viewer.current?.dispose(); viewer.current = undefined; };
  }, [recipe, baseUrl, populationUrl, world, attempt]);
  return <div className={`model-canvas area-canvas${ready ? ' model-canvas-ready' : ''}`}>
    <div className="model-preview-stage" ref={stage}>
      {!ready && !error && <span className="model-preview-status" role="status">{status}</span>}
      {ready && <PreviewOptionsButton />}
    </div>
    {error && <p role="alert">{error} <button onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>}
    {ready && <section className="model-preview-controls area-preview-controls" aria-label="3D viewing options">
      {world && <label className="world-area-select">Go to area
        <select className="styled-select" value="" onChange={(event) => {
          const area = world.recipe.areas.find((area) => area.id === event.target.value);
          if (area) viewer.current?.focus?.((area.bounds[0] + area.bounds[2]) / 2, (area.bounds[1] + area.bounds[3]) / 2);
        }}><option value="">Choose area…</option>{world.recipe.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select>
      </label>}
      <button onClick={() => viewer.current?.reset()}>Reset view</button>
      <button onClick={() => viewer.current?.overhead()}>From above</button>
      <button aria-pressed={scenery} onClick={() => { viewer.current?.scenery(!scenery); setScenery(!scenery); }}>Scenery</button>
      <button aria-pressed={grass} onClick={() => { viewer.current?.grass(!grass); setGrass(!grass); }}>Grass</button>
      <button aria-pressed={effects} onClick={() => { viewer.current?.effects(!effects); setEffects(!effects); }}>Effects</button>
      <button aria-pressed={motion} onClick={() => { viewer.current?.pause(motion); setMotion(!motion); }}>Motion</button>
      {(['npcs', 'monsters', 'eggs'] as const).map((kind) => <button key={kind} aria-pressed={population[kind]} onClick={() => { viewer.current?.population(kind, !population[kind]); setPopulation((values) => ({ ...values, [kind]: !values[kind] })); }}>{kind === 'npcs' ? 'NPCs' : kind === 'monsters' ? 'Monsters' : 'Eggs'}</button>)}
      {selection && <p role="status">{selection.name}{selection.unavailable ? ' · Model unavailable' : selection.loading ? ' · Loading model…' : ''}</p>}
      {world && <p className="muted" role="status">{status}</p>}
      <p className="muted">Drag to rotate. Scroll or pinch to zoom. Right-drag or use two fingers to pan. Tap a marker to focus.</p>
      {recipe.missing.length > 0 && <p className="muted">Some tiles are unavailable in this client cache.</p>}
    </section>}
  </div>;
}
