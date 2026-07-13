import type { BuildEntry } from "./types.js";

const PREFERRED_BUILDS = [
  "retrobution",
  "beta-20111013-fixed",
  "beta-20100104-fixed",
];

export function orderBuilds(builds: BuildEntry[]) {
  const bySlug = new Map(builds.map((build) => [build.slug, build]));
  const preferred = PREFERRED_BUILDS.map((slug) => bySlug.get(slug)).filter(
    (build): build is BuildEntry => Boolean(build),
  );
  const used = new Set(preferred.map((build) => build.slug));
  const remaining = builds
    .filter((build) => !used.has(build.slug))
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
      return a.slug.localeCompare(b.slug);
    });
  return [...preferred, ...remaining];
}

export function selectAvailableBuild(
  ordered: BuildEntry[],
  available: ReadonlySet<string>,
  requested: string,
) {
  if (available.has(requested))
    return ordered.find((build) => build.slug === requested);
  return ordered.find((build) => available.has(build.slug));
}

export function tabAnchor(build: Pick<BuildEntry, "displayName">) {
  return (
    "tabber-tab-" +
    build.displayName
      .replace(/[#[\\\]{}|<>\n\r\t/]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s/g, "_")
      .replace(/[^\w.:-]/g, "-")
  );
}
