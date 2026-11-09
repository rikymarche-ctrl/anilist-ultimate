/**
 * @file WatchOrderMapViewport.ts
 * @description Pan, zoom, minimap and hover-highlight for the relation map. The SVG is moved by
 * rewriting its viewBox, so no extra library is needed.
 *
 * Over the map the wheel zooms (a trackpad pinch arrives the same way); sideways swipes and
 * Shift + wheel pan. The buttons, double-click and the keyboard zoom as well.
 */

import { icon } from './WatchOrderTheme';

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ContentSize {
  width: number;
  height: number;
}

interface MiniNode {
  x: number;
  y: number;
  node: { id: number };
}

/** What the viewport needs from a layout; nodes and size feed the minimap when present. */
export interface ViewportContent extends ContentSize {
  nodes?: readonly MiniNode[];
  size?: { width: number; height: number };
}

const MIN_ZOOM = 4; // Content can be magnified up to 4x its own width...
const MAX_SCALE = 2.2; // ...but never beyond 2.2 screen pixels per map unit.
const MAX_ZOOM_OUT = 1.25; // Shrink until the whole map is 1/1.25 of the view.
/** Below this, fitting the whole map makes titles too small to read; frame the current title. */
const READABLE_FIT_SCALE = 0.72;
const WHEEL_SENSITIVITY = 0.0018;
const BUTTON_STEP = 1.3;
const DOUBLE_CLICK_STEP = 1.6;
const KEY_PAN_PX = 90;
const DRAG_THRESHOLD_PX = 4;
const DIMMED_OPACITY = '0.18';
const ANIMATION_MS = 220;
const MINIMAP_WIDTH = 150;
const MINIMAP_MAX_HEIGHT = 80;

/** Viewbox showing the whole content, filling the viewport width (or height if that is smaller). */
export function fitViewBox(content: ContentSize, viewportW: number, viewportH: number): ViewBox {
  if (viewportW <= 0 || viewportH <= 0) return { x: 0, y: 0, w: content.width, h: content.height };
  const scale = content.width / viewportW;
  const h = viewportH * scale;
  // Shorter maps are centred vertically; taller ones start at the top.
  return { x: 0, y: Math.min(0, (content.height - h) / 2), w: content.width, h };
}

/** Viewbox showing the whole content at once, centred (what the "fit to view" button restores). */
export function containViewBox(
  content: ContentSize,
  viewportW: number,
  viewportH: number
): ViewBox {
  if (viewportW <= 0 || viewportH <= 0) return { x: 0, y: 0, w: content.width, h: content.height };
  const scale = Math.max(content.width / viewportW, content.height / viewportH);
  const w = viewportW * scale;
  const h = viewportH * scale;
  return { x: (content.width - w) / 2, y: (content.height - h) / 2, w, h };
}

/** Keep at least part of the content in view while panning. */
export function clampViewBox(box: ViewBox, content: ContentSize): ViewBox {
  const x = Math.min(Math.max(box.x, -box.w / 2), content.width - box.w / 2);
  const y = Math.min(Math.max(box.y, -box.h / 2), content.height - box.h / 2);
  return { ...box, x, y };
}

/**
 * Zoom by `factor` keeping the point at fractions (fx, fy) of the viewport fixed. `minWidth`
 * caps magnification (defaults to a quarter of the content width).
 */
export function zoomViewBox(
  box: ViewBox,
  factor: number,
  fx: number,
  fy: number,
  fitted: ViewBox,
  content: ContentSize,
  minWidth = content.width / MIN_ZOOM
): ViewBox {
  const w = Math.min(
    Math.max(box.w / factor, minWidth),
    Math.max(minWidth, fitted.w * MAX_ZOOM_OUT)
  );
  const ratio = w / box.w;
  const h = box.h * ratio;
  return clampViewBox({ x: box.x + fx * (box.w - w), y: box.y + fy * (box.h - h), w, h }, content);
}

