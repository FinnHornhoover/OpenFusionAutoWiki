import { useMatch } from 'react-router-dom';
import { useManifest } from '../data/useManifest';
import { useBuildSwitch } from '../data/useBuildSwitch';

const PICKS: Array<{ label: string; slug: string }> = [
  { label: 'Retrobution', slug: 'retrobution' },
  { label: 'Public Original', slug: 'beta-20100104-fixed' },
  { label: 'Public Academy', slug: 'beta-20111013-fixed' },
];

export default function QuickPicks() {
  const match = useMatch('/:build/*');
  const build = match?.params.build;
  const switchBuild = useBuildSwitch();
  const { manifest, loading } = useManifest();
  if (loading || !manifest) return null;

  const known = new Set(manifest.map((b) => b.slug));
  const visible = PICKS.filter((p) => known.has(p.slug));
  if (visible.length === 0) return null;

  return (
    <nav className="quick-picks" aria-label="Featured builds">
      {visible.map((p) => (
        <button
          key={p.slug}
          type="button"
          className={'quick-pick' + (build === p.slug ? ' active' : '')}
          onClick={() => switchBuild(p.slug)}
        >
          {p.label}
        </button>
      ))}
    </nav>
  );
}
