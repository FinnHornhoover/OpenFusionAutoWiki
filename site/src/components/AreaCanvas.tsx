import { useEffect, useRef, useState } from 'react';
import type { AreaPreviewRecipe } from '../../../shared/objects';
import { mountAreaViewer, type AreaViewer } from '../objects/area-viewer';

export default function AreaCanvas({ recipe, baseUrl }: { recipe: AreaPreviewRecipe; baseUrl: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const viewer = useRef<AreaViewer>();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Loading area…');
  const [error, setError] = useState('');
  const [scenery, setScenery] = useState(true);
  const [grass, setGrass] = useState(true);
  const [effects, setEffects] = useState(true);
  const [motion, setMotion] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setReady(false); setError(''); setScenery(true); setGrass(true); setEffects(true); setMotion(animate);
    void mountAreaViewer(stage.current!, recipe, baseUrl, controller.signal, (text) => { if (!controller.signal.aborted) setStatus(text); }).then((instance) => {
      if (controller.signal.aborted) { instance.dispose(); return; }
      instance.pause(!animate);
      viewer.current = instance;
      setReady(true);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load area'); });
    return () => { controller.abort(); viewer.current?.dispose(); viewer.current = undefined; };
  }, [recipe, baseUrl, attempt]);
  return <div className="model-canvas area-canvas">
    <div className="model-preview-stage" ref={stage}>{!ready && !error && <span className="model-preview-status" role="status">{status}</span>}</div>
    {error && <p role="alert">{error} <button onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>}
    {ready && <div className="area-preview-controls">
      <button onClick={() => viewer.current?.reset()}>Reset view</button>
      <button onClick={() => viewer.current?.overhead()}>From above</button>
      <button aria-pressed={scenery} onClick={() => { viewer.current?.scenery(!scenery); setScenery(!scenery); }}>Scenery</button>
      <button aria-pressed={grass} onClick={() => { viewer.current?.grass(!grass); setGrass(!grass); }}>Grass</button>
      <button aria-pressed={effects} onClick={() => { viewer.current?.effects(!effects); setEffects(!effects); }}>Effects</button>
      <button aria-pressed={motion} onClick={() => { viewer.current?.pause(motion); setMotion(!motion); }}>Motion</button>
      <p className="muted">Drag to rotate. Scroll or pinch to zoom. Right-drag or use two fingers to pan.</p>
      {recipe.missing.length > 0 && <p className="muted">Some tiles are unavailable in this client cache.</p>}
    </div>}
  </div>;
}
