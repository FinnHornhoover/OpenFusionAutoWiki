import { useEffect } from 'react';

export const TITLE_SEPARATOR = ' · ';
const SUFFIX = 'FusionFall Wiki';

/**
 * Sets `document.title` to "<title> · FusionFall Wiki" for the lifetime of the
 * component. Falls back to the bare suffix when no title is provided yet
 * (avoids flashing the page's stale title during an entity fetch).
 *
 * This is a "cheap SEO" fix: crawlers that run JS will see per-page titles,
 * and social-share scrapers that fetch dwell-time-rendered HTML will get the
 * right preview. It does NOT help crawlers that only read the static HTML.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title}${TITLE_SEPARATOR}${SUFFIX}` : SUFFIX;
    return () => { document.title = prev; };
  }, [title]);
}
