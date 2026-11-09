/**
 * @file WatchOrderMapView.ts
 * @description Renders a MapLayout as an SVG relation map: cover cards on a quiet dotted
 * canvas, edges coloured by relation kind. All AniList text is set through textContent, never
 * parsed as markup. Styling lives in WatchOrderStyles (classes prefixed `au-wo-`).
 */

import { describeProgress, entryMeta, isEntryComplete, type WatchNode } from './WatchOrderGraph';
import { type MapEdge, type MapLayout, type MapNode, type NodeSize } from './WatchOrderLayout';
import { attachViewport, type MapViewport } from './WatchOrderMapViewport';
import { KIND_COLOR, KIND_LABEL, isBranchKind, type TitleKind } from './WatchOrderTheme';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CARD_RADIUS = 10;
const COVER_WIDTH = 52;
const CARD_TITLE_CHARS = 24;
const POSTER_TITLE_CHARS = 18;
const POSTER_FADE = 92;
const MAP_MIN_HEIGHT = 280;
const MAP_MAX_HEIGHT = 520;
const DOT_TILE = 24;
const DOT_COVER = 4000; // Covers everything the viewport can pan or zoom out to.

export interface MapViewOptions {
  /** First unwatched title in the current order. */
  nextId?: number | null;
  /** Minimap shown (off unless the viewer turned it on). */
  minimap?: boolean;
  onMinimapChange?: (on: boolean) => void;
  /** Kind of each title (main line or branch relation), shown on branch cards. */
  kinds?: ReadonlyMap<number, TitleKind>;
}

const viewports = new WeakMap<HTMLElement, MapViewport>();

/** Thin scrollbar that follows AniList's theme instead of the bright native one. */
export const SCROLL_STYLE =
  'scrollbar-width:thin;scrollbar-color:rgba(127,127,127,.45) transparent;';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  return element;
}

function text(
  content: string,
  attrs: Record<string, string | number>,
  className: string
): SVGTextElement {
  const element = svg('text', { ...attrs, class: className });
  element.textContent = content;
  return element;
}

/**
 * Word wrap into at most `lines` lines of `max` characters; overflow ends in an ellipsis. A
 * title that fits on two lines is split where both halves are most even, so no lone word
 * ("Season / 2") is left dangling.
 */
export function wrapTitle(title: string, max: number, lines: number): string[] {
  const clean = title.trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean ? [clean] : [];
  if (lines >= 2) {
    let best: [string, string] | null = null;
    for (let i = clean.indexOf(' '); i > 0; i = clean.indexOf(' ', i + 1)) {
      const pair: [string, string] = [clean.slice(0, i), clean.slice(i + 1)];
      if (pair[0].length > max || pair[1].length > max) continue;
      if (!best || Math.max(...pair.map((s) => s.length)) < Math.max(...best.map((s) => s.length)))
        best = pair;
    }
    if (best) return best;
  }
  const out: string[] = [];
  let rest = clean;
  while (rest && out.length < lines) {
    if (rest.length <= max) {
      out.push(rest);
      rest = '';
      break;
    }
    const cut = rest.lastIndexOf(' ', max);
    const end = cut > 0 ? cut : max;
    out.push(rest.slice(0, end));
    rest = rest.slice(end).trim();
  }
  if (rest) {
    const last = out.length - 1;
    out[last] = `${out[last].slice(0, max - 1).trimEnd()}…`;
  }
  return out;
}

function edgeKind(edge: MapEdge): TitleKind {
  return edge.kind === 'sequel'
    ? 'MAIN'
    : isBranchKind(edge.relation)
      ? edge.relation
      : 'SIDE_STORY';
}

function arrow(kind: TitleKind): SVGMarkerElement {
  const m = svg('marker', {
    id: `au-wo-arrow-${kind}`,
    viewBox: '0 0 10 10',
    refX: 8.5,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: 'auto-start-reverse',
  });
  m.append(svg('path', { d: 'M 1 1 L 9 5 L 1 9 z', fill: KIND_COLOR[kind] }));
  return m;
}

