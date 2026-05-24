import { NavLink } from 'react-router-dom';
import { useManifest } from '../data/useManifest';

const PICKS: Array<{ label: string; slug: string }> = [
  { label: 'Retrobution', slug: 'retrobution_r20' },
  { label: 'Public Original', slug: 'beta-20100104-fixed_r7_original' },
  { label: 'Public Academy', slug: 'beta-20111013-fixed_r7_academy' },
];

export default function QuickPicks() {
  const { manifest, loading } = useManifest();
  if (loading || !manifest) return null;

  const known = new Set(manifest.map((b) => b.slug));
  const visible = PICKS.filter((p) => known.has(p.slug));
  if (visible.length === 0) return null;

  return (
    <nav className="quick-picks" aria-label="Featured builds">
      {visible.map((p) => (
        <NavLink
          key={p.slug}
          to={`/${p.slug}`}
          className={({ isActive }) => 'quick-pick' + (isActive ? ' active' : '')}
        >
          {p.label}
        </NavLink>
      ))}
    </nav>
  );
}
