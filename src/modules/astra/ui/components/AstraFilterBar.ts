/**
 * @file AstraFilterBar.ts
 * @description Component for searching and filtering works.
 * Refactored to use DI and secure `html` templates.
 */

import { injectable, inject } from 'tsyringe';
import { AstraView } from '../base/AstraView';
import { AstraDashboardStore } from '../../store/AstraDashboardStore';
import { IDashboardState } from '../../interfaces/IDashboardState';
import { AstraService } from '../../AstraService';
import { MediaListStatus } from '@/api/AnilistTypes';
import { TOKENS } from '@core/di/tokens';
import { html, when } from '@core/utils/Template';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';

/**
 * Makes `current` match a freshly rendered `next` while keeping each node whose tag lines up,
 * so focus and caret survive. Text inputs hold user-owned values and are never rewritten.
 */
function syncTree(current: Element, next: Element): void {
  if (current instanceof HTMLInputElement) return;
  const keepOpen =
    current.hasAttribute('data-toolbar-dropdown') && current.classList.contains('open');
  for (const { name } of Array.from(current.attributes)) {
    if (!next.hasAttribute(name)) current.removeAttribute(name);
  }
  for (const { name, value } of Array.from(next.attributes)) {
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  }
  // `open` is client-side menu state that the template never renders; keep it across refreshes.
  if (keepOpen) current.classList.add('open');

  const currentNodes = Array.from(current.childNodes);
  const nextNodes = Array.from(next.childNodes);
  currentNodes.forEach((node, index) => {
    const replacement = nextNodes[index];
    if (!replacement) node.remove();
    else if (
      node instanceof Element &&
      replacement instanceof Element &&
      node.tagName === replacement.tagName
    )
      syncTree(node, replacement);
    else if (node.nodeType === Node.TEXT_NODE && replacement.nodeType === Node.TEXT_NODE) {
      if (node.nodeValue !== replacement.nodeValue) node.nodeValue = replacement.nodeValue;
    } else node.replaceWith(replacement);
  });
  current.append(...nextNodes.slice(currentNodes.length));
}

@injectable()
export class AstraFilterBar extends AstraView<IDashboardState> {
  private customLists: string[] = [];
  private customListsLoaded = false;
  private customListsLoading = false;
  /** Cached per mount so rerenders do not refetch a failing list endpoint. */
  private customListsFailed = false;
  /** Snapshot of the list names currently shown, used to skip no-op updates. */
  private renderedListKey = '';
  private listEpoch = 0;
  private unsubscribeAuth: (() => void) | null = null;
  private listContext: ApiContext | undefined;
  private mountVersion = 0;