/** A quiet dot grid inside the SVG, so it pans and zooms with the map. */
function buildBackdrop(width: number, height: number): SVGGElement {
  const pattern = svg('pattern', {
    id: 'au-wo-dots',
    width: DOT_TILE,
    height: DOT_TILE,
    patternUnits: 'userSpaceOnUse',
  });
  pattern.append(svg('rect', { x: 11, y: 11, width: 2, height: 2, rx: 1, class: 'au-wo-dot' }));
  const fill = svg('rect', {
    x: -DOT_COVER,
    y: -DOT_COVER,
    width: width + 2 * DOT_COVER,
    height: height + 2 * DOT_COVER,
    fill: 'url(#au-wo-dots)',
  });
  fill.style.pointerEvents = 'none';
  const group = svg('g');
  const defs = svg('defs');
  defs.append(pattern);
  group.append(defs, fill);
  return group;
}

function checkBadge(cx: number, cy: number): SVGGElement {
  const group = svg('g', { class: 'au-wo-check' });
  group.append(
    svg('circle', { cx, cy, r: 9 }),
    svg('path', {
      d: `M ${cx - 4} ${cy + 0.5} l 2.8 2.8 l 5.2 -5.6`,
      fill: 'none',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    })
  );
  return group;
}

function progressBar(node: WatchNode, x: number, y: number, width: number): SVGGElement | null {
  if (!describeProgress(node) || !node.episodes) return null;
  const group = svg('g', { class: 'au-wo-progress' });
  const ratio = Math.min(1, node.progress / node.episodes);
  group.append(
    svg('rect', { x, y, width, height: 3, rx: 1.5, class: 'au-wo-progress-track' }),
    svg('rect', {
      x,
      y,
      width: Math.max(3, width * ratio),
      height: 3,
      rx: 1.5,
      class: 'au-wo-progress-fill',
    })
  );
  return group;
}

function coverOrPlaceholder(
  node: WatchNode,
  width: number,
  height: number,
  clipId: string,
  kind: TitleKind
): SVGElement {
  if (node.cover) {
    return svg('image', {
      href: node.cover,
      width,
      height,
      preserveAspectRatio: 'xMidYMid slice',
      'clip-path': `url(#${clipId})`,
      class: 'au-wo-node-cover',
    });
  }
  const group = svg('g', { 'clip-path': `url(#${clipId})` });
  const fill = svg('rect', { width, height, class: 'au-wo-cover-empty' });
  fill.style.fill = KIND_COLOR[kind];
  group.append(
    fill,
    text(
      node.title.trim().charAt(0).toUpperCase() || '?',
      { x: width / 2, y: height / 2 + 7, 'text-anchor': 'middle' },
      'au-wo-cover-letter'
    )
  );
  return group;
}

function metaLine(
  node: WatchNode,
  kind: TitleKind,
  x: number,
  y: number,
  className: string
): SVGTextElement {
  const line = svg('text', { x, y, class: className });
  if (kind !== 'MAIN') {
    const tag = svg('tspan', { class: 'au-wo-kind' });
    tag.style.fill = KIND_COLOR[kind];
    tag.textContent = `${KIND_LABEL[kind]} · `;
    line.append(tag);
  }
  line.append(
    document.createTextNode(
      entryMeta(node)
        .replace(/Episodes 1–(\d+)/, '$1 ep')
        .replace('Episode 1', '1 ep')
    )
  );
  return line;
}

