/**
 * @file SocialSidebar.ts
 * @description Fixed sidebar displaying detailed friend activity for a specific media.
 */

import { injectable, inject } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { SocialService } from '../SocialService';
import { MediaListStatus, MediaType, SocialActivityDetailed, SocialFilter } from '@core/types';
import { ScoreFormatter } from '@core/utils/ScoreFormatter';
import { getStatusLabel } from '@core/utils/UIHelpers';
import { CustomListService } from '../CustomListService';
import { logger } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { html } from '@core/utils/Template';
import { cssImageUrl, parseWebUrl } from '@core/utils/WebUrl';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { EventSubscription, IEventBus } from '@core/interfaces/IEventBus';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { ToastService } from '@core/services/ToastService';
import { SocialPaginationLimitError } from '../SocialResponse';

interface SidebarScope {
  version: number;
  context?: ApiContext;
}

const DEFAULT_TITLE = 'Social Activity';
const CUSTOM_LISTS_LABEL = 'Lists';
/** Rows after this index appear together, so long pages do not trickle in. */
const MAX_STAGGERED_ROWS = 10;
const ROW_STAGGER_SECONDS = 0.035;
const SKELETON_ROWS = 4;
/** Extra pages a search may auto-load per session while its matches leave the panel unfilled. */
const MAX_SEARCH_AUTOLOAD_PAGES = 5;
/** Scroll room below which filtered rows count as not filling the panel (matches the near-bottom trigger). */
const UNFILLED_PANEL_PX = 100;
/** Statuses whose episode/chapter count says where the user is (or stopped). */
const PROGRESS_STATUSES: ReadonlySet<MediaListStatus> = new Set([
  MediaListStatus.CURRENT,
  MediaListStatus.REPEATING,
  MediaListStatus.PAUSED,
  MediaListStatus.DROPPED,
]);
const STATUS_NAMES: Partial<Record<MediaListStatus, string>> = {
  [MediaListStatus.PLANNING]: 'Planning',
  [MediaListStatus.COMPLETED]: 'Completed',
  [MediaListStatus.PAUSED]: 'Paused',
  [MediaListStatus.DROPPED]: 'Dropped',
};

/**
 * Offset pages sorted by update time can repeat an entry that moved between requests,
 * so appended pages keep only the first occurrence of each entry id.
 */
function appendUniqueEntries(
  existing: readonly SocialActivityDetailed[],
  incoming: readonly SocialActivityDetailed[]
): SocialActivityDetailed[] {
  const seen = new Set(existing.map((node) => node.id));
  const merged = [...existing];
  for (const node of incoming) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    merged.push(node);
  }
  return merged;
}

/**
 * One mounted sidebar owns its requests, subscriptions and row actions.
 * The newest selection wins; accepted list writes remain owned by the background.
 */
@injectable()
export class SocialSidebar extends BaseComponent {
  private currentMediaId: number | null = null;
  private currentFilter: SocialFilter = 'self';
  private currentCustomList: string | null = null;
  private currentStatus: MediaListStatus | 'all' = 'all';
  private searchQuery: string = '';
  private currentPage = 1;
  private hasNextPage = true;
  private isLoading = false;
  private animateNextRender = false;
  private currentAnchor: HTMLElement | null = null;
  private currentAnimeTitle: string = '';
  private currentMediaType: MediaType = 'ANIME';
  private lastLoadedNodes: SocialActivityDetailed[] = [];
  /** Set when the first page failed, so its Retry panel is never re-rendered over. */
  private loadFailed = false;
  /** Automatic page loads spent on the current search session. */
  private searchAutoloadPages = 0;
  private version = 0;
  private lifecycleVersion = 0;
  private subscriptions: EventSubscription[] = [];