/** Centre one axis on `centre` at viewport length `view`, keeping the content edge-to-edge. */
function frameAxis(length: number, view: number, centre: number): number {
  if (length <= view) return (length - view) / 2;
  return Math.min(Math.max(centre - view / 2, 0), length - view);
}

/**
 * Opening frame: the whole map when it reads well at that size (never magnified past 1:1),
 * otherwise 1:1 around (cx, cy), the current title.
 */
export function frameViewBox(
  content: ContentSize,
  viewportW: number,
  viewportH: number,
  cx: number,
  cy: number
): ViewBox {
  if (viewportW <= 0 || viewportH <= 0) return { x: 0, y: 0, w: content.width, h: content.height };
  const fitScale = Math.min(viewportW / content.width, viewportH / content.height);
  if (fitScale >= 1) {
    return {
      x: (content.width - viewportW) / 2,
      y: (content.height - viewportH) / 2,
      w: viewportW,
      h: viewportH,
    };
  }
  if (fitScale >= READABLE_FIT_SCALE) return containViewBox(content, viewportW, viewportH);
  return {
    x: frameAxis(content.width, viewportW, cx),
    y: frameAxis(content.height, viewportH, cy),
    w: viewportW,
    h: viewportH,
  };
}

/** Ids of a title and of everything it is directly connected to. */
export function neighbourhood(
  edges: ReadonlyArray<{ from: number; to: number }>,
  id: number
): { nodes: Set<number>; edges: Set<number> } {
  const nodes = new Set([id]);
  const touching = new Set<number>();
  edges.forEach((edge, index) => {
    if (edge.from !== id && edge.to !== id) return;
    touching.add(index);
    nodes.add(edge.from);
    nodes.add(edge.to);
  });
  return { nodes, edges: touching };
}

export interface MapViewport {
  fit(): void;
  focus(worldX: number, worldY: number): void;
  /** Re-apply the full screen layout (a freshly built map inside a full screen root). */
  sync(): void;
  /** Remove document-level listeners and observers; call before the map is replaced. */
  dispose(): void;
}

const reducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/** Wire pan, zoom, controls, minimap and hover highlight onto a rendered map. */
export function attachViewport(
  host: HTMLElement,
  svgEl: SVGSVGElement,
  content: ViewportContent,
  edges: ReadonlyArray<{ from: number; to: number }>,
  options: { minimap?: boolean; onMinimapChange?: (on: boolean) => void } = {}
): MapViewport {
  let showMinimap = options.minimap ?? false;
  let box: ViewBox = { x: 0, y: 0, w: content.width, h: content.height };
  let fitted = box;
  let dragged = false;
  let animation = 0;
  // One signal for every listener and observer, so a replaced map leaves nothing behind.
  const lifetime = new AbortController();
  const { signal } = lifetime;

  const size = () => ({ w: host.clientWidth, h: host.clientHeight });
  const isFullscreen = () => !!document.fullscreenElement?.contains(host);
  const minWidth = () => Math.min(content.width / MIN_ZOOM, size().w / MAX_SCALE || Infinity);

  const minimap = buildMinimap(content, svgEl);
  const controls = buildControls(!!minimap);
  host.append(controls.bar, ...(minimap ? [minimap.element] : []));

  const apply = () => {
    svgEl.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
    const { w } = size();
    controls.setZoom(w ? w / box.w : 1);
    if (minimap) {
      const whole =
        box.x <= 0.5 &&
        box.y <= 0.5 &&
        box.x + box.w >= content.width - 0.5 &&
        box.y + box.h >= content.height - 0.5;
      minimap.element.classList.toggle('is-hidden', whole || !showMinimap);
      controls.setMinimap(showMinimap);
      minimap.update(box);
    }
  };
  const set = (next: ViewBox, animate = false) => {
    cancelAnimationFrame(animation);
    if (!animate || reducedMotion()) {
      box = next;
      apply();
      return;
    }
    const from = box;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ANIMATION_MS);
      const k = easeOut(t);
      box = {
        x: from.x + (next.x - from.x) * k,
        y: from.y + (next.y - from.y) * k,
        w: from.w + (next.w - from.w) * k,
        h: from.h + (next.h - from.h) * k,
      };
      apply();
      if (t < 1) animation = requestAnimationFrame(step);
    };
    animation = requestAnimationFrame(step);
  };
  const refit = () => {
    const { w, h } = size();
    fitted = containViewBox(content, w, h);
  };
  const fit = (animate = false) => {
    refit();
    set(fitted, animate);
  };
  const zoom = (factor: number, fx = 0.5, fy = 0.5, animate = false) => {
    // A hidden host has no size: the pointer fractions would be NaN and poison the viewBox.
    if (!Number.isFinite(factor) || !Number.isFinite(fx) || !Number.isFinite(fy)) return;
    set(zoomViewBox(box, factor, fx, fy, fitted, content, minWidth()), animate);
  };
  const actualSize = () => {
    const { w } = size();
    if (w) zoom(box.w / w, 0.5, 0.5, true);
  };
  const panBy = (dxPx: number, dyPx: number, animate = false) => {
    const { w, h } = size();
    if (!w || !h) return;
    set(
      clampViewBox(
        { ...box, x: box.x + (dxPx * box.w) / w, y: box.y + (dyPx * box.h) / h },
        content
      ),
      animate
    );
  };
  const centreOn = (worldX: number, worldY: number, animate = false) => {
    set(clampViewBox({ ...box, x: worldX - box.w / 2, y: worldY - box.h / 2 }, content), animate);
  };

  // --- Wheel: zooms the map; sideways swipes and Shift + wheel pan. ---
  host.addEventListener(
    'wheel',
    (event) => {
      if ((event.target as Element).closest('.au-wo-controls')) return;
      const pixels = (delta: number) => (event.deltaMode === 1 ? delta * 16 : delta);
      const rect = host.getBoundingClientRect();
      event.preventDefault();
      // Only clearly sideways swipes pan, so a slightly diagonal wheel still zooms.
      const horizontal =
        (Math.abs(event.deltaX) > 2 * Math.abs(event.deltaY) || event.shiftKey) &&
        !event.ctrlKey &&
        !event.metaKey;
      if (horizontal) {
        panBy(pixels(event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX), 0);
        return;
      }
      const dy = Math.max(-120, Math.min(120, pixels(event.deltaY)));
      // Trackpad pinches arrive as many tiny deltas; boost them so they feel as quick as a wheel.
      const boost = Math.abs(dy) < 40 ? 3 : 1;
      zoom(
        Math.exp(-dy * WHEEL_SENSITIVITY * boost),
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height
      );
    },
    { passive: false }
  );

  // --- Pointer: drag to pan, two fingers to pinch. ---
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number } | null = null;
  let drag: { id: number; x: number; y: number } | null = null;
  host.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('.au-wo-controls, .au-wo-minimap')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // There is only one mouse: an entry left by a release outside the map must not start a pinch.
    if (event.pointerType === 'mouse') pointers.clear();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) };
      drag = null;
      return;
    }
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    dragged = false;
  });
  host.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = host.getBoundingClientRect();
      if (pinch.distance > 0)
        zoom(
          distance / pinch.distance,
          ((a.x + b.x) / 2 - rect.left) / rect.width,
          ((a.y + b.y) / 2 - rect.top) / rect.height
        );
      pinch = { distance };
      dragged = true;
      return;
    }
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    if (!dragged) host.setPointerCapture?.(event.pointerId); // Only now, so plain clicks still reach links.
    dragged = true;
    host.classList.add('is-dragging');
    panBy(-dx, -dy);
    drag = { id: drag.id, x: event.clientX, y: event.clientY };
  });
  const endPointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag?.id === event.pointerId) drag = null;
    host.classList.remove('is-dragging');
  };
  host.addEventListener('pointerup', endPointer);
  host.addEventListener('pointercancel', endPointer);
  host.addEventListener('lostpointercapture', endPointer);
  // Cards are links, which the browser would otherwise start dragging instead of panning.
  host.addEventListener('dragstart', (event) => event.preventDefault());
  // A drag that ends over a title must not also follow its link.
  host.addEventListener(
    'click',
    (event) => {
      if (!dragged) return;
      event.preventDefault();
      event.stopPropagation();
      dragged = false;
    },
    true
  );
  host.addEventListener('dblclick', (event) => {
    if ((event.target as Element).closest('[data-au-id], .au-wo-controls, .au-wo-minimap')) return;
    const rect = host.getBoundingClientRect();
    zoom(
      event.shiftKey ? 1 / DOUBLE_CLICK_STEP : DOUBLE_CLICK_STEP,
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
      true
    );
  });

  // --- Keyboard, once the map has focus. ---
  host.tabIndex = 0;
  host.setAttribute('role', 'group');
  host.setAttribute('aria-roledescription', 'map');
  host.setAttribute(
    'aria-label',
    'Franchise map. Arrow keys move, plus and minus zoom, 0 fits the whole map.'
  );
  host.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown + = - 0');
  host.addEventListener('keydown', (event) => {
    if (event.target !== host || event.altKey || event.ctrlKey || event.metaKey) return;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => panBy(-KEY_PAN_PX, 0, true),
      ArrowRight: () => panBy(KEY_PAN_PX, 0, true),
      ArrowUp: () => panBy(0, -KEY_PAN_PX, true),
      ArrowDown: () => panBy(0, KEY_PAN_PX, true),
      '+': () => zoom(BUTTON_STEP, 0.5, 0.5, true),
      '=': () => zoom(BUTTON_STEP, 0.5, 0.5, true),
      '-': () => zoom(1 / BUTTON_STEP, 0.5, 0.5, true),
      '0': () => fit(true),
    };
    const numpad: Record<string, string> = { NumpadAdd: '+', NumpadSubtract: '-', Numpad0: '0' };
    const action = keys[numpad[event.code] ?? event.key];
    if (!action) return;
    event.preventDefault();
    action();
  });

  // --- Hover / focus highlight of a title and its direct relations. ---
  const nodeEls = [...svgEl.querySelectorAll<SVGElement>('[data-au-id]')];
  const edgeEls = [...svgEl.querySelectorAll<SVGElement>('[data-au-edge]')];
  const highlight = (id: number | null) => {
    const near = id === null ? null : neighbourhood(edges, id);
    svgEl.classList.toggle('is-focusing', !!near);
    for (const el of nodeEls) {
      el.style.opacity = near && !near.nodes.has(Number(el.dataset.auId)) ? DIMMED_OPACITY : '';
    }
    for (const el of edgeEls) {
      const lit = !near || near.edges.has(Number(el.dataset.auEdge));
      el.style.opacity = lit ? '' : DIMMED_OPACITY;
      el.classList.toggle('is-lit', !!near && lit);
    }
  };
  const nodeOf = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<SVGElement>('[data-au-id]') : null;
  svgEl.addEventListener('pointerover', (event) => {
    if (drag && dragged) return;
    const target = nodeOf(event.target);
    highlight(target ? Number(target.dataset.auId) : null);
  });
  svgEl.addEventListener('pointerleave', () => highlight(null));
  svgEl.addEventListener('focusin', (event) => {
    const target = nodeOf(event.target);
    if (!target) return;
    highlight(Number(target.dataset.auId));
    // Keep a title reached with Tab inside the visible area.
    const match = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(target.getAttribute('transform') ?? '');
    if (!match || !content.size) return;
    const x = Number(match[1]);
    const y = Number(match[2]);
    const outside =
      x < box.x ||
      y < box.y ||
      x + content.size.width > box.x + box.w ||
      y + content.size.height > box.y + box.h;
    if (outside) centreOn(x + content.size.width / 2, y + content.size.height / 2, true);
  });
  svgEl.addEventListener('focusout', () => highlight(null));

  // --- Full screen covers the map's root (marked data-au-fs-root) so its toolbar stays usable;
  // the layout itself comes from :fullscreen rules in WatchOrderStyles. ---
  const root = () => host.closest<HTMLElement>('[data-au-fs-root]') ?? host;
  const sync = () => {
    const on = isFullscreen();
    host.style.touchAction = on ? 'none' : 'pan-y';
    controls.setFullscreen(on);
    fit();
  };
  // The new size is only known once the browser has laid the page out again.
  document.addEventListener('fullscreenchange', () => requestAnimationFrame(sync), { signal });
  // Window resizes and rotations change the viewport: keep "fit" and the zoom limits honest.
  let lastWidth = 0;
  let lastHeight = 0;
  const resize =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          const { w, h } = size();
          if (!w || !h || (w === lastWidth && h === lastHeight)) return;
          const [oldW, oldH] = [lastWidth, lastHeight];
          lastWidth = w;
          lastHeight = h;
          refit();
          if (!oldW || !oldH) return;
          // Same scale and same centre: the map grows or shrinks around what was in view.
          const next = { w: (box.w * w) / oldW, h: (box.h * h) / oldH };
          const cx = box.x + box.w / 2;
          const cy = box.y + box.h / 2;
          set(clampViewBox({ x: cx - next.w / 2, y: cy - next.h / 2, ...next }, content));
        })
      : null;
  resize?.observe(host);
  signal.addEventListener('abort', () => resize?.disconnect());
  const toggleFullscreen = () => {
    const top = root();
    if (document.fullscreenElement === top) void document.exitFullscreen();
    else void top.requestFullscreen?.().catch(() => undefined);
  };

  controls.onZoomIn(() => zoom(BUTTON_STEP, 0.5, 0.5, true));
  controls.onZoomOut(() => zoom(1 / BUTTON_STEP, 0.5, 0.5, true));
  controls.onActualSize(actualSize);
  controls.onFit(() => fit(true));
  controls.onMinimap(() => {
    showMinimap = !showMinimap;
    options.onMinimapChange?.(showMinimap);
    apply();
  });
  controls.onFullscreen(toggleFullscreen);
  minimap?.onNavigate((x, y, animate) => centreOn(x, y, animate));
  host.style.touchAction = 'pan-y';
  apply();

  return {
    fit: () => fit(),
    sync,
    dispose() {
      cancelAnimationFrame(animation);
      lifetime.abort();
    },
    focus(worldX, worldY) {
      const { w, h } = size();
      refit();
      set(frameViewBox(content, w, h, worldX, worldY));
    },
  };
}

