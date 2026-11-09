import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { AreaPreviewRecipe, PreviewMeta, WorldPreviewRecipe } from '../../../shared/objects';
import { previewJson } from '../objects/data';
import ModelDialog from './ModelDialog';
import './ModelPreview.css';

const AreaCanvas = lazy(() => import('./AreaCanvas'));

export default function WorldPreview({ build, focus }: { build: string; focus: [number, number] }) {
  const [loaded, setLoaded] = useState<{ build: string; meta: PreviewMeta; recipe: WorldPreviewRecipe }>();
  const [active, setActive] = useState<[number, number] | null>(null);
  const title = useId(), opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let alive = true;
    setActive(null);
    void (async () => {
      const meta = await previewJson<PreviewMeta>(`/data/${build}/previews/meta.json`);
      if (!meta?.areas) return;
      const recipe = await previewJson<WorldPreviewRecipe>(`/data/${build}/previews/world.json`);
      if (alive && recipe?.tiles.length) setLoaded({ build, meta, recipe });
    })();
    return () => { alive = false; };
  }, [build]);
  const world = useMemo(() => loaded && active ? { recipe: loaded.recipe, focus: active, populationBase: `/data/${build}/previews/world/population` } : undefined, [loaded, active, build]);
  const recipe = useMemo<AreaPreviewRecipe>(() => ({ id: 'world', bounds: loaded?.recipe.bounds ?? [0, 0, 0, 0], tiles: [], missing: [] }), [loaded]);
  if (loaded?.build !== build) return null;
  return <div className="model-preview world-map-preview">
    <button ref={opener} className="model-preview-open" aria-haspopup="dialog" onClick={() => setActive([...focus])}>View world in 3D</button>
    {world && <ModelDialog titleId={title} returnFocus={opener} onClose={() => setActive(null)}>
      <div className="model-preview-heading"><h2 id={title}>World map</h2><button className="model-preview-close" aria-label="Close 3D preview" onClick={() => setActive(null)}>Close</button></div>
      <div className="model-preview-body"><Suspense fallback={<p role="status">Loading viewer…</p>}><AreaCanvas recipe={recipe} baseUrl={loaded.meta.baseUrl} populationUrl="" world={world} /></Suspense></div>
    </ModelDialog>}
  </div>;
}
