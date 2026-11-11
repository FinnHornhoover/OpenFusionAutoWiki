import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ModelPreview as Recipe, PreviewMeta, PreviewType } from '../../../shared/objects';
import { chunkFor } from '../data/useEntity';
import { previewJson as json, previewUrl } from '../objects/data';
import './ModelPreview.css';
import ModelDialog from './ModelDialog';

const ModelCanvas = lazy(() => import('./ModelCanvas'));

export default function ModelPreview({ build, type, id, name }: { build?: string; type: PreviewType; id: number | string; name?: string }) {
  const key = `${build}/${type}/${id}`;
  const [loaded, setLoaded] = useState<{ key: string; meta: PreviewMeta; recipe: Recipe } | null>(null);
  const [activeKey, setActiveKey] = useState('');
  const [variant, setVariant] = useState(0);
  const titleId = useId();
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    setVariant(0);
    setActiveKey('');
    if (!build) return;
    void (async () => {
      const meta = await json<PreviewMeta>(`/data/${build}/previews/meta.json`);
      if (!meta?.types.includes(type)) return;
      const chunk = chunkFor(type, String(id));
      const rows = await json<Record<string, Recipe>>(previewUrl(build, `${type}/${chunk}.json`, meta));
      const recipe = rows?.[id];
      if (alive && recipe?.variants.length) setLoaded({ key, meta, recipe });
    })();
    return () => { alive = false; };
  }, [build, type, id, key]);

  if (loaded?.key !== key) return null;
  const variants = loaded.recipe.variants;
  const gender = variants[variant].gender;
  const outfit = loaded.recipe.outfit;
  const selected = gender ? outfit?.byGender?.[gender] ?? outfit?.selected : outfit?.selected;
  const outfitUrl = `/${build}/outfits?items=${encodeURIComponent(selected?.join(',') ?? '')}${gender ? `&gender=${gender}` : ''}`;
  return (
    <div className="model-preview">
      <button ref={opener} className="model-preview-open" aria-haspopup="dialog" onClick={() => setActiveKey(key)}>View in 3D</button>
      {activeKey === key && (
        <ModelDialog titleId={titleId} returnFocus={opener} onClose={() => setActiveKey('')}>
          <div className="model-preview-heading">
            <h2 id={titleId}>{name ?? '3D preview'}</h2>
            <button className="model-preview-close" aria-label="Close 3D preview" onClick={() => setActiveKey('')}>Close</button>
          </div>
          <div className="model-preview-body">
            <Suspense fallback={<p role="status">Loading viewer…</p>}>
              <ModelCanvas key={`${key}/${variant}`} variant={variants[variant]} baseUrl={loaded.meta.baseUrl} options={<>
                {variants.length > 1 && <label>Character
                  <select className="styled-select" aria-label="Character" value={variant} onChange={(event) => setVariant(Number(event.target.value))}>
                    {variants.map((v, i) => <option key={i} value={i}>{v.label}</option>)}
                  </select>
                </label>}
                {outfit && <Link className="model-preview-action" to={outfitUrl}>Open in Outfit Picker</Link>}
              </>} />
            </Suspense>
          </div>

        </ModelDialog>
      )}
    </div>
  );
}
