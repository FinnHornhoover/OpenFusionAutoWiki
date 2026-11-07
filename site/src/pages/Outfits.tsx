import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { OutfitCatalog, PreviewMeta } from '../../../shared/objects';
import OutfitPreview from '../components/OutfitPreview';
import { previewJson } from '../objects/data';
import { useBuildEntry } from '../data/useBuildEntry';
import { TITLE_SEPARATOR, useDocumentTitle } from '../data/useDocumentTitle';
import '../components/ModelPreview.css';
import './Outfits.css';

function Picker({ build, catalog, meta, initial }: { build: string; catalog: OutfitCatalog; meta: PreviewMeta; initial: string[] }) {
  const [gender, setGender] = useState(() => catalog.items.find((item) => initial.includes(item.id))?.genders[0] ?? catalog.defaults[0].gender!);
  const variant = catalog.defaults.find((v) => v.gender === gender)!;
  return <OutfitPreview initial={initial} variant={variant} build={build} baseUrl={meta.baseUrl} catalog={catalog} onGenderChange={setGender} />;
}

export default function Outfits() {
  const { build } = useParams();
  const entry = useBuildEntry(build);
  const [search] = useSearchParams();
  const seed = search.get('items') ?? '';
  const initial = useMemo(() => seed.split(',').filter((id) => /^\d+-\d+$/.test(id)), [seed]);
  const [data, setData] = useState<{ build: string; catalog: OutfitCatalog; meta: PreviewMeta } | null>(null);
  const [status, setStatus] = useState('Loading outfit choices…');
  const [attempt, setAttempt] = useState(0);
  const label = entry?.displayName ?? build;
  useDocumentTitle(`Outfit Picker${TITLE_SEPARATOR}${label ?? ''}`);

  useEffect(() => {
    let alive = true;
    setStatus('Loading outfit choices…');
    void Promise.all([
      previewJson<PreviewMeta>(`/data/${build}/previews/meta.json`),
      previewJson<OutfitCatalog>(`/data/${build}/previews/outfits.json`),
    ]).then(([meta, catalog]) => {
      if (!alive) return;
      if (meta && catalog?.defaults.length) setData({ build: build!, meta, catalog });
      else setStatus('Outfit previews are unavailable for this build.');
    });
    return () => { alive = false; };
  }, [build, attempt]);

  return <section className="outfit-page">
    <p className="breadcrumb muted"><Link to={`/${build}`}>{label}</Link></p>
    <h1>Outfit Picker</h1>
    {data && data.build === build
      ? <Picker key={`${build}/${seed}`} build={build!} catalog={data.catalog} meta={data.meta} initial={initial} />
      : <div className="placeholder"><p role="status">{status}</p>{status !== 'Loading outfit choices…' && <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>}</div>}
  </section>;
}
