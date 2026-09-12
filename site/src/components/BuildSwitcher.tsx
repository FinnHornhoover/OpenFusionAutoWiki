import { useMatch } from 'react-router-dom';
import { BUILD_PRESETS } from '../data/buildPresets';
import { useManifest } from '../data/useManifest';
import { useBuildSwitch } from '../data/useBuildSwitch';

const PRESET_VALUE_PREFIX = 'preset:';

export default function BuildSwitcher() {
  // This lives outside the route tree, so read the build from the current URL.
  const match = useMatch('/:build/*');
  const build = match?.params.build;
  const switchBuild = useBuildSwitch();
  const { manifest, loading, error } = useManifest();

  if (error) {
    return <span className="muted" title={error}>Builds unavailable</span>;
  }
  if (loading) {
    return <span className="muted">Loading builds…</span>;
  }
  if (!manifest || manifest.length === 0) {
    return <span className="muted">No builds yet</span>;
  }

  const known = new Set(manifest.map((entry) => entry.slug));
  const presets = BUILD_PRESETS.filter((preset) => known.has(preset.slug));

  return (
    <select
      className="styled-select build-select"
      value={build ?? ''}
      onChange={(e) => {
        const value = e.target.value;
        const slug = value.startsWith(PRESET_VALUE_PREFIX)
          ? value.slice(PRESET_VALUE_PREFIX.length)
          : value;
        switchBuild(slug);
      }}
      aria-label="Game build"
    >
      <option value="" disabled>Select build…</option>
      {presets.length > 0 && (
        <optgroup label="Preset builds">
          {presets.map((preset) => (
            <option key={preset.slug} value={PRESET_VALUE_PREFIX + preset.slug}>{preset.label}</option>
          ))}
        </optgroup>
      )}
      <optgroup label="All builds">
        {manifest.map((entry) => (
          <option key={entry.slug} value={entry.slug}>{entry.displayName}</option>
        ))}
      </optgroup>
    </select>
  );
}