interface Controls {
  bar: HTMLElement;
  setZoom(scale: number): void;
  setFullscreen(on: boolean): void;
  onZoomIn(fn: () => void): void;
  onZoomOut(fn: () => void): void;
  onActualSize(fn: () => void): void;
  onFit(fn: () => void): void;
  onMinimap(fn: () => void): void;
  setMinimap(on: boolean): void;
  onFullscreen(fn: () => void): void;
}

/** Floating pill in the bottom-right corner: − 100% + | minimap | fit | full screen. */
function buildControls(withMinimap: boolean): Controls {
  const bar = document.createElement('div');
  bar.className = 'au-wo-controls';
  const handlers = new Map<string, () => void>();
  const make = (key: string, title: string, content: Node, extra = '') => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `au-wo-control ${extra}`.trim();
    button.title = title;
    button.setAttribute('aria-label', title);
    button.append(content);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.get(key)?.();
    });
    return button;
  };
  const level = document.createElement('span');
  level.textContent = '100%';
  const zoomOut = make('out', 'Zoom out (−)', icon('minus'));
  const actual = make('actual', 'Actual size', level, 'au-wo-control--level');
  const zoomIn = make('in', 'Zoom in (+)', icon('plus'));
  const mini = make('mini', 'Show minimap', icon('map'));
  mini.setAttribute('aria-pressed', 'false');
  const fit = make('fit', 'Fit whole map (0)', icon('fit'));
  const full = make('full', 'Full screen', icon('expand'));
  full.setAttribute('data-au-fullscreen', '');
  const divider = document.createElement('span');
  divider.className = 'au-wo-control-divider';
  bar.append(zoomOut, actual, zoomIn, divider, ...(withMinimap ? [mini] : []), fit, full);
  return {
    bar,
    setZoom(scale) {
      level.textContent = `${Math.round(scale * 100)}%`;
    },
    setFullscreen(on) {
      full.replaceChildren(icon(on ? 'shrink' : 'expand'));
      full.title = on ? 'Exit full screen' : 'Full screen';
      full.setAttribute('aria-label', full.title);
    },
    onZoomIn: (fn) => handlers.set('in', fn),
    onZoomOut: (fn) => handlers.set('out', fn),
    onActualSize: (fn) => handlers.set('actual', fn),
    onFit: (fn) => handlers.set('fit', fn),
    onMinimap: (fn) => handlers.set('mini', fn),
    setMinimap(on) {
      mini.setAttribute('aria-pressed', String(on));
      mini.title = on ? 'Hide minimap' : 'Show minimap';
      mini.setAttribute('aria-label', mini.title);
    },
    onFullscreen: (fn) => handlers.set('full', fn),
  };
}

