import type { BuildEntry } from './useManifest';
import { useManifest } from './useManifest';

export function useBuildEntry(slug: string | undefined): BuildEntry | null {
  const { manifest } = useManifest();
  if (!slug || !manifest) return null;
  return manifest.find((b) => b.slug === slug) ?? null;
}

function titleCaseWords(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Heading text when the build itself is the page subject.
 *   nickname present → "Nickname" or "Nickname with Drop Fixes"
 *   nickname absent  → "officialName" (with -fixed stripped) or "officialName with Drop Fixes"
 */
export function buildPageTitle(entry: BuildEntry): string {
  let base: string;
  if (entry.nickname) {
    base = titleCaseWords(entry.nickname);
  } else {
    const raw = entry.officialName.replace(/-fixed$/, '');
    // Date-bearing names (e.g., "beta-20111013") keep their lowercase form;
    // word-only names (e.g., "retrobution") are capitalized.
    base = /\d/.test(raw) ? raw : raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return entry.fixed ? `${base} with Drop Fixes` : base;
}

/** Small explainer line under the title — gives the original name + revision. */
export function buildPageSubtitle(entry: BuildEntry): string {
  const parts = [entry.officialName];
  const m = /^r(\d+)$/i.exec(entry.rev);
  if (m) parts.push(`Revision ${m[1]}`);
  return parts.join(' · ');
}
