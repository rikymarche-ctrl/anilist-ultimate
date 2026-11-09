/**
 * @file WatchOrderModule.ts
 * @description Injects a "Watch Order & Map" section into anime pages: the franchise derived
 * from AniList relations as a story-order or release-order timeline, or as a relation map,
 * with the viewer's list progress.
 *
 * The AniList-derived views (sequel chains + start dates) are never presented as a verified
 * narrative chronology. A community-curated order (AnimeChrono) is layered on top when one is
 * found for the franchise, and always credited.
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import {
  mutationsMatchSelector,
  type SharedGlobalObserver,
} from '@core/observers/SharedGlobalObserver';
import { getMediaRoute } from '@core/navigation/MediaRoute';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { CARD_SIZE, POSTER_SIZE, layoutGraph } from './WatchOrderLayout';
import { buildMapView, centerOnCurrent, disposeMaps } from './WatchOrderMapView';
import { buildCuratedList, buildOrderList, revealCurrent } from './WatchOrderListView';
import {
  WATCH_ORDER_QUERY,
  crawlFranchise,
  formatRuntime,
  franchiseTotals,
  isEntryComplete,
  parseWatchOrderPage,
  releaseOrder,
  storyOrder,
  type FranchiseGraph,
  type WatchEntry,
} from './WatchOrderGraph';
import { findCuratedOrder, isRowWatched, type CuratedResult } from './CuratedOrderMatch';
import { CURATED_CHALLENGE_REASON } from '@core/services/CuratedOrderClient';
import { MSG } from '@shared/messages';
import {
  loadPrefs,
  savePrefs,
  type OrderMode,
  type ViewTab,
  type WatchOrderPrefs,
} from './WatchOrderPrefs';
import { ensureWatchOrderStyles } from './WatchOrderStyles';
import { ensurePlaced, watchOrderPlacement } from '@core/ui/OverviewPlacement';
import {
  BRANCH_KINDS,
  KIND_COLOR,
  KIND_LABEL,
  icon,
  titleKinds,
  type BranchKind,
  type IconName,
  type TitleKind,
} from './WatchOrderTheme';

const CACHE_TTL_MS = 10 * 60 * 1000;
const CURATED_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SECTION_CLASS = 'au-watchorder-section';
const SECTION_TITLE = 'Watch Order & Map';
/**
 * Safety net while on an anime page: AniList swaps views without page loads, and a mutation that
 * should have mounted the section can be missed. A missing section is put back within this time.
 */
const MOUNT_CHECK_MS = 1000;

/** Formats hidden by default: trailers, recaps and music videos rather than watchable story. */
function isMinorFormat(format: string | null): boolean {
  return format === 'SPECIAL' || format === 'MUSIC';
}

/** Tooltip of each view (the curated one is credited in the footer instead). */
const VIEW_NOTE: Record<OrderMode, string> = {
  curated: '',
  story:
    'Derived from AniList relations, not a verified chronology: branches are placed right after the series they come from.',
  release: 'Sorted by start date.',
  map: 'Relations as reported by AniList. Click a title to open it.',
};

/** Titles linked to `start` through the graph's edges, in either direction. */
function connectedTo(graph: FranchiseGraph, start: number): Set<number> {
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    links.set(a, [...(links.get(a) ?? []), b]);
    links.set(b, [...(links.get(b) ?? []), a]);
  };
  for (const edge of graph.sequels) link(edge.from, edge.to);
  for (const edge of graph.branches) link(edge.parent, edge.child);
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const next of links.get(queue.pop()!) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Element helper: all dynamic text goes through textContent, never parsed as HTML. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = ''
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const element = el('button', className);
  element.type = 'button';
  if (label) element.append(el('span', '', label));
  element.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return element;
}

/** Identity of a focused control that survives a rebuild: its role in the toolbar and its label. */
function controlKey(element: Element | null, scope: HTMLElement): string | null {
  if (!(element instanceof HTMLElement) || !scope.contains(element) || element.tagName !== 'BUTTON')
    return null;
  return `${element.className}|${element.getAttribute('aria-label') ?? element.textContent ?? ''}`;
}