interface Minimap {
  element: HTMLElement;
  update(box: ViewBox): void;
  onNavigate(fn: (x: number, y: number, animate: boolean) => void): void;
}

/** Overview of the whole map with the visible area outlined; click or drag it to move. */
function buildMinimap(content: ViewportContent, svgEl: SVGSVGElement): Minimap | null {
  if (!content.nodes?.length || !content.size || content.width <= 0 || content.height <= 0)
    return null;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const scale = Math.min(MINIMAP_WIDTH / content.width, MINIMAP_MAX_HEIGHT / content.height);
  const element = document.createElement('div');
  element.className = 'au-wo-minimap is-hidden';
  element.setAttribute('aria-hidden', 'true');
  const mini = document.createElementNS(SVG_NS, 'svg');
  mini.setAttribute('viewBox', `0 0 ${content.width} ${content.height}`);
  mini.setAttribute('width', String(Math.round(content.width * scale)));
  mini.setAttribute('height', String(Math.round(content.height * scale)));
  const status = new Map(
    [...svgEl.querySelectorAll<SVGElement>('[data-au-id]')].map((el) => [
      Number(el.dataset.auId),
      el.classList.contains('is-current')
        ? 'is-current'
        : el.classList.contains('is-watched')
          ? 'is-watched'
          : '',
    ])
  );
  for (const item of content.nodes) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    for (const [name, value] of Object.entries({
      x: item.x,
      y: item.y,
      width: content.size.width,
      height: content.size.height,
      rx: 8,
    }))
      rect.setAttribute(name, String(value));
    rect.setAttribute('class', `au-wo-mini-node ${status.get(item.node.id) ?? ''}`.trim());
    mini.append(rect);
  }
  const view = document.createElementNS(SVG_NS, 'rect');
  view.setAttribute('class', 'au-wo-mini-view');
  view.setAttribute('vector-effect', 'non-scaling-stroke');
  mini.append(view);
  element.append(mini);

  let navigate: (x: number, y: number, animate: boolean) => void = () => undefined;
  const toWorld = (event: PointerEvent) => {
    const rect = mini.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * content.width,
      ((event.clientY - rect.top) / rect.height) * content.height,
    ] as const;
  };
  let active = false;
  element.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    event.preventDefault();
    active = true;
    element.setPointerCapture?.(event.pointerId);
    navigate(...toWorld(event), true);
  });
  element.addEventListener('pointermove', (event) => {
    if (active) navigate(...toWorld(event), false);
  });
  const stop = () => {
    active = false;
  };
  element.addEventListener('pointerup', stop);
  element.addEventListener('pointercancel', stop);
  element.addEventListener('click', (event) => event.stopPropagation());

  return {
    element,
    update(box) {
      view.setAttribute('x', String(box.x));
      view.setAttribute('y', String(box.y));
      view.setAttribute('width', String(box.w));
      view.setAttribute('height', String(box.h));
    },
    onNavigate(fn) {
      navigate = fn;
    },
  };
}