function buildCard(
  link: SVGAElement,
  node: WatchNode,
  size: NodeSize,
  clipId: string,
  kind: TitleKind
): void {
  link.append(coverOrPlaceholder(node, COVER_WIDTH, size.height, clipId, kind));
  const lines = wrapTitle(node.title, CARD_TITLE_CHARS, 2);
  const block = lines.length * 15 + 16;
  const top = (size.height - block) / 2 + 12;
  const textX = COVER_WIDTH + 12;
  lines.forEach((line, index) => {
    link.append(text(line, { x: textX, y: top + index * 15 }, 'au-wo-node-title'));
  });
  link.append(metaLine(node, kind, textX, top + lines.length * 15 + 4, 'au-wo-node-meta'));
  const bar = progressBar(node, textX, size.height - 10, size.width - textX - 12);
  if (bar) link.append(bar);
}

function buildPoster(
  link: SVGAElement,
  node: WatchNode,
  size: NodeSize,
  clipId: string,
  kind: TitleKind
): void {
  link.append(
    coverOrPlaceholder(node, size.width, size.height, clipId, kind),
    svg('rect', {
      y: size.height - POSTER_FADE,
      width: size.width,
      height: POSTER_FADE,
      fill: 'url(#au-wo-fade)',
      'clip-path': `url(#${clipId})`,
    })
  );
  const lines = wrapTitle(node.title, POSTER_TITLE_CHARS, 2);
  lines.forEach((line, index) => {
    link.append(
      text(
        line,
        { x: 9, y: size.height - 22 - (lines.length - 1 - index) * 13 },
        'au-wo-poster-title'
      )
    );
  });
  const meta = [node.format?.replace(/_/g, ' '), node.year].filter(Boolean).join(' · ');
  link.append(text(meta, { x: 9, y: size.height - 8 }, 'au-wo-poster-meta'));
  const bar = progressBar(node, 0, size.height - 3, size.width);
  if (bar) link.append(bar);
}

function buildNode(
  item: MapNode,
  currentId: number,
  size: NodeSize,
  options: MapViewOptions
): SVGAElement {
  const { node } = item;
  const current = node.id === currentId;
  const watched = isEntryComplete(node);
  const kind = options.kinds?.get(node.id) ?? 'MAIN';
  const classes = ['au-wo-node', size.poster ? 'au-wo-node--poster' : 'au-wo-node--card'];
  if (current) classes.push('is-current');
  if (watched) classes.push('is-watched');
  const link = svg('a', {
    href: `/anime/${node.id}`,
    transform: `translate(${item.x} ${item.y})`,
    'data-au-id': node.id,
    class: classes.join(' '),
  });
  link.setAttribute('aria-label', `${node.title}${watched ? ' (watched)' : ''}`);
  if (current) {
    link.setAttribute('data-au-current', 'true');
    link.setAttribute('data-au-w', String(size.width));
    link.setAttribute('data-au-h', String(size.height));
  }
  const tooltip = svg('title');
  tooltip.textContent = [node.title, entryMeta(node, true)].filter(Boolean).join('\n');
  const clipId = `au-wo-clip-${node.id}`;
  const clip = svg('clipPath', { id: clipId });
  clip.append(svg('rect', { width: size.width, height: size.height, rx: CARD_RADIUS }));
  link.append(
    tooltip,
    clip,
    svg('rect', { width: size.width, height: size.height, rx: CARD_RADIUS, class: 'au-wo-node-bg' })
  );
  if (size.poster) buildPoster(link, node, size, clipId, kind);
  else buildCard(link, node, size, clipId, kind);
  link.append(
    svg('rect', {
      width: size.width,
      height: size.height,
      rx: CARD_RADIUS,
      fill: 'none',
      class: 'au-wo-node-frame',
    })
  );
  if (watched) link.append(checkBadge(13, 13));
  return link;
}