  constructor(
    @inject(TOKENS.SocialService) private socialService: SocialService,
    @inject(TOKENS.CustomListService) private customListService: CustomListService,
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.EventBus) private bus: IEventBus,
    @inject(TOKENS.ToastService) private toast: ToastService
  ) {
    super({});
  }

  protected override onMount(): void {
    this.lifecycleVersion++;
    this.subscriptions.push(
      this.bus.on(EVENT_TYPES.PAGE_CHANGED, () => this.close()),
      this.bus.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
        this.lifecycleVersion++;
        this.close();
        this.currentFilter = 'self';
        this.currentCustomList = null;
        this.currentStatus = 'all';
        this.$$('.au-filter').forEach((f) =>
          f.classList.toggle('active', f.dataset.type === 'self')
        );
        this.syncStatusChips();
        this.syncTabs();
        this.$('#au-custom-lists-menu')?.replaceChildren();
        this.refreshCustomLists();
      })
    );
  }

  protected override onUnmount(): void {
    this.lifecycleVersion++;
    this.close();
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
    this.subscriptions = [];
  }

  private capture(version = this.version): SidebarScope {
    const context = this.api.getContext?.();
    return { version, ...(context ? { context: { ...context } } : {}) };
  }

  private current(scope: SidebarScope, lifecycle = false): boolean {
    if (!this.mounted || scope.version !== (lifecycle ? this.lifecycleVersion : this.version))
      return false;
    if (!scope.context) return true; // Adapters without an auth context.
    const context = this.api.getContext?.();
    return (
      context?.sessionId === scope.context.sessionId && context.userId === scope.context.userId
    );
  }

  private invalidateSelection(): void {
    this.version++;
    this.isLoading = false;
    this.lastLoadedNodes = [];
    this.loadFailed = false;
    this.searchAutoloadPages = 0;
  }

  /**
   * Renders the base sidebar structure using secure templates.
   */
  protected render(): HTMLElement {
    return html`
      <aside
        class="au-social-sidebar"
        id="au-social-sidebar"
        aria-label="Social activity"
        aria-hidden="true"
      >
        <header class="au-social-header">
          <div class="au-social-backdrop" aria-hidden="true"></div>
          <div class="au-social-cover" aria-hidden="true">
            <span class="au-social-cover-initial"></span>
          </div>
          <div class="au-social-heading">
            <span class="au-social-eyebrow">Social activity</span>
            <h3 class="au-social-title">${DEFAULT_TITLE}</h3>
            <span class="au-social-summary" id="au-social-summary" aria-live="polite"></span>
          </div>
          <button
            type="button"
            class="au-social-close"
            title="Close"
            aria-label="Close social activity"
            id="au-social-close"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </header>
        <div class="au-social-controls">
          <div class="au-social-tabs has-active" role="tablist" aria-label="Whose activity">
            <span class="au-social-tab-indicator" aria-hidden="true"></span>
            <button
              type="button"
              class="au-filter active"
              data-type="self"
              role="tab"
              aria-selected="true"
            >
              Self
            </button>
            <button
              type="button"
              class="au-filter"
              data-type="following"
              role="tab"
              aria-selected="false"
            >
              Following
            </button>
            <div
              class="au-filter au-filter-dropdown"
              data-type="custom-lists"
              id="au-custom-lists-trigger"
              role="tab"
              tabindex="0"
              aria-selected="false"
              aria-haspopup="listbox"
              aria-expanded="false"
            >
              <span class="au-filter-label">${CUSTOM_LISTS_LABEL}</span>
              <i class="fa-solid fa-chevron-down au-filter-caret"></i>
              <div
                class="au-filter-dropdown-menu"
                style="display: none;"
                id="au-custom-lists-menu"
                role="listbox"
                aria-label="Custom lists"
              ></div>
            </div>
            <button
              type="button"
              class="au-filter"
              data-type="global"
              role="tab"
              aria-selected="false"
            >
              Global
            </button>
          </div>
          <div class="au-status-tabs" role="group" aria-label="Filter by status">
            <button
              type="button"
              class="au-status-filter au-status--all active"
              data-status="all"
              aria-pressed="true"
            >
              All
            </button>
            <button
              type="button"
              class="au-status-filter au-status--current"
              data-status="${MediaListStatus.CURRENT}"
              aria-pressed="false"
            >
              <span class="au-status-label">Watching</span>
            </button>
            <button
              type="button"
              class="au-status-filter au-status--planning"
              data-status="${MediaListStatus.PLANNING}"
              aria-pressed="false"
            >
              Planning
            </button>
            <button
              type="button"
              class="au-status-filter au-status--completed"
              data-status="${MediaListStatus.COMPLETED}"
              aria-pressed="false"
            >
              Completed
            </button>
            <button
              type="button"
              class="au-status-filter au-status--paused"
              data-status="${MediaListStatus.PAUSED}"
              aria-pressed="false"
            >
              Paused
            </button>
            <button
              type="button"
              class="au-status-filter au-status--dropped"
              data-status="${MediaListStatus.DROPPED}"
              aria-pressed="false"
            >
              Dropped
            </button>
          </div>
          <div class="au-social-search-wrapper">
            <div class="au-social-search-inner">
              <i class="fa-solid fa-magnifying-glass au-social-search-icon"></i>
              <input
                type="text"
                class="au-social-search-input"
                id="au-social-search"
                placeholder="Search friends or notes..."
                aria-label="Search friends or notes"
                autocomplete="off"
                spellcheck="false"
              />
              <button
                type="button"
                class="au-social-search-clear"
                id="au-social-search-clear"
                aria-label="Clear search"
                hidden
              >
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>
        </div>
        <div class="au-social-content" id="au-social-content">
          <div class="au-social-empty">Select an anime to see activity</div>
        </div>
      </aside>
    `;
  }

  /**
   * Attaches events using a mix of direct binding and delegation.
   */
  protected attachEvents(): void {
    // 1. External Events
    // Managed listeners: BaseComponent removes them on unmount/destroy.
    this.addEventListener(window, 'au-open-social-sidebar', (e) => {
      const detail: unknown = (e as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object') return;
      const data = detail as Record<string, unknown>;
      if (
        typeof data.mediaId !== 'number' ||
        typeof data.title !== 'string' ||
        (data.type !== undefined && data.type !== 'ANIME' && data.type !== 'MANGA') ||
        (data.element !== undefined && !(data.element instanceof HTMLElement))
      )
        return;
      this.open(data.mediaId, data.title, data.element as HTMLElement | undefined, data.type);
    });

    // 2. Navigation & Actions
    const closeButton = this.$('#au-social-close');
    if (closeButton) this.addEventListener(closeButton, 'click', () => this.close());

    this.$$('.au-filter:not(.au-filter-dropdown)').forEach((filter) => {
      this.addEventListener(filter, 'click', () => {
        const type = filter.getAttribute('data-type') as SocialFilter;
        this.setFilter(type);
      });
    });

    const dropdownTrigger = this.$('#au-custom-lists-trigger');
    const dropdownMenu = this.$('#au-custom-lists-menu');
    if (dropdownTrigger && dropdownMenu) {
      this.addEventListener(dropdownTrigger, 'click', (e) => {
        e.stopPropagation();
        this.setListsMenuOpen(dropdownMenu.style.display !== 'block');
      });
      this.addEventListener(dropdownTrigger, 'keydown', (e) => {
        if (!(e instanceof KeyboardEvent) || (e.key !== 'Enter' && e.key !== ' ')) return;
        const item =
          e.target instanceof Element ? e.target.closest<HTMLElement>('[data-list-name]') : null;
        e.preventDefault();
        e.stopPropagation();
        if (item && dropdownMenu.contains(item)) this.setCustomListFilter(item.dataset.listName!);
        else this.setListsMenuOpen(dropdownMenu.style.display !== 'block');
      });
      this.addEventListener(dropdownMenu, 'click', (e) => {
        if (!(e.target instanceof Element)) return;
        const item = e.target.closest<HTMLElement>('[data-list-name]');
        if (!item || !dropdownMenu.contains(item)) return;
        e.stopPropagation();
        this.setCustomListFilter(item.dataset.listName!);
      });
    }

    this.addEventListener(document, 'click', () => this.setListsMenuOpen(false));

    this.$$('.au-status-filter').forEach((filter) => {
      this.addEventListener(filter, 'click', () => {
        const status = filter.getAttribute('data-status')!;
        this.setStatus(status);
      });
    });

    // 3. Search & Scroll
    const searchInput = this.$('#au-social-search') as HTMLInputElement;
    if (searchInput) {
      this.addEventListener(searchInput, 'input', (e) => {
        this.setSearchQuery((e.target as HTMLInputElement).value);
      });
    }
    const searchClear = this.$('#au-social-search-clear');
    if (searchClear && searchInput) {
      this.addEventListener(searchClear, 'click', () => {
        searchInput.value = '';
        this.setSearchQuery('');
        searchInput.focus();
      });
    }

    const content = this.$('#au-social-content');
    if (content) {
      this.addEventListener(content, 'scroll', () => {
        const distanceToBottom = content.scrollHeight - content.scrollTop - content.clientHeight;
        if (
          distanceToBottom < 100 &&
          this.hasNextPage &&
          !this.isLoading &&
          !this.loadFailed &&
          this.currentMediaId
        ) {
          void this.loadData(this.currentMediaId, this.currentPage + 1);
        }
      });

      // EVENT DELEGATION for activity rows
      this.addEventListener(content, 'click', (e) => {
        void this.handleContentClick(e).catch((error) =>
          logger.error('[SocialSidebar] Action failed', error)
        );
      });
      this.addEventListener(content, 'keydown', (e) => {
        if (
          !(e instanceof KeyboardEvent) ||
          e.key !== 'Enter' ||
          !(e.target instanceof Element) ||
          !e.target.matches('.au-friend-row')
        )
          return;
        e.preventDefault();
        void this.handleContentClick(e).catch((error) =>
          logger.error('[SocialSidebar] Action failed', error)
        );
      });
    }

    // 4. Keyboard
    this.addEventListener(window, 'keydown', ((e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.element.classList.contains('active')) {
        this.close();
      }
    }) as EventListener);

    // Initialize custom lists
    this.refreshCustomLists();
  }

  /**
   * Handles all clicks inside the social content area via delegation.
   * @private
   */
  private async handleContentClick(e: Event): Promise<void> {
    if (!this.mounted || !this.currentMediaId || !(e.target instanceof Element)) return;
    const target = e.target;
    if (target.closest('.au-social-retry')) {
      void this.loadData(this.currentMediaId, 1);
      return;
    }
    const row = target.closest<HTMLElement>('.au-friend-row');
    if (!row || !this.element.contains(row)) return;
    const userName = row.dataset.userName;
    if (!userName) return;

    const encodedName = encodeURIComponent(userName);
    if (target.closest('.au-friend-avatar-link, [data-profile-link]')) {
      window.open(`/user/${encodedName}`, '_blank', 'noopener');
    } else {
      const list = this.currentMediaType === 'MANGA' ? 'mangalist' : 'animelist';
      window.open(
        `/user/${encodedName}/${list}?search=${encodeURIComponent(this.currentAnimeTitle)}`,
        '_blank',
        'noopener'
      );
    }
  }

  private async populateCustomListsDropdown(): Promise<void> {
    const scope = this.capture(this.lifecycleVersion);
    try {
      await this.customListService.init();
      if (!this.current(scope, true)) return;
      const menu = this.$('#au-custom-lists-menu');
      if (!menu) return;
      menu.replaceChildren();
      const listNames = Object.keys(this.customListService.getLists());
      if (this.currentCustomList && !listNames.includes(this.currentCustomList))
        this.leaveDeletedCustomList();
      if (listNames.length === 0) {
        menu.appendChild(
          html`<div class="au-dropdown-item au-dropdown-empty">
            No lists yet. Create one in Settings.
          </div>`
        );
        return;
      }
      for (const name of listNames) {
        const count = this.customListService.getList(name).length;
        menu.appendChild(html`
          <div
            class="au-dropdown-item"
            data-list-name="${name}"
            role="option"
            tabindex="0"
            aria-selected="false"
          >
            <i class="fa-solid fa-list-ul"></i>
            <span class="au-dropdown-item-name">${name}</span>
            <span class="au-dropdown-item-count">${count}</span>
          </div>
        `);
      }
      this.syncListsMenu();
    } catch (error) {
      if (this.current(scope, true)) throw error;
    }
  }

  /** Re-reads the lists menu; failures are logged rather than thrown into UI events. */
  private refreshCustomLists(): void {
    void this.populateCustomListsDropdown().catch((error) =>
      logger.error('[SocialSidebar] Lists failed', error)
    );
  }

  /** A list deleted elsewhere cannot keep filtering, so fall back to the Following feed. */
  private leaveDeletedCustomList(): void {
    this.currentCustomList = null;
    this.$$('.au-filter').forEach((f) =>
      f.classList.toggle('active', f.dataset.type === this.currentFilter)
    );
    this.syncTabs();
    if (this.currentMediaId)
      void this.loadData(this.currentMediaId, 1).catch((error: unknown) =>
        logger.error('[SocialSidebar] Load failed', error)
      );
  }

  private setListsMenuOpen(open: boolean): void {
    const menu = this.$('#au-custom-lists-menu');
    if (!menu) return;
    menu.style.display = open ? 'block' : 'none';
    this.$('#au-custom-lists-trigger')?.setAttribute('aria-expanded', String(open));
    // Lists can change in Settings or the banner while the sidebar stays mounted.
    if (open) this.refreshCustomLists();
  }

  private setCustomListFilter(listName: string): void {
    if (!this.mounted) return;
    this.currentFilter = 'following';
    this.currentCustomList = listName;
    this.currentPage = 1;
    this.hasNextPage = true;

    this.$$('.au-filter').forEach((f) => f.classList.remove('active'));
    this.$('#au-custom-lists-trigger')?.classList.add('active');
    this.syncTabs();
    this.setListsMenuOpen(false);

    if (this.currentMediaId)
      void this.loadData(this.currentMediaId, 1).catch((error: unknown) =>
        logger.error('[SocialSidebar] Load failed', error)
      );
  }

  public open(
    mediaId: number,
    title: string,
    anchor?: HTMLElement,
    type: MediaType = 'ANIME'
  ): void {
    if (
      !this.mounted ||
      !Number.isSafeInteger(mediaId) ||
      mediaId <= 0 ||
      mediaId > 2147483647 ||
      typeof title !== 'string' ||
      (type !== 'ANIME' && type !== 'MANGA')
    )
      return;
    if (this.currentMediaId === mediaId && this.element.classList.contains('active')) return;

    this.currentMediaId = mediaId;
    this.currentAnimeTitle = title;
    this.currentMediaType = type;
    this.currentPage = 1;
    this.hasNextPage = true;

    const titleEl = this.$('.au-social-title');
    if (titleEl) {
      titleEl.textContent = title;
      titleEl.title = title;
    }
    const currentLabel = this.$('.au-status-filter[data-status="CURRENT"] .au-status-label');
    if (currentLabel) currentLabel.textContent = getStatusLabel(MediaListStatus.CURRENT, type);
    this.setHeaderArtwork(title, this.resolveCover(anchor));
    this.element.classList.add('active');
    this.element.setAttribute('aria-hidden', 'false');

    if (this.currentAnchor) this.currentAnchor.classList.remove('au-anime-active');
    this.currentAnchor = null;
    if (anchor) {
      this.currentAnchor = anchor;
      this.currentAnchor.classList.add('au-anime-active');
    }

    this.refreshCustomLists();
    void this.loadData(mediaId, 1).catch((error: unknown) =>
      logger.error('[SocialSidebar] Load failed', error)
    );
  }

  public close(): void {
    this.invalidateSelection();
    this.element.classList.remove('active');
    this.element.setAttribute('aria-hidden', 'true');
    this.currentMediaId = null;
    this.currentAnimeTitle = '';
    this.currentPage = 1;
    this.hasNextPage = false;
    this.searchQuery = '';
    const search = this.$<HTMLInputElement>('#au-social-search');
    if (search) search.value = '';
    this.$('#au-social-search-clear')?.toggleAttribute('hidden', true);
    const title = this.$('.au-social-title');
    if (title) {
      title.textContent = DEFAULT_TITLE;
      title.removeAttribute('title');
    }
    this.setHeaderArtwork('', null);
    this.setSummary('');
    this.$('#au-social-content')?.replaceChildren();
    this.setListsMenuOpen(false);
    if (this.currentAnchor) {
      this.currentAnchor.classList.remove('au-anime-active');
      this.currentAnchor = null;
    }
  }

  /** The cover shown by the card that opened the sidebar, if it has one. */
  private resolveCover(anchor?: HTMLElement): string | null {
    if (!anchor) return null;
    const image =
      anchor.querySelector<HTMLImageElement>('.anime-card__image, img.image, .cover img') ??
      anchor.querySelector<HTMLImageElement>('img');
    return parseWebUrl(image?.currentSrc || image?.getAttribute('src'))?.href ?? null;
  }

  private setHeaderArtwork(title: string, cover: string | null): void {
    const header = this.$('.au-social-header');
    const image = cover ? cssImageUrl(cover) : '';
    header?.classList.toggle('has-cover', Boolean(cover));
    this.$$<HTMLElement>('.au-social-backdrop, .au-social-cover').forEach((element) => {
      element.style.backgroundImage = image;
    });
    const initial = this.$('.au-social-cover-initial');
    if (initial) initial.textContent = title.trim().charAt(0).toUpperCase();
  }

  private setFilter(type: SocialFilter): void {
    if (!this.mounted || !['self', 'following', 'global', 'friends'].includes(type)) return;
    if (this.currentFilter === type && !this.currentCustomList) return;

    this.currentFilter = type;
    this.currentCustomList = null;
    this.currentPage = 1;
    this.hasNextPage = true;

    this.$$('.au-filter').forEach((f) => {
      f.classList.toggle('active', f.getAttribute('data-type') === type);
    });
    this.syncTabs();

    if (this.currentMediaId)
      void this.loadData(this.currentMediaId, 1).catch((error: unknown) =>
        logger.error('[SocialSidebar] Load failed', error)
      );
  }

  /** Mirrors the active tab into ARIA state, the sliding indicator and the lists label. */
  private syncTabs(): void {
    const tabs = [...this.$$<HTMLElement>('.au-social-tabs .au-filter')];
    const activeIndex = tabs.findIndex((tab) => tab.classList.contains('active'));
    tabs.forEach((tab) =>
      tab.setAttribute('aria-selected', String(tab.classList.contains('active')))
    );
    const container = this.$('.au-social-tabs');
    container?.style.setProperty('--au-tab-index', String(Math.max(activeIndex, 0)));
    container?.classList.toggle('has-active', activeIndex >= 0);
    const label = this.$('#au-custom-lists-trigger .au-filter-label');
    if (label) label.textContent = this.currentCustomList ?? CUSTOM_LISTS_LABEL;
    this.$('#au-custom-lists-trigger')?.setAttribute(
      'title',
      this.currentCustomList ?? 'Custom lists'
    );
    this.syncListsMenu();
  }

  private syncListsMenu(): void {
    this.$$('#au-custom-lists-menu [data-list-name]').forEach((item) => {
      const selected = item.dataset.listName === this.currentCustomList;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
    });
  }

  private syncStatusChips(): void {
    this.$$('.au-status-filter').forEach((f) => {
      const active = f.getAttribute('data-status') === this.currentStatus;
      f.classList.toggle('active', active);
      f.setAttribute('aria-pressed', String(active));
    });
  }

  private setStatus(status: string): void {
    if (
      !this.mounted ||
      (status !== 'all' && !Object.values(MediaListStatus).includes(status as MediaListStatus))
    )
      return;
    const statusVal = status === 'all' ? 'all' : (status as MediaListStatus);
    if (this.currentStatus === statusVal) return;

    this.currentStatus = statusVal;
    this.currentPage = 1;
    this.hasNextPage = true;
    this.syncStatusChips();

    if (this.currentMediaId)
      void this.loadData(this.currentMediaId, 1).catch((error: unknown) =>
        logger.error('[SocialSidebar] Load failed', error)
      );
  }

  private setSearchQuery(value: string): void {
    const wasSearching = this.searchQuery !== '';
    this.searchQuery = value.trim().toLowerCase();
    if (!wasSearching && this.searchQuery) this.searchAutoloadPages = 0;
    this.$('#au-social-search-clear')?.toggleAttribute('hidden', value.length === 0);
    // A failed first page keeps its Retry panel; re-rendering here would show a false empty state.
    if (!this.isLoading && !this.loadFailed) this.refreshEntries();
    this.loadMoreForSearchIfUnfilled();
  }

  private async loadData(mediaId: number, page: number): Promise<void> {
    if (!this.mounted || mediaId !== this.currentMediaId || (page > 1 && this.isLoading)) return;
    if (page === 1) this.invalidateSelection();
    const scope = this.capture();
    const content = this.$('#au-social-content');
    if (!content || !this.current(scope)) return;
    const fetchFilter =
      this.currentFilter === 'friends' || this.currentCustomList ? 'following' : this.currentFilter;
    const selectedUsers = this.currentCustomList
      ? this.customListService.getList(this.currentCustomList).map((user) => user.id)
      : this.currentFilter === 'friends'
        ? this.customListService.getList('Best Friends').map((user) => user.id)
        : undefined;
    const status = this.currentStatus;
    const loader =
      page === 1
        ? this.renderSkeleton()
        : html`<div class="au-social-loading au-social-more" id="au-social-more-loader">
            <i class="fa-solid fa-spinner fa-spin"></i><span>Loading more</span>
          </div>`;
    if (page === 1) {
      content.replaceChildren();
      content.scrollTop = 0;
      this.setSummary('Loading activity…');
    }
    content.append(loader);
    this.isLoading = true;
    let loaded = false;

    try {
      const { nodes, hasNextPage } =
        selectedUsers === undefined
          ? await this.socialService.getDetailedActivity(mediaId, fetchFilter, page, status)
          : await this.socialService.getDetailedActivity(
              mediaId,
              fetchFilter,
              page,
              status,
              selectedUsers
            );
      if (!this.current(scope)) return;
      this.currentPage = page;
      this.hasNextPage = hasNextPage;
      this.lastLoadedNodes = appendUniqueEntries(page === 1 ? [] : this.lastLoadedNodes, nodes);
      this.animateNextRender = page === 1;
      this.refreshEntries();
      loaded = true;
    } catch (error) {
      if (!this.current(scope)) return;
      logger.error('[SocialSidebar] Load failed', error);
      if (page === 1) {
        this.loadFailed = true;
        this.setSummary('');
        content.replaceChildren(html`
          <div class="au-social-empty au-social-error">
            <span class="au-social-empty-icon"
              ><i class="fa-solid fa-triangle-exclamation"></i
            ></span>
            <strong class="au-social-empty-title">Couldn't load activity</strong>
            <span class="au-social-empty-text"
              >Failed to load activity. Is it available for this media?</span
            >
            <button type="button" class="au-social-retry">
              <i class="fa-solid fa-arrows-rotate"></i> Try again
            </button>
          </div>
        `);
      } else {
        if (error instanceof SocialPaginationLimitError) {
          this.hasNextPage = false;
          this.toast.error('AniList pagination limit reached. The displayed list is incomplete.');
        } else this.toast.error('Could not load more activity. Scroll to retry.');
      }
    } finally {
      // Removing this exact loader is safe even if a newer request owns the panel.
      loader.remove();
      if (this.current(scope)) this.isLoading = false;
    }
    // Runs after the finally above releases isLoading; a load started inside try would be unlocked by it.
    if (loaded && this.current(scope)) this.loadMoreForSearchIfUnfilled();
  }

  private renderSkeleton(): HTMLElement {
    const loader = html`<div
      class="au-social-loading au-social-skeleton"
      role="status"
      aria-label="Loading activity"
    ></div>`;
    for (let i = 0; i < SKELETON_ROWS; i++) {
      loader.appendChild(html`
        <div class="au-skeleton-row" aria-hidden="true">
          <span class="au-skeleton-avatar"></span>
          <span class="au-skeleton-lines"><span></span><span></span><span></span></span>
        </div>
      `);
    }
    return loader;
  }

  private refreshEntries(): void {
    let filtered = this.lastLoadedNodes;

    // Local filtering for Friends/Custom Lists
    if (this.currentFilter === 'friends') {
      filtered = filtered.filter((node) =>
        this.customListService.isUserInList('Best Friends', node.user.id)
      );
    } else if (this.currentCustomList) {
      const listUsers = this.customListService.getList(this.currentCustomList);
      const userIds = new Set(listUsers.map((user) => user.id));
      filtered = filtered.filter((node) => userIds.has(node.user.id));
    }

    if (this.searchQuery) {
      filtered = filtered.filter(
        (node) =>
          node.user.name.toLowerCase().includes(this.searchQuery) ||
          (node.notes && node.notes.toLowerCase().includes(this.searchQuery))
      );
    }

    this.renderEntries(filtered);
  }

  /**
   * Matches on later pages are reachable only by scrolling, which needs overflow.
   * While a search is active, load ahead (bounded per session) when the rows leave the panel unfilled.
   */
  private loadMoreForSearchIfUnfilled(): void {
    if (
      !this.searchQuery ||
      !this.hasNextPage ||
      this.isLoading ||
      this.loadFailed ||
      !this.currentMediaId
    )
      return;
    if (this.searchAutoloadPages >= MAX_SEARCH_AUTOLOAD_PAGES) return;
    const content = this.$('#au-social-content');
    if (!content || content.scrollHeight - content.clientHeight > UNFILLED_PANEL_PX) return;
    this.searchAutoloadPages++;
    void this.loadData(this.currentMediaId, this.currentPage + 1).catch((error: unknown) =>
      logger.error('[SocialSidebar] Load failed', error)
    );
  }

  /**
   * Renders activity rows using secure templates.
   * @private
   */
  private renderEntries(nodes: SocialActivityDetailed[]): void {
    const content = this.$('#au-social-content')!;
    const animate = this.animateNextRender;
    this.animateNextRender = false;
    content.replaceChildren();
    this.setSummary(this.describeResults(nodes.length));

    if (nodes.length === 0) {
      content.appendChild(this.renderEmptyState());
      return;
    }

    content.classList.toggle('au-social-content--animated', animate);
    nodes.forEach((node, i) => content.appendChild(this.renderRow(node, i)));
  }

  private renderRow(node: SocialActivityDetailed, index: number): HTMLElement {
    const format = node.user.mediaListOptions?.scoreFormat || 'POINT_100';
    const formattedScore = ScoreFormatter.format(node.score, format);
    const scoreColor = ScoreFormatter.getColor(node.score);
    const isMalSync =
      node.notes && (node.notes.includes('malSync::') || node.notes.includes('autotrack'));
    const relativeTime = node.updatedAt > 0 ? this.timeAgo(node.updatedAt * 1000) : '';
    const statusClass = `au-status--${node.status.toLowerCase()}`;
    const delay = Math.min(index, MAX_STAGGERED_ROWS) * ROW_STAGGER_SECONDS;
    const listName = this.currentMediaType === 'MANGA' ? 'manga list' : 'anime list';

    return html`
      <div
        class="au-friend-row ${statusClass}"
        data-user-id="${node.user.id}"
        data-user-name="${node.user.name}"
        role="link"
        tabindex="0"
        aria-label="Open ${node.user.name}'s ${listName}"
        style="animation-delay: ${delay}s"
      >
        <div class="au-friend-avatar-link" title="Open profile">
          <img
            src="${node.user.avatar.medium}"
            alt="${node.user.name}"
            loading="lazy"
            decoding="async"
          />
          <span class="au-friend-status-dot" aria-hidden="true"></span>
        </div>
        <div class="au-friend-info">
          <div class="au-friend-header">
            <span class="au-friend-name" data-profile-link="true" title="Open profile"
              >${node.user.name}</span
            >
            <span class="au-friend-date">${relativeTime}</span>
          </div>
          <div class="au-friend-meta">
            <span class="au-friend-status ${statusClass}">${this.formatStatus(node)}</span>
            ${node.score > 0
              ? html`<span
                  class="au-friend-score"
                  style="--au-score-color: ${scoreColor}"
                  title="Score"
                  >${formattedScore}</span
                >`
              : ''}
          </div>
          ${node.notes && !isMalSync ? html`<div class="au-friend-note">${node.notes}</div>` : ''}
        </div>
      </div>
    `;
  }

  private renderEmptyState(): HTMLElement {
    const query = this.$<HTMLInputElement>('#au-social-search')?.value.trim() || this.searchQuery;
    const [title, text] = this.searchQuery
      ? ['No matches', `Nobody here matches "${query}". Try a name or a word from a note.`]
      : this.emptyMessage();
    return html`
      <div class="au-social-empty">
        <span class="au-social-empty-icon"
          ><i class="fa-solid ${this.searchQuery ? 'fa-magnifying-glass' : 'fa-user-group'}"></i
        ></span>
        <strong class="au-social-empty-title">${title}</strong>
        <span class="au-social-empty-text">${text}</span>
      </div>
    `;
  }

  private emptyMessage(): [string, string] {
    const media = this.currentMediaType === 'MANGA' ? 'manga' : 'anime';
    const statusName = this.currentStatus === 'all' ? '' : this.statusName(this.currentStatus);
    const status = statusName ? ` as ${statusName}` : '';
    if (this.currentCustomList) {
      return [
        'Nobody from this list',
        `No one in ${this.currentCustomList} has this ${media} on their list${status}.`,
      ];
    }
    switch (this.currentFilter) {
      case 'self':
        return statusName
          ? ['Nothing here', `Your entry for this ${media} isn't marked ${statusName}.`]
          : [
              'Not on your list yet',
              `Add this ${media} to your list to see your progress and notes here.`,
            ];
      case 'global':
        return ['No public entries', `Nobody has this ${media} on their list${status} yet.`];
      default:
        return [
          'No activity yet',
          `None of the people you follow have this ${media} on their list${status}.`,
        ];
    }
  }

  private describeResults(count: number): string {
    const scope =
      this.currentCustomList ??
      { self: 'Your list', following: 'Following', friends: 'Best Friends', global: 'Global' }[
        this.currentFilter
      ];
    const status = this.currentStatus === 'all' ? '' : ` · ${this.statusName(this.currentStatus)}`;
    const total = `${count}${this.hasNextPage ? '+' : ''} ${count === 1 && !this.hasNextPage ? 'entry' : 'entries'}`;
    return `${scope}${status} · ${total}`;
  }

  private statusName(status: MediaListStatus): string {
    return STATUS_NAMES[status] ?? getStatusLabel(status, this.currentMediaType);
  }

  private setSummary(text: string): void {
    const summary = this.$('#au-social-summary');
    if (summary) summary.textContent = text;
  }

  private formatStatus(node: SocialActivityDetailed): string {
    const label = getStatusLabel(node.status, this.currentMediaType);
    if (!PROGRESS_STATUSES.has(node.status) || node.progress <= 0) return label;
    return `${label} · ${this.currentMediaType === 'MANGA' ? 'Ch' : 'Ep'} ${node.progress}`;
  }

  private timeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }
}