function restoreFocus(scope: HTMLElement, key: string | null): void {
  if (!key) return;
  const match = [...scope.querySelectorAll<HTMLElement>('button')].find(
    (candidate) => controlKey(candidate, scope) === key
  );
  match?.focus({ preventScroll: true });
}

/** Everything a render needs, derived once from the graph and the current preferences. */
interface ViewModel {
  view: OrderMode;
  curated: CuratedResult | null;
  /** Ordered entries with the Specials filter applied (progress counts use these). */
  counted: WatchEntry[];
  /** `counted` minus watched titles when "Hide watched" is on. */
  shown: WatchEntry[];
  kinds: Map<number, TitleKind>;
  hasSpecials: boolean;
  done: number;
  total: number;
  nextId: number | null;
}

@injectable()
export class WatchOrderModule extends BaseModule {
  private pageVersion = 0;
  private destroyed = false;
  private isProcessing = false;
  /** A page mutation arrived while a render was running: look again once it ends. */
  private renderQueued = false;
  /** Visit whose crawl failed; not retried until navigation. */
  private failedVersion = -1;
  private prefs: WatchOrderPrefs = loadPrefs();
  /** Collapsed until the viewer expands it; their choice holds while browsing this tab. */
  private open = false;
  /** Curated order of the current franchise, once found; the AniList-derived views never wait for it. */
  private curated: CuratedResult | null = null;
  private redraw: (() => void) | null = null;
  /** Why no curated order is shown (nothing matched, or the source could not be read). */
  private curatedStatus: string | null = null;
  /** Looks for the curated order again (after the viewer passed AnimeChrono's browser check). */
  private retryCurated: (() => void) | null = null;
  /** Titles of the current franchise, sent when the viewer asks to load the curated order. */
  private franchiseTitles: string[] = [];
  /** The viewer already had AnimeChrono opened for this page: a miss now means it has no order. */
  private captureTried = false;
  private readonly onRuntimeMessage = (message: unknown): void => {
    if (
      message &&
      typeof message === 'object' &&
      (message as { type?: unknown }).type === MSG.WATCH_ORDER_READY
    )
      this.retryCurated?.();
  };
  private readonly curatedCache = new Map<number, { at: number; result: CuratedResult | null }>();
  private readonly cache = new Map<number, { at: number; graph: FranchiseGraph }>();
  private readonly OBSERVER_NAME = 'watch-order-injector';
  private mountTimer: number | undefined;

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.Config) private config: IConfigManager,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public getName(): string {
    return 'watchOrder';
  }

  public async init(): Promise<void> {
    if (this.destroyed) return;
    const restart = () => {
      if (this.destroyed) return;
      this.fullCleanup();
      if (this.isActive()) this.startObservation();
    };
    this.onPageChange(restart);
    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, restart);
    chrome.runtime?.onMessage?.addListener(this.onRuntimeMessage);
    if (this.isActive()) this.startObservation();
  }

  public override async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fullCleanup();
    chrome.runtime?.onMessage?.removeListener(this.onRuntimeMessage);
    await super.destroy();
  }

  private isActive(): boolean {
    return (
      getMediaRoute(window.location.pathname)?.type === 'ANIME' &&
      this.config.isFeatureEnabled('watchOrder')
    );
  }

  private startObservation(): void {
    const version = this.pageVersion;
    const process = () =>
      !this.destroyed && version === this.pageVersion ? this.renderCurrent() : undefined;
    void process();
    window.clearInterval(this.mountTimer);
    this.mountTimer = window.setInterval(() => void process(), MOUNT_CHECK_MS);
    this.sharedObserver.register(
      this.OBSERVER_NAME,
      process,
      undefined,
      mutationsMatchSelector('.overview')
    );
  }

  private fullCleanup(): void {
    this.pageVersion++;
    this.sharedObserver.unregister(this.OBSERVER_NAME);
    window.clearInterval(this.mountTimer);
    this.mountTimer = undefined;
    this.isProcessing = false;
    this.renderQueued = false;
    this.curated = null;
    this.curatedStatus = null;
    this.redraw = null;
    this.retryCurated = null;
    this.franchiseTitles = [];
    this.captureTried = false;
    if (document.fullscreenElement?.closest(`.${SECTION_CLASS}`)) void document.exitFullscreen();
    document.querySelectorAll(`.${SECTION_CLASS}`).forEach((section) => {
      disposeMaps(section);
      section.remove();
    });
  }

  private async renderCurrent(): Promise<void> {
    if (this.destroyed) return;
    if (this.isProcessing) {
      // Right after an SPA navigation the old page is still on screen; the new one arrives while
      // the franchise is being read, and must not be missed.
      this.renderQueued = true;
      return;
    }
    const path = window.location.pathname;
    const route = getMediaRoute(path);
    const overview = document.querySelector('.overview');
    if (route?.type !== 'ANIME' || !overview) return;
    const mounted = overview.querySelector(`:scope > .${SECTION_CLASS}`);
    if (mounted) {
      // AniList may have inserted its own sections around ours since: keep the order.
      ensurePlaced(mounted, overview, watchOrderPlacement(overview));
      return;
    }
    if (overview.querySelector(`.${SECTION_CLASS}`)) return;
    const version = this.pageVersion;
    if (this.failedVersion === version) return;
    const isCurrent = () =>
      !this.destroyed &&
      version === this.pageVersion &&
      window.location.pathname === path &&
      overview.isConnected;

    this.isProcessing = true;
    let section: HTMLElement | null = null;
    try {
      const context = await captureApiContext(this.apiClient);
      assertApiContext(this.apiClient, context);
      // The header is on screen straight away (collapsed); it fills in once the franchise is read.
      section = this.mountPlaceholder(overview);
      const graph = await this.loadGraph(route.id, isCurrent);
      assertApiContext(this.apiClient, context);
      if (!isCurrent() || !graph) return;
      // A title with no related anime still gets its section (one entry, with its totals).
      this.populate(section, graph, route.id);
      this.franchiseTitles = [...graph.nodes.values()].map((node) => node.title);
      this.retryCurated = () => {
        // A capture may have arrived since: forget the cached "not found" for this franchise.
        for (const id of graph.nodes.keys()) this.curatedCache.delete(id);
        this.curatedStatus = 'checking';
        this.redraw?.();
        void chrome.runtime
          .sendMessage({ type: MSG.WATCH_ORDER_RETRY })
          .catch(() => undefined)
          .then(() => this.loadCurated(graph, route.id, isCurrent));
      };
      void this.loadCurated(graph, route.id, isCurrent);
    } catch (error) {
      this.logger.error('[WatchOrder] Failed to build watch order', error);
      // A failure on screen waits for the Retry button; one that never reached the page (it went
      // into a view AniList has since replaced) is tried again by the mount check.
      if (section?.isConnected) {
        this.failedVersion = version;
        this.showFailure(section);
      }
    } finally {
      if (version === this.pageVersion) {
        this.isProcessing = false;
        if (this.renderQueued || !section?.isConnected) {
          this.renderQueued = false;
          // The section went into a view AniList has since replaced: mount it in the live one.
          if (!document.querySelector(`.overview .${SECTION_CLASS}`)) void this.renderCurrent();
        }
      }
    }
  }

  private async loadGraph(
    rootId: number,
    isCurrent: () => boolean
  ): Promise<FranchiseGraph | null> {
    const hit = this.cache.get(rootId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.graph;
    const graph = await crawlFranchise(
      rootId,
      // The section is on screen, waiting: it goes ahead of background requests in the queue.
      async (ids) =>
        parseWatchOrderPage(
          await this.apiClient.query<unknown>(WATCH_ORDER_QUERY, { ids }, false, { priority: true })
        ),
      () => !isCurrent()
    );
    if (!isCurrent()) return null;
    // The root must be part of its own franchise; anything else means the crawl was incomplete.
    if (!graph.nodes.has(rootId)) throw new Error('Watch order root missing from response');
    for (const id of graph.nodes.keys()) this.cache.set(id, { at: Date.now(), graph });
    return graph;
  }

  private updatePrefs(change: Partial<WatchOrderPrefs>): void {
    this.prefs = { ...this.prefs, ...change };
    savePrefs(this.prefs);
  }

  private mountPlaceholder(overview: Element): HTMLElement {
    ensureWatchOrderStyles();
    document.querySelectorAll(`.${SECTION_CLASS}`).forEach((section) => section.remove());
    const section = el('div', SECTION_CLASS);
    section.setAttribute('aria-busy', 'true');
    const bar = el('div', 'au-wo-header');
    bar.append(
      el('span', 'au-wo-title', SECTION_TITLE),
      el('span', 'au-wo-subtitle', ''),
      el('span', 'au-wo-status', 'Reading the franchise…')
    );
    (bar.children[1] as HTMLElement).style.flex = '1';
    section.append(bar);
    // Right after Relations (it extends them); else where Characters or Staff begin.
    ensurePlaced(section, overview, watchOrderPlacement(overview));
    return section;
  }

  private populate(section: HTMLElement, graph: FranchiseGraph, currentId: number): void {
    section.removeAttribute('aria-busy');
    const kinds = titleKinds(graph);
    const body = el('div', 'au-wo-body');
    // Full screen covers the whole body, so filters and legend stay usable around the map.
    body.setAttribute('data-au-fs-root', '');
    let reveal = true;
    const draw = (): void => {
      // Controls are rebuilt on every redraw: remember which one had focus to give it back.
      const focused = controlKey(document.activeElement, section);
      const model = this.viewModel(graph, kinds, currentId);
      const header = this.buildHeader();
      const oldHeader = section.querySelector(':scope > .au-wo-header');
      if (oldHeader) oldHeader.replaceWith(header);
      else section.prepend(header);
      // The body element is kept (only its children change) so full screen survives redraws.
      section
        .querySelectorAll(':scope > :not(.au-wo-header):not(.au-wo-body)')
        .forEach((n) => n.remove());
      disposeMaps(body);
      if (!this.open) {
        body.remove();
        reveal = true;
        restoreFocus(section, focused);
        return;
      }
      if (!body.isConnected) section.append(body);
      body.replaceChildren(...this.buildBody(graph, model, currentId));
      restoreFocus(section, focused);
      if (model.view === 'map') {
        requestAnimationFrame(() => centerOnCurrent(body));
      } else if (reveal) {
        requestAnimationFrame(() => revealCurrent(body));
      }
      reveal = false;
    };
    this.redraw = draw;
    draw();
  }

  private showFailure(section: HTMLElement): void {
    section.removeAttribute('aria-busy');
    const retry = button('au-wo-retry', 'Retry', () => {
      this.failedVersion = -1;
      section.remove();
      void this.renderCurrent();
    });
    const bar = el('div', 'au-wo-header');
    const title = el('span', 'au-wo-title', SECTION_TITLE);
    title.style.flex = '1';
    bar.append(title, el('span', 'au-wo-status', 'Could not load the franchise.'), retry);
    section.replaceChildren(bar);
  }

  /** Two tabs; the list shows the curated order when there is one, else the AniList-derived one. */
  private activeMode(): OrderMode {
    if (this.prefs.mode === 'map') return 'map';
    if (this.prefs.releaseSort) return 'release';
    return this.curated ? 'curated' : 'story';
  }

  private viewModel(
    graph: FranchiseGraph,
    kinds: Map<number, TitleKind>,
    currentId: number
  ): ViewModel {
    const view = this.activeMode();
    const curated = view === 'curated' ? this.curated : null;
    const all = view === 'release' ? releaseOrder(graph) : storyOrder(graph);
    // The curated map holds only the titles AnimeChrono lists (it leaves out recaps and the like):
    // counts and totals follow it, and the AniList filters do not apply.
    const curatedIds = this.curatedMapIds(graph, view);
    const ordered = curatedIds ? all.filter((entry) => curatedIds.includes(entry.node.id)) : all;
    const hasSpecials = ordered.some((entry) => isMinorFormat(entry.node.format));
    const counted =
      this.prefs.specials || curatedIds
        ? ordered
        : ordered.filter(
            (entry) => !isMinorFormat(entry.node.format) || entry.node.id === currentId
          );
    const shown =
      this.prefs.hideWatched && !curatedIds
        ? counted.filter((entry) => !isEntryComplete(entry.node) || entry.node.id === currentId)
        : counted;
    const done = curated
      ? curated.rows.filter(isRowWatched).length
      : counted.filter((entry) => isEntryComplete(entry.node)).length;
    return {
      view,
      curated,
      counted,
      shown,
      kinds,
      hasSpecials,
      done,
      total: curated ? curated.rows.length : counted.length,
      nextId: counted.find((entry) => !isEntryComplete(entry.node))?.node.id ?? null,
    };
  }

  /** Look for a curated order in the background; any failure leaves the AniList views as they are. */
  private async loadCurated(
    graph: FranchiseGraph,
    rootId: number,
    isCurrent: () => boolean
  ): Promise<void> {
    const notes: string[] = [];
    try {
      const hit = this.curatedCache.get(rootId);
      let result: CuratedResult | null;
      if (hit && Date.now() - hit.at < CURATED_CACHE_TTL_MS) {
        result = hit.result;
      } else {
        result = await findCuratedOrder(
          graph,
          (message) => chrome.runtime.sendMessage(message),
          isCurrent,
          (note) => notes.push(note)
        );
        if (!isCurrent()) return;
        for (const id of graph.nodes.keys()) this.curatedCache.set(id, { at: Date.now(), result });
      }
      if (!isCurrent()) return;
      if (result) {
        this.curated = result;
      } else {
        this.curatedStatus = notes.length ? `not found (${notes.join('; ')})` : 'not found';
      }
    } catch (error) {
      if (!isCurrent()) return;
      this.curatedStatus = `unavailable (${error instanceof Error ? error.message.replace('Curated order request failed: ', '') : 'unknown error'})`;
      this.logger.debug?.('[WatchOrder] Curated order unavailable', error);
    }
    this.redraw?.();
  }

  /** Section title, outside the card like AniList's own headings; it toggles the section. */
  private buildHeader(): HTMLElement {
    const open = this.open;
    const flip = () => {
      this.open = !this.open;
      this.redraw?.();
    };
    const bar = el('div', `au-wo-header${open ? ' is-open' : ''}`);
    bar.addEventListener('click', flip);
    const toggle = button('au-wo-toggle', '', flip);
    toggle.setAttribute('aria-expanded', String(open));
    const chevron = icon('chevron', 16);
    chevron.classList.add('au-wo-chevron');
    toggle.append(chevron, el('span', 'au-wo-title', SECTION_TITLE));
    bar.append(toggle);
    return bar;
  }

  /** Franchise progress, shown inside the card next to the runtime totals. */
  private buildMeter(model: ViewModel): HTMLElement {
    const meter = el('span', 'au-wo-meter');
    const label = el('span');
    label.append(el('strong', '', String(model.done)), ` / ${model.total} watched`);
    const track = el('span', 'au-wo-meter-track');
    const fill = el('span', 'au-wo-meter-fill');
    fill.style.width = `${model.total ? (model.done / model.total) * 100 : 0}%`;
    track.append(fill);
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(model.total));
    track.setAttribute('aria-valuenow', String(model.done));
    track.setAttribute('aria-label', 'Franchise progress');
    meter.append(label, track);
    return meter;
  }

  private buildBody(graph: FranchiseGraph, model: ViewModel, currentId: number): HTMLElement[] {
    const parts: HTMLElement[] = [];
    parts.push(this.buildToolbar(model));
    const stats = el('div', 'au-wo-stats');
    stats.append(this.buildTotals(model) ?? el('span'), this.buildMeter(model));
    parts.push(stats);
    if (model.curated) {
      parts.push(buildCuratedList(model.curated, currentId));
    } else if (model.view === 'map') {
      parts.push(...this.buildMap(graph, model, currentId));
    } else {
      parts.push(
        buildOrderList(model.shown, {
          currentId,
          nextId: model.nextId,
          estimated: model.view === 'story',
          kinds: model.kinds,
        })
      );
    }
    const footer = this.buildFooter();
    if (footer) parts.push(footer);
    return parts;
  }

  /** View switch on the left; the filters that apply to the current view on the right. */
  private buildToolbar(model: ViewModel): HTMLElement {
    const toolbar = el('div', 'au-wo-toolbar');
    const views = el('div', 'au-wo-views');
    views.setAttribute('role', 'group');
    views.setAttribute('aria-label', 'View');
    const tabs: Array<[ViewTab, string]> = [
      ['list', 'Watch order'],
      ['map', 'Map'],
    ];
    for (const [mode, label] of tabs) {
      const tab = button('au-wo-view', label, () => {
        this.updatePrefs({ mode });
        this.redraw?.();
      });
      // What each list really is, for those who wonder (the curated one is credited below).
      const shownList = model.view === 'map' ? (this.curated ? 'curated' : 'story') : model.view;
      const note = VIEW_NOTE[mode === 'map' ? 'map' : shownList];
      if (note) tab.title = note;
      tab.setAttribute('aria-pressed', String((model.view === 'map') === (mode === 'map')));
      views.append(tab);
    }
    toolbar.append(views);

    const filters = el('div', 'au-wo-filters');
    const chip = (
      label: string,
      iconName: IconName | null,
      on: boolean | null,
      toggle: () => void,
      title: string
    ) => {
      const control = button('au-wo-chip', label, () => {
        toggle();
        this.redraw?.();
      });
      if (iconName) control.prepend(icon(iconName, 14));
      // Chips whose text names the action or the state (Show/Hide specials,
      // Curated/Default order) are plain buttons, not pressed toggles.
      if (on !== null) control.setAttribute('aria-pressed', String(on));
      control.title = title;
      return control;
    };
    if (model.view !== 'map') {
      filters.append(
        chip(
          this.prefs.releaseSort ? 'Release dates' : 'Default order',
          null,
          null,
          () => this.updatePrefs({ releaseSort: !this.prefs.releaseSort }),
          this.prefs.releaseSort
            ? 'Sorted by release date. Click for the watch order'
            : 'Sorted in watch order. Click to sort by release date'
        )
      );
    }
    // The filters stay in place (disabled) on the curated order, so the toolbar does not jump
    // when Release dates switches between the curated and the AniList order.
    const curatedOnly = !!model.curated || !!this.curatedMapIds(null, model.view);
    const filterStart = filters.childElementCount;
    {
      if (model.hasSpecials || curatedOnly) {
        filters.append(
          chip(
            this.prefs.specials ? 'Hide specials' : 'Show specials',
            null,
            null,
            () => this.updatePrefs({ specials: !this.prefs.specials }),
            this.prefs.specials
              ? 'Leave out specials and music videos'
              : 'Include specials and music videos'
          )
        );
      }
      filters.append(
        chip(
          this.prefs.hideWatched ? 'Show watched' : 'Hide watched',
          null,
          null,
          () => this.updatePrefs({ hideWatched: !this.prefs.hideWatched }),
          this.prefs.hideWatched
            ? 'Show the titles you have completed again'
            : 'Hide titles you have completed'
        )
      );
      if (curatedOnly) {
        for (const control of [...filters.children].slice(filterStart)) {
          (control as HTMLButtonElement).disabled = true;
          control.setAttribute('aria-pressed', 'false');
          (control as HTMLButtonElement).title =
            'Applies to the AniList orders, not to AnimeChrono’s';
        }
      }
    }
    if (model.view === 'map' && this.curated) {
      filters.append(
        chip(
          this.prefs.curatedMap ? 'Curated order' : 'Default order',
          null,
          null,
          () => this.updatePrefs({ curatedMap: !this.prefs.curatedMap }),
          this.prefs.curatedMap
            ? 'The map follows the AnimeChrono order (one line). Click for the AniList relations layout'
            : 'The map follows AniList relations. Click to lay it out as the AnimeChrono order'
        )
      );
    }
    if (model.view === 'map') {
      const segment = el('div', 'au-wo-segment');
      segment.setAttribute('role', 'group');
      segment.setAttribute('aria-label', 'Card style');
      for (const [posters, name, title] of [
        [false, 'cards', 'Compact cards'],
        [true, 'posters', 'Posters'],
      ] as const) {
        const option = button('', '', () => {
          this.updatePrefs({ posters });
          this.redraw?.();
        });
        option.append(icon(name, 15));
        option.title = title;
        option.setAttribute('aria-label', title);
        option.setAttribute('aria-pressed', String(this.prefs.posters === posters));
        segment.append(option);
      }
      filters.append(segment);
    }
    if (filters.childElementCount) toolbar.append(filters);
    return toolbar;
  }

  private buildMap(graph: FranchiseGraph, model: ViewModel, currentId: number): HTMLElement[] {
    if (this.curated && this.prefs.curatedMap) return this.buildCuratedMap(graph, model, currentId);
    const hidden = new Set<BranchKind>(this.prefs.hiddenKinds);
    const keep = new Set(
      model.shown
        .filter((entry) => {
          const kind = model.kinds.get(entry.node.id) ?? 'MAIN';
          return entry.node.id === currentId || kind === 'MAIN' || !hidden.has(kind);
        })
        .map((entry) => entry.node.id)
    );
    // A hidden kind loses its titles and its links (an alternative of a main title is only a link).
    const visible: FranchiseGraph = {
      ...graph,
      branches: graph.branches.filter((edge) => !hidden.has(edge.relation as BranchKind)),
    };
    // Titles reachable only through a hidden link go too (recap films chained to each other
    // would otherwise start a second line of their own).
    const reachable = connectedTo(visible, currentId);
    for (const id of keep) if (!reachable.has(id)) keep.delete(id);
    const layout = layoutGraph(visible, keep, this.prefs.posters ? POSTER_SIZE : CARD_SIZE);
    const map = buildMapView(layout, currentId, {
      nextId: model.nextId,
      kinds: model.kinds,
      minimap: this.prefs.minimap,
      onMinimapChange: (minimap) => this.updatePrefs({ minimap }),
    });
    return [map, this.buildLegend(graph)];
  }

  /** The curated order as one line: matched AniList titles in AnimeChrono's order, each once. */
  private buildCuratedMap(
    graph: FranchiseGraph,
    model: ViewModel,
    currentId: number
  ): HTMLElement[] {
    const ids = this.curatedMapIds(graph, 'map') ?? [];
    const line: FranchiseGraph = {
      nodes: new Map(ids.map((id) => [id, graph.nodes.get(id)!])),
      sequels: ids.slice(1).map((to, index) => ({ from: ids[index], to })),
      branches: [],
    };
    const layout = layoutGraph(line, undefined, this.prefs.posters ? POSTER_SIZE : CARD_SIZE);
    return [
      buildMapView(layout, currentId, {
        nextId: model.nextId,
        kinds: model.kinds,
        minimap: this.prefs.minimap,
        onMinimapChange: (minimap) => this.updatePrefs({ minimap }),
      }),
    ];
  }

  /**
   * AniList titles of the curated order, in its order and each once, when the map is laid out
   * that way; null otherwise. Only rows matched with certainty have an AniList title.
   */
  private curatedMapIds(graph: FranchiseGraph | null, view: OrderMode): number[] | null {
    if (view !== 'map' || !this.curated || !this.prefs.curatedMap) return null;
    const ids = this.curated.rows
      .map((row) => row.node?.id)
      .filter((id): id is number => id !== undefined && (!graph || graph.nodes.has(id)));
    return [...new Set(ids)];
  }

  /** Totals of the titles counted in the current view: episodes, films and time to watch. */
  private buildTotals(model: ViewModel): HTMLElement | null {
    const totals = franchiseTotals(model.counted.map((entry) => entry.node));
    const titles = model.curated ? model.total : model.counted.length;
    const parts = [
      `${titles} ${titles === 1 ? 'title' : 'titles'}`,
      ...(totals.episodes
        ? [`${totals.episodes} ${totals.episodes === 1 ? 'episode' : 'episodes'}`]
        : []),
      ...(totals.movies ? [`${totals.movies} ${totals.movies === 1 ? 'movie' : 'movies'}`] : []),
      ...(totals.minutes ? [`${formatRuntime(totals.minutes)} total`] : []),
      ...(totals.minutesLeft && totals.minutesLeft < totals.minutes
        ? [`${formatRuntime(totals.minutesLeft)} left`]
        : []),
    ];
    if (!parts.length) return null;
    const line = el('div', 'au-wo-totals', parts.join(' · '));
    line.title = `Runtime from AniList episode lengths, openings and endings included${
      totals.unknown ? `; ${totals.unknown} title(s) have no known length` : ''
    }.`;
    return line;
  }

  /**
   * Legend of the edge colours. A kind that has titles of its own doubles as a show/hide
   * filter; a kind that only links titles of the main line is listed for reference.
   */
  private buildLegend(graph: FranchiseGraph): HTMLElement {
    const legend = el('div', 'au-wo-legend');
    // Number of relations of each kind in the franchise, hidden ones included.
    const counts = new Map<TitleKind, number>([['MAIN', graph.sequels.length]]);
    for (const edge of graph.branches) {
      const kind = edge.relation as TitleKind;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const swatch = (kind: TitleKind) => {
      const line = el(
        'span',
        `au-wo-swatch${kind === 'MAIN' ? '' : kind === 'SUMMARY' ? ' au-wo-swatch--dotted' : ' au-wo-swatch--dashed'}`
      );
      line.style.setProperty(
        '--wo-kind',
        kind === 'MAIN' ? 'rgb(var(--color-blue))' : KIND_COLOR[kind]
      );
      return line;
    };
    const label = (kind: TitleKind) => `${KIND_LABEL[kind]} (${counts.get(kind) ?? 0})`;
    const main = el('span', 'au-wo-legend-item');
    main.append(swatch('MAIN'), label('MAIN'));
    legend.append(main);
    const hidden = new Set(this.prefs.hiddenKinds);
    for (const kind of BRANCH_KINDS) {
      if (!counts.get(kind)) continue;
      const item = button('au-wo-legend-item', '', () => {
        const next = hidden.has(kind)
          ? this.prefs.hiddenKinds.filter((k) => k !== kind)
          : [...this.prefs.hiddenKinds, kind];
        this.updatePrefs({ hiddenKinds: next });
        this.redraw?.();
      });
      item.append(swatch(kind), label(kind));
      item.setAttribute('aria-pressed', String(!hidden.has(kind)));
      item.title = `${hidden.has(kind) ? 'Show' : 'Hide'} ${KIND_LABEL[kind].toLowerCase()} relations`;
      legend.append(item);
    }
    legend.append(el('span', 'au-wo-legend-hint', 'Drag to pan · Scroll to zoom'));
    return legend;
  }

  /**
   * One plain line about AnimeChrono: the credit, or why its order is missing with a link to load
   * it. AnimeChrono refuses background requests behind a browser check, so the link opens a visible
   * tab that reads the order from the viewer's own session and closes by itself.
   */
  private buildFooter(): HTMLElement | null {
    const footer = el('div', 'au-wo-footer');
    if (this.curated) {
      const link = el('a', '', 'AnimeChrono');
      link.href = this.curated.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const updated = this.curated.order.lastUpdated;
      footer.append('Curated order by ', link, updated ? ` · updated ${updated}` : '');
      footer.title = 'Rows link to AniList only when the match is certain.';
      return footer;
    }
    const status = this.curatedStatus;
    if (!status) return null;
    if (status === 'checking') {
      footer.append('Looking for an AnimeChrono order…');
      return footer;
    }
    if (status === 'opening') {
      footer.append('Reading the order in the AnimeChrono tab…');
      return footer;
    }
    footer.title = `Curated order: ${status}`;
    if (this.captureTried && !status.includes(CURATED_CHALLENGE_REASON)) {
      footer.append('AnimeChrono has no order for this franchise.');
      return footer;
    }
    footer.append(
      status.includes(CURATED_CHALLENGE_REASON) || status.startsWith('unavailable')
        ? 'AnimeChrono order not loaded · '
        : 'No AnimeChrono order found · ',
      this.loadLink()
    );
    return footer;
  }

  private loadLink(): HTMLButtonElement {
    const load = button('au-wo-link', 'Load it from AnimeChrono', () => {
      this.captureTried = true;
      this.curatedStatus = 'opening';
      this.redraw?.();
      void chrome.runtime
        .sendMessage({ type: MSG.WATCH_ORDER_OPEN, titles: this.franchiseTitles })
        .catch(() => undefined);
    });
    load.title = 'Opens AnimeChrono in a tab that closes by itself once the order is read';
    return load;
  }
}