function buildEdge(edge: MapEdge, index: number): SVGPathElement {
  const kind = edgeKind(edge);
  const path = svg('path', {
    d: edge.path,
    'data-au-edge': index,
    'data-au-kind': kind,
    class: 'au-wo-edge',
    fill: 'none',
    stroke: KIND_COLOR[kind],
    'marker-end': `url(#au-wo-arrow-${kind})`,
  });
  if (kind !== 'MAIN') path.setAttribute('stroke-dasharray', kind === 'SUMMARY' ? '2 5' : '6 5');
  const tooltip = svg('title');
  tooltip.textContent = KIND_LABEL[kind];
  path.append(tooltip);
  return path;
}

/** Height of the map viewport for a layout: tall enough for its controls, never a wall. */
export function mapHeight(layout: MapLayout): number {
  return Math.round(Math.min(MAP_MAX_HEIGHT, Math.max(MAP_MIN_HEIGHT, layout.height)));
}

/** Pannable, zoomable map of the franchise. */
export function buildMapView(
  layout: MapLayout,
  currentId: number,
  options: MapViewOptions = {}
): HTMLElement {
  const root = svg('svg', {
    width: layout.width,
    height: layout.height,
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    class: 'au-wo-svg',
  });
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Franchise relation map');
  const defs = svg('defs');
  const fade = svg('linearGradient', { id: 'au-wo-fade', x1: 0, y1: 0, x2: 0, y2: 1 });
  fade.append(
    fadeStop('0', 0),
    fadeStop('0.55', 0.82),
    fadeStop('1', 0.96)
  );
  const kinds = new Set(layout.edges.map(edgeKind));
  defs.append(fade, ...[...kinds].map(arrow));
  root.append(defs, buildBackdrop(layout.width, layout.height));

  const edgeLayer = svg('g', { class: 'au-wo-edges' });
  layout.edges.forEach((edge, index) => edgeLayer.append(buildEdge(edge, index)));
  const nodeLayer = svg('g', { class: 'au-wo-nodes' });
  for (const item of layout.nodes)
    nodeLayer.append(buildNode(item, currentId, layout.size, options));
  root.append(edgeLayer, nodeLayer);

  // The SVG fills a fixed-height viewport and is moved by pan/zoom (see WatchOrderMapViewport).
  const host = document.createElement('div');
  host.className = 'au-watchorder-map au-wo-map';
  host.style.height = `${mapHeight(layout)}px`;
  host.append(root);
  viewports.set(
    host,
    attachViewport(host, root, layout, layout.edges, {
      minimap: options.minimap,
      onMinimapChange: options.onMinimapChange,
    })
  );

  const wrapper = document.createElement('div');
  wrapper.className = 'au-wo-map-wrap';
  wrapper.append(host);
  return wrapper;
}

/** Release the viewports of every map inside `container` before it is emptied or removed. */
export function disposeMaps(container: ParentNode): void {
  container.querySelectorAll<HTMLElement>('.au-watchorder-map').forEach((host) => {
    viewports.get(host)?.dispose();
    viewports.delete(host);
  });
}

/** Frame the map once it is attached to the page: whole map if readable, else the current title. */
export function centerOnCurrent(wrapper: HTMLElement): void {
  const host = wrapper.querySelector<HTMLElement>('.au-watchorder-map');
  const current = wrapper.querySelector<SVGGraphicsElement>('[data-au-current]');
  const viewport = host && viewports.get(host);
  if (!viewport) return;
  viewport.sync();
  const match = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(current?.getAttribute('transform') ?? '');
  const width = Number(current?.getAttribute('data-au-w'));
  const height = Number(current?.getAttribute('data-au-h'));
  if (match) viewport.focus(Number(match[1]) + width / 2, Number(match[2]) + height / 2);
  else viewport.fit();
}

/** Gradient stop in the page background colour (a CSS variable, so it follows AniList's theme). */
function fadeStop(offset: string, opacity: number): SVGElement {
  const stop = svg('stop', { offset });
  stop.setAttribute(
    'style',
    `stop-color:rgb(var(--color-background, 11, 22, 34));stop-opacity:${opacity}`
  );
  return stop;
}
