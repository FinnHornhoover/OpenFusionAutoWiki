import { GFM, parser } from '@lezer/markdown';

const markdown = parser.configure(GFM);

function buildRelative(destination: string) {
  if (!destination.startsWith('/') && !/^https?:\/\//i.test(destination)) return undefined;
  let url: URL;
  try { url = new URL(destination, 'https://fusionfall.wiki'); } catch { return undefined; }
  if (!['fusionfall.wiki', 'www.fusionfall.wiki'].includes(url.host) || url.username || url.password) return undefined;
  const [, build, ...parts] = url.pathname.split('/');
  if (!/^(retrobution|beta-\d{8}(?:-fixed)?)$/.test(build)) return undefined;
  if ([...url.searchParams.keys()].some((key) => /^(?:id|entityId|npcId|itemId)$/i.test(key))) return undefined;
  const segments = parts.filter(Boolean);
  if (segments.length >= 2 && /(?:^|-)\d+$/.test(decodeRoute(segments.at(-1)!))) return undefined;
  return 'wiki-build:/' + parts.join('/') + url.search + url.hash;
}

function decodeRoute(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function optimizeWikiLinks(source: string) {
  const edits: { start: number; end: number; value: string }[] = [];
  markdown.parse(source).iterate({
    enter(node) {
      if (node.name !== 'URL') return;
      const parent = node.node.parent;
      if (!parent || parent.name === 'Image') return;

      const raw = source.slice(node.from, node.to);
      const angled = raw.startsWith('<') && raw.endsWith('>');
      const label = angled ? raw.slice(1, -1) : raw;
      const destination = buildRelative(label.startsWith('www.fusionfall.wiki/') ? 'https://' + label : label);
      if (!destination) return;

      if (parent.name === 'Link' || parent.name === 'LinkReference') {
        edits.push({ start: node.from, end: node.to, value: '<' + destination + '>' });
      } else {
        const autolink = parent.name === 'Autolink';
        const escaped = label.replace(/[\[\]\\]/g, '\\$&');
        edits.push({
          start: autolink ? parent.from : node.from,
          end: autolink ? parent.to : node.to,
          value: '[' + escaped + '](<' + destination + '>)',
        });
      }
    },
  });
  for (const { start, end, value } of edits.reverse()) source = source.slice(0, start) + value + source.slice(end);
  return source;
}
