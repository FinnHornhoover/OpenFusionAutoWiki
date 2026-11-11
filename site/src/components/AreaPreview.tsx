import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import type { AreaPreviewRecipe, PreviewMeta } from '../../../shared/objects';
import { previewJson } from '../objects/data';
import ModelDialog from './ModelDialog';
import './ModelPreview.css';

const AreaCanvas = lazy(() => import('./AreaCanvas'));

export default function AreaPreview({ build, id, name }: { build?: string; id: string; name: string }) {
  const [loaded, setLoaded] = useState<{ key: string; meta: PreviewMeta; recipe: AreaPreviewRecipe } | null>(null);
  const [active, setActive] = useState('');
  const key = `${build}/${id}`;
  const title = useId();
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let alive = true;
    setActive('');
    void (async () => {
      const meta = await previewJson<PreviewMeta>(`/data/${build}/previews/meta.json`);
      if (!meta?.areas) return;
      const rows = await previewJson<Record<string, AreaPreviewRecipe>>(`/data/${build}/previews/areas/0.json`);
      if (alive && rows?.[id]) setLoaded({ key, meta, recipe: rows[id] });
    })();
    return () => { alive = false; };
  }, [build, id, key]);
  if (loaded?.key !== key) return null;
  return <div className="model-preview">
    <button ref={opener} className="model-preview-open" aria-haspopup="dialog" onClick={() => setActive(key)}>View area in 3D</button>
    {active === key && <ModelDialog titleId={title} returnFocus={opener} onClose={() => setActive('')}>
      <div className="model-preview-heading"><h2 id={title}>{name}</h2><button className="model-preview-close" aria-label="Close 3D preview" onClick={() => setActive('')}>Close</button></div>
      <div className="model-preview-body"><Suspense fallback={<p role="status">Loading viewer…</p>}><AreaCanvas recipe={loaded.recipe} baseUrl={loaded.meta.baseUrl} populationUrl={`/data/${build}/previews/population/${id}.json`} /></Suspense></div>
    </ModelDialog>}
  </div>;
}