  constructor(
    @inject(TOKENS.AstraStore) private store: AstraDashboardStore,
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.EventBus) private eventBus?: IEventBus,
    @inject(TOKENS.ApiClient) private api?: IApiClient
  ) {
    super({});
    // Safety re-render after DI assignment
    this.element = this.render();
  }

  protected override onMount(): void {
    const version = ++this.mountVersion;
    this.renderedListKey = this.listKey();
    this.unsubscribeAuth =
      this.eventBus?.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
        if (!this.mounted || version !== this.mountVersion) return;
        this.resetListLoad();
        this.rerender();
      }).unsubscribe ?? null;
  }

  /**
   * Store updates only touch the toolbar when a bar input changed: the filters it draws
   * or the custom-list names it shows. Everything else (works, stats, sort) is ignored.
   */
  protected override shouldUpdate(
    prevProps: Partial<IDashboardState>,
    nextProps: Partial<IDashboardState>
  ): boolean {
    return (
      this.filterKey(prevProps.filters) !== this.filterKey(nextProps.filters) ||
      this.listKey() !== this.renderedListKey
    );
  }

  /** Patches the live toolbar in place; the search field keeps its focus, caret and value. */
  protected override onUpdate(): boolean {
    if (!this.mounted) return false;
    this.refreshInPlace();
    return true;
  }

  protected override onUnmount(): void {
    this.mountVersion++;
    this.unsubscribeAuth?.();
    this.unsubscribeAuth = null;
    super.onUnmount();
  }

  public override unmount(): void {
    if (!this.mounted) return;
    this.resetListLoad();
    super.unmount();
  }

  private resetListLoad(): void {
    this.listEpoch++;
    this.customLists = [];
    this.customListsLoaded = false;
    this.customListsLoading = false;
    this.customListsFailed = false;
    this.listContext = undefined;
  }

  /** Filter fields the toolbar draws. Other store fields never change its markup. */
  private filterKey(filters: IDashboardState['filters'] | undefined): string {
    return JSON.stringify([
      filters?.search,
      filters?.type,
      filters?.ratingStatus,
      filters?.country,
      [...this.getActiveStatuses(filters?.anilistStatus ?? 'all')].sort(),
      filters?.customLists ?? [],
    ]);
  }

  /** Custom-list names and loading state the toolbar currently draws. */
  private listKey(): string {
    const lists = this.customListsLoaded ? this.customLists : this.getManifestCustomLists();
    return JSON.stringify([this.customListsLoading, lists]);
  }

  /**
   * Re-renders the template into the live tree, reusing every node whose tag still lines up.
   */
  private refreshInPlace(): void {
    if (!this.mounted) return;
    syncTree(this.element, this.render());
    this.renderedListKey = this.listKey();
  }

  /**
   * Renders the filter controls and search box.
   */
  protected template(state: Partial<IDashboardState>): HTMLElement {
    if (!this.store || !state || !state.filters) return html`<div></div>`;
    const { filters } = state;
    const isAllActive =
      filters.type === 'all' &&
      filters.ratingStatus === 'all' &&
      filters.anilistStatus === 'all' &&
      filters.country === 'all';
    const activeStatuses = this.getActiveStatuses(filters.anilistStatus);
    const watchingActive =
      filters.type === 'anime' &&
      (activeStatuses.includes(MediaListStatus.CURRENT) ||
        activeStatuses.includes(MediaListStatus.REPEATING));
    const readingActive =
      (filters.type === 'manga' || filters.type === 'novel') &&
      (activeStatuses.includes(MediaListStatus.CURRENT) ||
        activeStatuses.includes(MediaListStatus.REPEATING));
    const watchingLabel =
      filters.type === 'anime' && activeStatuses.includes(MediaListStatus.REPEATING)
        ? 'Rewatching'
        : 'Watching';
    const readingLabel =
      (filters.type === 'manga' || filters.type === 'novel') &&
      activeStatuses.includes(MediaListStatus.REPEATING)
        ? 'Rereading'
        : 'Reading';
    const typeLabel =
      filters.type === 'anime'
        ? 'Anime'
        : filters.type === 'manga'
          ? 'Manga'
          : filters.type === 'novel'
            ? 'Novel'
            : 'Type';
    const countryLabel =
      filters.country === 'JP'
        ? 'Japan'
        : filters.country === 'KR'
          ? 'Korea'
          : filters.country === 'CN'
            ? 'China'
            : filters.country === 'TW'
              ? 'Taiwan'
              : 'Country';
    const customLists = this.customListsLoaded ? this.customLists : this.getManifestCustomLists();
    const selectedLists = filters.customLists || [];
    const prettyList = (v: string) =>
      v === '__hidden__' ? 'Hide from status lists' : v === '__private__' ? 'Private' : v;
    const customListLabel =
      selectedLists.length === 0
        ? 'Custom Lists'
        : selectedLists.length === 1
          ? prettyList(selectedLists[0])
          : `${selectedLists.length} lists`;
    return html`
      <div class="astra-dashboard-controls astra-dashboard-controls--toolbar">
        <div class="astra-filter-toolbar">
          <div class="astra-filter-toolbar-left">
            <button
              type="button"
              class="astra-toolbar-chip ${when(isAllActive, 'active')}"
              data-quick-filter="all"
            >
              <i class="fa-solid fa-layer-group"></i>
              <span>All</span>
            </button>

            <button
              type="button"
              class="astra-toolbar-chip ${when(watchingActive, 'active')}"
              data-quick-filter="watching"
            >
              <i
                class="fa-solid ${when(
                  filters.type === 'anime' && activeStatuses.includes(MediaListStatus.REPEATING),
                  'fa-rotate-right'
                ) || 'fa-play'}"
              ></i>
              <span>${watchingLabel}</span>
            </button>

            <button
              type="button"
              class="astra-toolbar-chip ${when(readingActive, 'active')}"
              data-quick-filter="reading"
            >
              <i
                class="fa-solid ${when(
                  (filters.type === 'manga' || filters.type === 'novel') &&
                    activeStatuses.includes(MediaListStatus.REPEATING),
                  'fa-rotate-right'
                ) || 'fa-book-open'}"
              ></i>
              <span>${readingLabel}</span>
            </button>

            <button
              type="button"
              class="astra-toolbar-chip ${when(
                activeStatuses.includes(MediaListStatus.COMPLETED),
                'active'
              )}"
              data-status-filter="${MediaListStatus.COMPLETED}"
            >
              <i class="fa-solid fa-check"></i>
              <span>Completed</span>
            </button>

            <button
              type="button"
              class="astra-toolbar-chip ${when(
                activeStatuses.includes(MediaListStatus.PAUSED),
                'active'
              )}"
              data-status-filter="${MediaListStatus.PAUSED}"
            >
              <i class="fa-solid fa-pause"></i>
              <span>Paused</span>
            </button>

            <button
              type="button"
              class="astra-toolbar-chip ${when(
                activeStatuses.includes(MediaListStatus.DROPPED),
                'active'
              )}"
              data-status-filter="${MediaListStatus.DROPPED}"
            >
              <i class="fa-solid fa-circle-xmark"></i>
              <span>Dropped</span>
            </button>

            <button
              type="button"
              class="astra-toolbar-chip ${when(
                activeStatuses.includes(MediaListStatus.PLANNING),
                'active'
              )}"
              data-status-filter="${MediaListStatus.PLANNING}"
            >
              <i class="fa-solid fa-calendar"></i>
              <span>Planning</span>
            </button>

            <div class="astra-search-box astra-search-box--toolbar">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input
                type="text"
                id="astra-search"
                placeholder="Search by title..."
                value="${filters.search}"
              />
            </div>

            <span class="astra-toolbar-separator" aria-hidden="true"></span>
          </div>

          <div class="astra-filter-toolbar-right">
            <div
              class="astra-toolbar-dropdown ${when(selectedLists.length > 0, 'active')}"
              data-toolbar-dropdown
            >
              <button
                type="button"
                class="astra-toolbar-chip astra-toolbar-chip--dropdown"
                data-dropdown-trigger
              >
                <i class="fa-solid fa-list"></i>
                <span>${customListLabel}</span>
                <i class="fa-solid fa-chevron-down"></i>
              </button>
              <div class="astra-toolbar-dropdown-menu astra-toolbar-dropdown-menu--wide">
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(selectedLists.length === 0, 'active')}"
                  data-filter-field="customList"
                  data-filter-value="all"
                >
                  Custom Lists
                </button>
                ${this.customListsLoading && customLists.length === 0
                  ? html`<div class="astra-toolbar-dropdown-empty">Loading lists...</div>`
                  : customLists.length > 0
                    ? customLists.map(
                        (list) => html`
                          <button
                            type="button"
                            class="astra-toolbar-dropdown-item astra-toolbar-list-option ${when(
                              selectedLists.includes(list),
                              'active'
                            )}"
                            data-filter-field="customList"
                            data-filter-value="${list}"
                          >
                            <span
                              class="astra-toolbar-checkbox ${when(
                                selectedLists.includes(list),
                                'checked'
                              )}"
                            ></span>
                            <span>${list}</span>
                          </button>
                        `
                      )
                    : html`<div class="astra-toolbar-dropdown-empty">No lists found</div>`}
                <div class="astra-toolbar-dropdown-divider"></div>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item astra-toolbar-list-option ${when(
                    selectedLists.includes('__hidden__'),
                    'active'
                  )}"
                  data-filter-field="customList"
                  data-filter-value="__hidden__"
                >
                  <span
                    class="astra-toolbar-checkbox ${when(
                      selectedLists.includes('__hidden__'),
                      'checked'
                    )}"
                  ></span>
                  <span>Hide from status lists</span>
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item astra-toolbar-list-option ${when(
                    selectedLists.includes('__private__'),
                    'active'
                  )}"
                  data-filter-field="customList"
                  data-filter-value="__private__"
                >
                  <span
                    class="astra-toolbar-checkbox ${when(
                      selectedLists.includes('__private__'),
                      'checked'
                    )}"
                  ></span>
                  <span>Private</span>
                </button>
              </div>
            </div>

            <div
              class="astra-toolbar-dropdown ${when(filters.type !== 'all', 'active')}"
              data-toolbar-dropdown
            >
              <button
                type="button"
                class="astra-toolbar-chip astra-toolbar-chip--dropdown"
                data-dropdown-trigger
              >
                <i class="fa-solid fa-shapes"></i>
                <span>${typeLabel}</span>
                <i class="fa-solid fa-chevron-down"></i>
              </button>
              <div class="astra-toolbar-dropdown-menu">
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.type === 'all', 'active')}"
                  data-filter-field="type"
                  data-filter-value="all"
                >
                  All Types
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.type === 'anime', 'active')}"
                  data-filter-field="type"
                  data-filter-value="anime"
                >
                  Anime
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.type === 'manga', 'active')}"
                  data-filter-field="type"
                  data-filter-value="manga"
                >
                  Manga
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.type === 'novel', 'active')}"
                  data-filter-field="type"
                  data-filter-value="novel"
                >
                  Novel
                </button>
              </div>
            </div>

            <div
              class="astra-toolbar-dropdown ${when(filters.country !== 'all', 'active')}"
              data-toolbar-dropdown
            >
              <button
                type="button"
                class="astra-toolbar-chip astra-toolbar-chip--dropdown"
                data-dropdown-trigger
              >
                <i class="fa-solid fa-globe"></i>
                <span>${countryLabel}</span>
                <i class="fa-solid fa-chevron-down"></i>
              </button>
              <div class="astra-toolbar-dropdown-menu">
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.country === 'all', 'active')}"
                  data-filter-field="country"
                  data-filter-value="all"
                >
                  All Countries
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.country === 'JP', 'active')}"
                  data-filter-field="country"
                  data-filter-value="JP"
                >
                  Japan
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.country === 'KR', 'active')}"
                  data-filter-field="country"
                  data-filter-value="KR"
                >
                  Korea
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.country === 'CN', 'active')}"
                  data-filter-field="country"
                  data-filter-value="CN"
                >
                  China
                </button>
                <button
                  type="button"
                  class="astra-toolbar-dropdown-item ${when(filters.country === 'TW', 'active')}"
                  data-filter-field="country"
                  data-filter-value="TW"
                >
                  Taiwan
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Binds user interaction events to store actions.
   */
  protected bindEvents(): void {
    void this.ensureCustomListsLoaded();

    // Delegated on the root: in-place refreshes rebuild menu items, so per-element
    // listeners would be lost. Same-tag nodes keep their identity, the rest are replaced.
    this.addEventListener(this.element, 'input', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.id === 'astra-search') {
        this.store.setSearch(e.target.value);
      }
    });
    this.addEventListener(this.element, 'click', (e) => this.handleClick(e));

    // Close any open dropdown when clicking outside of it.
    this.addEventListener(document, 'click', (e) => {
      const insideDropdown = (e.target as HTMLElement).closest('[data-toolbar-dropdown]');
      this.$$('[data-toolbar-dropdown]').forEach((dropdown) => {
        if (dropdown !== insideDropdown) dropdown.classList.remove('open');
      });
    });
  }

  private handleClick(event: Event): void {
    if (!(event.target instanceof Element)) return;
    const target = event.target;

    const trigger = target.closest('[data-dropdown-trigger]');
    if (trigger) {
      event.stopPropagation();
      const dropdown = trigger.closest('[data-toolbar-dropdown]');
      this.$$('[data-toolbar-dropdown]').forEach((item) => {
        if (item !== dropdown) item.classList.remove('open');
      });
      dropdown?.classList.toggle('open');
      return;
    }

    const item = target.closest<HTMLElement>('.astra-toolbar-dropdown-item');
    if (item) {
      event.stopPropagation();
      this.applyDropdownItem(item);
      return;
    }

    const quick = target.closest<HTMLElement>('.astra-toolbar-chip[data-quick-filter]');
    if (quick) {
      this.applyQuickFilter(quick.dataset.quickFilter || 'all');
      return;
    }

    const status = target.closest<HTMLElement>('.astra-toolbar-chip[data-status-filter]');
    if (status) this.toggleStatus(status.dataset.statusFilter as MediaListStatus);
  }

  private applyDropdownItem(item: HTMLElement): void {
    const field = item.dataset.filterField as 'type' | 'country' | 'customList' | undefined;
    const value = item.dataset.filterValue;
    if (!field || !value) return;
    // Captured before the store update, which may rebuild the menu contents.
    const dropdown = item.closest('[data-toolbar-dropdown]');

    if (field === 'customList') {
      // Multi-select: 'all' clears; any other value toggles in/out.
      if (value === 'all') {
        this.store.setFilters({ customLists: [] });
      } else {
        const current = this.store.getState().filters.customLists || [];
        const next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
        this.store.setFilters({ customLists: next });
      }
      // Keep the custom-lists menu open so several lists can be picked in one go.
      dropdown?.classList.add('open');
      return;
    }

    this.store.setFilters({ [field]: value });
    dropdown?.classList.remove('open');
  }

  private getActiveStatuses(
    status: IDashboardState['filters']['anilistStatus']
  ): MediaListStatus[] {
    return status === 'all' ? [] : Array.isArray(status) ? status : [status];
  }

  private toggleStatus(status: MediaListStatus): void {
    const current = this.getActiveStatuses(this.store.getState().filters.anilistStatus);
    const next = current.includes(status)
      ? current.filter((activeStatus) => activeStatus !== status)
      : [...current, status];

    this.store.setFilters({ anilistStatus: next.length > 0 ? next : 'all' });
  }

  private applyQuickFilter(filter: string): void {
    const state = this.store.getState();
    const current = state.filters;
    const activeStatuses = this.getActiveStatuses(current.anilistStatus);

    switch (filter) {
      case 'watching': {
        const nextWatchingStatuses = this.cycleCurrentRepeating(activeStatuses);
        this.store.setFilters({
          type:
            current.type === 'anime' && activeStatuses.includes(MediaListStatus.REPEATING)
              ? 'all'
              : 'anime',
          anilistStatus: nextWatchingStatuses.length > 0 ? nextWatchingStatuses : 'all',
        });
        return;
      }
      case 'reading': {
        const nextReadingStatuses = this.cycleCurrentRepeating(activeStatuses);
        this.store.setFilters({
          type:
            (current.type === 'manga' || current.type === 'novel') &&
            activeStatuses.includes(MediaListStatus.REPEATING)
              ? 'all'
              : current.type === 'novel'
                ? 'novel'
                : 'manga',
          anilistStatus: nextReadingStatuses.length > 0 ? nextReadingStatuses : 'all',
        });
        return;
      }
      default:
        this.store.setFilters({
          type: 'all',
          ratingStatus: 'all',
          anilistStatus: 'all',
          country: 'all',
          customLists: [],
        });
    }
  }

  private getManifestCustomLists(): string[] {
    const names = new Set<string>();
    this.service.getWorks().forEach((work) => {
      work.customLists?.forEach((list) => {
        if (list) names.add(list);
      });
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  private async ensureCustomListsLoaded(): Promise<void> {
    const live = this.api?.getContext?.();
    if (
      this.listContext &&
      (live?.sessionId !== this.listContext.sessionId || live.userId !== this.listContext.userId)
    )
      this.resetListLoad();
    // A failed fetch is cached for this mount; unmount or an account change resets it.
    if (this.customListsLoaded || this.customListsLoading || this.customListsFailed) return;
    const epoch = this.listEpoch;
    let context: ApiContext | undefined;
    const current = () => {
      if (!this.mounted || !this.element.isConnected || this.listEpoch !== epoch) return false;
      try {
        if (this.api) assertApiContext(this.api, context);
        return true;
      } catch {
        return false;
      }
    };
    let outcome: 'loaded' | 'failed' | undefined;
    this.customListsLoading = true;
    try {
      context = this.api ? await captureApiContext(this.api) : undefined;
      if (!current()) return;
      this.listContext = context ? { ...context } : undefined;
      const lists = await this.service.getAniListCustomLists();
      if (!current()) return;
      this.customLists = [...lists];
      this.customListsLoaded = true;
      outcome = 'loaded';
    } catch {
      if (!current()) return;
      this.customListsFailed = true;
      outcome = 'failed';
    } finally {
      if (this.listEpoch === epoch) this.customListsLoading = false;
    }
    // Patch the names in place after loading has ended, so the search field is not rebuilt.
    if (outcome) this.refreshInPlace();
  }

  private cycleCurrentRepeating(statuses: MediaListStatus[]): MediaListStatus[] {
    const withoutCurrentRepeating = statuses.filter(
      (status) => status !== MediaListStatus.CURRENT && status !== MediaListStatus.REPEATING
    );

    if (statuses.includes(MediaListStatus.REPEATING)) {
      return withoutCurrentRepeating;
    }

    return [
      ...withoutCurrentRepeating,
      statuses.includes(MediaListStatus.CURRENT)
        ? MediaListStatus.REPEATING
        : MediaListStatus.CURRENT,
    ];
  }
}
