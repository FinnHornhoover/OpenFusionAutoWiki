import { useMatch, useNavigate } from 'react-router-dom';
import { BUILD_PRESETS } from '../data/buildPresets';
import { useManifest } from '../data/useManifest';
import { useBuildSwitch } from '../data/useBuildSwitch';

export default function QuickPicks() {
  const match = useMatch('/:build/*');
  const build = match?.params.build;
  const navigate = useNavigate();
  const switchBuild = useBuildSwitch();
  const { manifest, loading } = useManifest();
  if (loading || !manifest) return null;

  const known = new Set(manifest.map((b) => b.slug));
  const visible = BUILD_PRESETS.filter((p) => known.has(p.slug));
  if (visible.length === 0) return null;

  return (
    <nav className="quick-picks" aria-label="Featured builds">
      {visible.map((p) => (
        <button
          key={p.slug}
          type="button"
          className={'quick-pick' + (build === p.slug ? ' active' : '')}
          onClick={() => {
            if (build === p.slug) {
              navigate("/" + p.slug);
            } else {
              switchBuild(p.slug);
            }
          }}
        >
          {p.label}
        </button>
      ))}
    </nav>
  );
}
