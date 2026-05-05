/**
 * @file AstraModule.ts
 * @description Orchestrator for the Astra advanced multi-criteria scoring system
 *
 * Injects Astra score pills onto native AniList media cards, adds a
 * dashboard tab to user profile pages, and enhances the progress
 * update flow with Astra score prompts. Coordinates between
 * AstraService (data) and AstraDashboard/AstraRatingModal (UI).
 *
 * Performance (BUG-007):
 * - Uses SharedGlobalObserver instead of individual MutationObserver
 * - Reduces overhead when multiple modules observe document.body
 *
 * @warning Window-level event listener for dashboard clicks is never
 *          removed, accumulating on each module init.
 *          See docs/BUGS.md#bug-021.
 *
 * @see AstraService.ts for score calculation and persistence
 * @see AstraDashboard.ts for the full dashboard UI
 * @see AstraRatingModal.ts for per-work rating forms
 * @see docs/MODULES.md#5-astra-module-advanced-scoring
 * @see docs/PERFORMANCE.md#bug-007 for SharedGlobalObserver optimization
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { calendarStore } from '@/modules/calendar/CalendarStore';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import type { ToastService } from '@core/services/ToastService';
import { AstraService } from './AstraService';
import { AstraDashboard } from './ui/AstraDashboard';
import { AstraRatingController } from './ui/AstraRatingController';
import { SocialMaskingService } from '@core/services/SocialMaskingService';
import { PillUIBuilder } from './ui/PillUIBuilder';
import { ICardEnhancementStrategy } from './strategies/ICardEnhancementStrategy';

@injectable()
export class AstraModule extends BaseModule {
  private intervals: number[] = [];
  private globalClickListener: ((e: MouseEvent) => void) | null = null;

  constructor(
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.AstraDashboard) private dashboard: AstraDashboard,
    @inject(TOKENS.AstraRatingController) private ratingModal: AstraRatingController,
    @inject(TOKENS.AstraPillBuilder) private pillBuilder: PillUIBuilder,
    @inject(TOKENS.AstraStrategies) private strategies: ICardEnhancementStrategy[],
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.ToastService) private toast: ToastService,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(TOKENS.SocialMaskingService) private maskingService: SocialMaskingService
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    console.log('%c[Astra] MODULE BOOTING...', 'background: #222; color: #bada55; font-size: 20px;');
    log.group('Astra Module Initialization');

    // Auth guard
    if (this.apiClient.isAuthenticated()) {
      await this.service.init();
      log.success('[Astra] Service data loaded');
    } else {
      log.warn('[Astra] Not authenticated, skipping service initialization (UI will still work)');
    }
    
    // Sync social masking policy
    this.maskingService.sync();

    this.onPageChange(async (event) => {
      const path = event?.path || window.location.pathname;

      // Handle Astra Dashboard Rendering
      if (path.includes('/astra')) {
        this.renderDashboard();
      }

      // Re-trigger enhancement on page change
      this.enhanceNativeCards();
    });

    log.success('[Astra] Module initialized');

    // Initialize Progress Enhancer via Shared Observer
    this.sharedObserver.register('astra-progress-enhancer', () => {
      this.enhanceNativeCards();
    });

    // Event Delegation (window capture phase)
    this.globalClickListener = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const section = target.closest<HTMLElement>('[data-action]');
      if (!section) return;

      const wrapper = section.closest<HTMLElement>('.au-pill-wrapper');
      if (!wrapper) return;

      const mediaId = parseInt(wrapper.getAttribute('data-au-media-id') || '0', 10);
      if (!mediaId) return;

      const action = section.getAttribute('data-action');

      e.preventDefault();
      e.stopImmediatePropagation();

      // Click animation
      section.classList.add('au-pill-pressed');
      setTimeout(() => section.classList.remove('au-pill-pressed'), 300);

      const icon = section.querySelector<HTMLElement>('i');
      const originalClass = icon?.className || '';
      if (icon) icon.className = 'fa-solid fa-spinner fa-spin';
      section.style.pointerEvents = 'none';

      const resetState = () => {
        if (icon) icon.className = originalClass;
        section.style.pointerEvents = 'auto';
      };

      if (action === 'mark-watched') {
        this.handleMarkWatched(section, mediaId);
      } else if (action === 'edit-entry') {
        (async () => {
          try {
            await this.ratingModal.open(mediaId);
          } finally {
            resetState();
          }
        })();
      } else if (action === 'social-activity') {
        const card = wrapper.closest<HTMLElement>('.media-preview-card, .media-card');
        const titleEl = card?.querySelector('.title');
        const title = titleEl?.textContent?.trim() || 'Anime';
        const link = (card as any)?.href || card?.querySelector<HTMLAnchorElement>('a.cover')?.href || card?.querySelector<HTMLAnchorElement>('a')?.href;
        const typeMatch = link?.match(/\/(anime|manga)\//);
        const type = typeMatch ? typeMatch[1].toUpperCase() : 'ANIME';

        window.dispatchEvent(new CustomEvent('au-open-social-sidebar', {
          detail: { mediaId, title, element: card, type }
        }));
        setTimeout(resetState, 200);
      }
    };

    window.addEventListener('click', this.globalClickListener, { capture: true });

    // ══════════════════════════════════════════════════════════════════════════
    // UI INJECTION
    // ══════════════════════════════════════════════════════════════════════════

    // 1. Global Navbar Button
    this.injectGlobalDashboardButton();

    // 2. Media Page Hijack Observer (Persistent)
    this.sharedObserver.register('astra-media-hijack', () => {
      this.hijackMediaPageStatusButton();
    });

    // 3. Enhance Browse Dropdown with Seasonal link
    this.sharedObserver.register('astra-browse-seasonal', () => {
      this.enhanceBrowseDropdown();
    });

    // Initial runs
    this.enhanceNativeCards();
    this.hijackMediaPageStatusButton();

    log.groupEnd();
  }

  /**
   * Injects the Astra Dashboard button into the global AniList navigation bar.
   */
  private injectGlobalDashboardButton(): void {
    let lastInjectionTime = 0;
    let injectionCount = 0;

    const injectNavButton = () => {
      let navLinks = document.querySelector('.nav .links')
        || document.querySelector('.header .links')
        || document.querySelector('.nav-wrap .links');

      if (!navLinks) {
        const browseLink = document.querySelector('a[href^="/browse"]')
          || document.querySelector('a.link[href*="browse"]');
        const socialLink = document.querySelector('a[href="/social"]')
          || document.querySelector('a.link[href*="social"]');
        navLinks = browseLink?.parentElement || socialLink?.parentElement || null;
      }

      if (!navLinks) return false;

      if (navLinks.querySelector('.au-astra-nav')) return true;

      const now = Date.now();
      const shouldLog = (now - lastInjectionTime) > 2000;
      lastInjectionTime = now;
      injectionCount++;

      const astraLink = document.createElement('a');
      astraLink.className = 'link au-astra-nav';
      astraLink.href = '/astra';
      astraLink.style.display = 'inline-flex';
      astraLink.style.alignItems = 'center';
      astraLink.style.color = 'var(--astra-accent, #3db4f2)';
      astraLink.style.fontWeight = '700';
      astraLink.style.transition = 'all 0.2s';
      astraLink.style.padding = '0 10px';

      astraLink.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" 
             style="width: 16px; height: 16px; transform: translateY(-1px); flex-shrink: 0; margin-right: -2px;">
          <path d="M12 4L4 20H8L12 12L16 20H20L12 4Z" />
        </svg>
        <span class="desktop" style="line-height: 1; text-transform: none;">stra</span>
      `;

      astraLink.addEventListener('click', (e) => {
        e.preventDefault();
        this.eventBus.emit(EVENT_TYPES.ASTRA_OPEN);
      });

      navLinks.appendChild(astraLink);
      if (shouldLog) log.success('[Astra] Navbar button injected successfully');

      return true;
    };

    // MutationObserver defense
    this.sharedObserver.register('astra-global-nav', () => injectNavButton());

    // Navigation fallback
    this.onPageChange(() => {
      setTimeout(() => injectNavButton(), 100);
      setTimeout(() => injectNavButton(), 500);
    });

    // Managed Long-term persistent polling
    this.intervals.push(window.setInterval(() => injectNavButton(), 3000));
  }


  private renderDashboard(): void {
    const container = document.querySelector('.user .content');
    if (!container) return;

    container.innerHTML = '';
    (container as HTMLElement).style.display = 'block';

    this.dashboard.mount(container as HTMLElement);

    if (this.service) {
      this.service.syncWithAniList(this.apiClient).catch((e: any) => log.error('[Astra] Lazy sync failed', e));
    }
  }

  public getName(): string {
    return 'astra';
  }

  /**
   * Enhances cards based on registered strategies
   */
  private enhanceNativeCards(): void {
    const path = window.location.pathname;
    
    // Iterate through strategies to find the one that can handle the current page
    for (const strategy of this.strategies) {
      if (strategy.canHandle(path)) {
        const cards = strategy.getCards();
        if (cards.length > 0) {
          console.info(`[Astra-Debug] Strategy "${strategy.name}" found ${cards.length} cards`);
        }
        cards.forEach(card => {
          if (strategy.shouldEnhanceCard(card)) {
            this.processCard(card);
          }
        });
      }
    }
  }

  private processCard(card: HTMLElement): void {
    try {
      if (card.querySelector('.au-pill-wrapper') || card.hasAttribute('data-astra-processed')) return;

      const link = card.querySelector('a.cover')?.getAttribute('href') || (card as any).href;
      if (!link) return;

      const match = link.match(/\/(anime|manga)\/(\d+)/);
      if (!match) return;

      const mediaId = parseInt(match[2]);
      card.setAttribute('data-astra-processed', 'true');
      card.classList.add('au-astra-card');
      
      // Prepare pill options
      const state = calendarStore.getState();
      const { socialEnabled, socialShowAvatars } = state.preferences;
      const path = window.location.pathname;
      const isUserListCard = path.includes('/animelist') || path.includes('/mangalist');

      this.pillBuilder.inject(card.querySelector('.cover') || card.querySelector('.image') as HTMLElement, {
        mediaId,
        isUserListCard: isUserListCard || path === '/' || path === '/home', // Home page cards also get the + button
        socialEnabled,
        socialShowAvatars
      });
    } catch (error) {
      console.error('[Astra-Debug] Failed to process card', error);
    }
  }

  private hijackMediaPageStatusButton(): void {
    if (!window.location.pathname.match(/\/(anime|manga)\/\d+/)) return;

    const btn = (document.querySelector('.header .actions .list') || document.querySelector('.actions .list')) as HTMLElement;
    if (!btn || btn.hasAttribute('data-astra-hijacked')) return;

    btn.setAttribute('data-astra-hijacked', 'true');
    btn.classList.add('au-astra-hijacked-btn');

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const match = window.location.pathname.match(/\/(anime|manga)\/(\d+)/);
      if (match) this.ratingModal.open(parseInt(match[2]));
    }, { capture: true });

    log.info('[Astra] Native status button hijacked successfully');
  }

  private handleMarkWatched(section: HTMLElement, mediaId: number): void {
    const icon = section.querySelector<HTMLElement>('i');
    if (icon) icon.className = 'fa fa-spinner fa-spin';
    section.style.pointerEvents = 'none';

    (async () => {
      try {
        const userId = await this.apiClient.getCurrentUserId();
        if (!userId) {
          this.toast.error('Not logged in.');
          return;
        }

        const data = await this.apiClient.query<any>(`
          query ($mediaId: Int, $userId: Int) {
            MediaList(mediaId: $mediaId, userId: $userId) {
              id progress status media { id title { romaji } }
            }
          }
        `, { mediaId, userId });

        if (!data?.MediaList) {
          this.toast.error('Entry not found.');
          return;
        }

        const entry = data.MediaList;
        const newProgress = entry.progress + 1;

        await this.apiClient.mutate(`
          mutation ($id: Int, $progress: Int) {
            SaveMediaListEntry(id: $id, progress: $progress) { id progress }
          }
        `, { id: entry.id, progress: newProgress });

        this.toast.success(`✓ ${entry.media.title.romaji} → Ep ${newProgress}`);
        this.eventBus.emit(EVENT_TYPES.PROGRESS_UPDATED, {
          mediaId: entry.media.id,
          progress: newProgress,
          previousProgress: entry.progress,
          userId,
          status: entry.status
        });
      } catch (err) {
        log.error('[Astra] Failed to increment progress', err);
        this.toast.error('Failed to update progress.');
      } finally {
        if (icon) icon.className = 'fa-solid fa-plus';
        section.style.pointerEvents = 'auto';
      }
    })();
  }

  public override async destroy(): Promise<void> {
    // 1. Clear managed intervals
    this.intervals.forEach(id => window.clearInterval(id));
    this.intervals = [];

    // 2. Remove global listeners
    if (this.globalClickListener) {
      window.removeEventListener('click', this.globalClickListener, { capture: true });
      this.globalClickListener = null;
    }

    // 3. Unregister observers
    this.sharedObserver.unregister('astra-progress-enhancer');
    this.sharedObserver.unregister('astra-global-nav');
    this.sharedObserver.unregister('astra-browse-seasonal');
    this.sharedObserver.unregister('astra-media-hijack');

    await super.destroy();
  }

  private getCurrentSeason(): { season: string; year: number } {
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth();
    let season = 'WINTER';
    if (month >= 3 && month <= 5) season = 'SPRING';
    else if (month >= 6 && month <= 8) season = 'SUMMER';
    else if (month >= 9 && month <= 11) season = 'FALL';
    return { season, year };
  }

  private enhanceBrowseDropdown(): void {
    let topMoviesLink = document.querySelector('a[href="/search/anime/top-movies"]') || document.querySelector('a[href*="top-movies"]');
    if (!topMoviesLink) {
      topMoviesLink = Array.from(document.querySelectorAll('a')).find(a => a.innerText.trim() === 'Top Movies') || null;
    }
    if (!topMoviesLink) return;

    const container = topMoviesLink.parentElement;
    if (!container || container.querySelector('.au-seasonal-link')) return;

    const { season, year } = this.getCurrentSeason();
    const seasonalLink = document.createElement('a');
    seasonalLink.className = 'link au-seasonal-link';
    seasonalLink.href = `/search/anime?airing%20status=RELEASING&season=${season}&year=${year}`;
    seasonalLink.innerText = 'Seasonal';
    seasonalLink.style.marginLeft = '4px';
    seasonalLink.style.display = 'inline-block';

    (container as HTMLElement).style.display = 'flex';
    (container as HTMLElement).style.alignItems = 'center';

    topMoviesLink.insertAdjacentElement('afterend', seasonalLink);

    const dropdown = container.closest('.dropdown, .menu, .nav-dropdown, .dropdown-wrap') as HTMLElement;
    if (dropdown) {
      dropdown.style.setProperty('width', 'max-content', 'important');
      dropdown.style.setProperty('min-width', 'max-content', 'important');
    }
  }
}
