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
import { AstraRatingModal } from './ui/AstraRatingModal';

@injectable()
export class AstraModule extends BaseModule {
  constructor(
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.AstraDashboard) private dashboard: AstraDashboard,
    @inject(TOKENS.AstraRatingModal) private ratingModal: AstraRatingModal,
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.ToastService) private toast: ToastService,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    log.group('Astra Module Initialization');

    // Auth guard: skip service init se non autenticato (ma il modulo puo' comunque iniettare UI)
    if (this.apiClient.isAuthenticated()) {
      // CRITICAL: AWAIT service init to ensure data loaded BEFORE UI injection
      // Pills/dashboard need scores data immediately available
      await this.service.init();
      log.success('[Astra] Service data loaded');
    } else {
      log.warn('[Astra] Not authenticated, skipping service initialization (UI will still work)');
    }

    this.onPageChange(async (event) => {
      const path = event?.path || window.location.pathname;

      // Handle Profile Injection
      if (path.match(/\/user\/[^/]+\/$/) || path.match(/\/user\/[^/]+\/animelist/) || path.match(/\/user\/[^/]+\/astra/)) {
        this.injectAstraTab();
      }

      // Handle Astra Dashboard Rendering
      if (path.includes('/astra')) {
        this.renderDashboard();
      }

      // Re-trigger enhancement on page change (for SPA navigation)
      this.enhanceNativeCards();
    });

    log.success('[Astra] Module initialized');

    // Initialize Progress Enhancer for home page cards
    this.initProgressEnhancer();

    // ══════════════════════════════════════════════════════════════════════════
    // UI INJECTION - Complete Separation of Concerns
    // ══════════════════════════════════════════════════════════════════════════

    // 1. Global Navbar Button: ALWAYS present, works everywhere
    this.injectGlobalDashboardButton();

    // 2. Media Page Hijack Observer (Persistent)
    this.sharedObserver.register('astra-media-hijack', () => {
      if (window.location.pathname.match(/\/(anime|manga)\/\d+/)) {
        this.hijackMediaPageStatusButton();
      }
    });

    // 3. Polling Fallback for Media Page (React/Vue re-renders often reset the button)
    setInterval(() => {
      if (window.location.pathname.match(/\/(anime|manga)\/\d+/)) {
        this.hijackMediaPageStatusButton();
      }
    }, 1000);

    // 4. Enhance Browse Dropdown with Seasonal link
    this.sharedObserver.register('astra-browse-seasonal', () => {
      this.enhanceBrowseDropdown();
    });

    // 5. Persistent Polling for ephemeral Browse dropdown
    setInterval(() => {
      this.enhanceBrowseDropdown();
    }, 1000);

    log.groupEnd();
  }

  private injectAstraTab(): void {
    const nav = document.querySelector('.user .nav');
    if (!nav || nav.querySelector('.astra-tab')) return;

    const username = window.location.pathname.split('/')[2];
    const astraLink = document.createElement('a');
    astraLink.className = 'link astra-tab';
    astraLink.href = `/user/${username}/astra`;
    astraLink.innerText = 'Astra';

    // Add active class if we are on the astra page
    if (window.location.pathname.includes('/astra')) {
      astraLink.classList.add('router-link-exact-active', 'router-link-active');
      // Hide standard content
      const content = document.querySelector('.user .content');
      if (content) (content as HTMLElement).style.display = 'none';
    }

    nav.appendChild(astraLink);
  }

  /**
   * Injects the Astra Dashboard button into the global AniList navigation bar.
   * Uses SharedGlobalObserver to handle dynamic re-renders of the nav.
   *
   * SEPARATION OF CONCERNS:
   * - This method handles ONLY the global navbar button (always present)
   * - Home page fallback is handled separately in setupHomeFallback()
   */
  private injectGlobalDashboardButton(): void {
    let lastInjectionTime = 0;
    let injectionCount = 0;

    const injectNavButton = () => {
      // Strategy 1: Find .links container in navbar
      let navLinks = document.querySelector('.nav .links')
        || document.querySelector('.header .links')
        || document.querySelector('.nav-wrap .links');

      // Strategy 2: Find via existing Browse/Social links (more robust)
      if (!navLinks) {
        const browseLink = document.querySelector('a[href^="/browse"]')
          || document.querySelector('a.link[href*="browse"]');
        const socialLink = document.querySelector('a[href="/social"]')
          || document.querySelector('a.link[href*="social"]');
        navLinks = browseLink?.parentElement || socialLink?.parentElement || null;
      }

      // Strategy 3: Find any .link container in header/nav
      if (!navLinks) {
        const anyLink = document.querySelector('.nav a.link, .header a.link');
        navLinks = anyLink?.parentElement || null;
      }

      if (!navLinks) {
        // Silently fail if navbar not ready yet
        return false;
      }

      // Check if already injected
      if (navLinks.querySelector('.au-astra-nav')) {
        return true; // Already present
      }

      // Throttle logging (solo ogni 2 secondi per non spammare)
      const now = Date.now();
      const shouldLog = (now - lastInjectionTime) > 2000;
      lastInjectionTime = now;
      injectionCount++;

      if (shouldLog) {
        log.info(`[Astra] Injecting navbar button (attempt #${injectionCount})`);
      }

      const astraLink = document.createElement('a');
      astraLink.className = 'link au-astra-nav';
      astraLink.href = '/astra';
      astraLink.style.display = 'inline-flex';
      astraLink.style.alignItems = 'center';
      astraLink.style.gap = '0px';
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

      if (shouldLog) {
        log.success('[Astra] Navbar button injected successfully');
      }

      return true;
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // TRIPLE DEFENSE STRATEGY against React navbar re-renders
    // ═══════════════════════════════════════════════════════════════════════════

    // 1. Immediate attempt
    injectNavButton();

    // 2. Aggressive initial polling (first 15 seconds, every 200ms)
    let earlyAttempts = 0;
    const earlyInterval = setInterval(() => {
      injectNavButton();
      earlyAttempts++;
      if (earlyAttempts >= 75) { // 75 * 200ms = 15 seconds
        clearInterval(earlyInterval);
      }
    }, 200);

    // 3. Long-term persistent polling (every 1 second, forever)
    //    React può ridisegnare la navbar in qualsiasi momento
    setInterval(() => {
      injectNavButton();
    }, 1000);

    // 4. MutationObserver fallback
    this.sharedObserver.register('astra-global-nav', () => injectNavButton());

    // 5. Navigation event listener (SPA page changes)
    this.eventBus.on(EVENT_TYPES.PAGE_CHANGED, () => {
      // Delay per permettere a React di finire il render
      setTimeout(() => injectNavButton(), 100);
      setTimeout(() => injectNavButton(), 500);
    });
  }


  private renderDashboard(): void {
    const container = document.querySelector('.user .content');
    if (!container) return;

    // Clear existing content for the custom view
    container.innerHTML = '';
    (container as HTMLElement).style.display = 'block';

    this.dashboard.mount(container as HTMLElement);

    // BUG-009 Fix: Lazy sync on tab open
    if (this.service) {
      this.service.syncWithAniList((this as any).apiClient).then(() => {
        // V2 Dashboard updates automatically via AstraStore/EventBus
      }).catch((e: any) => log.error('[Astra] Lazy sync failed', e));
    }
  }

  public getName(): string {
    return 'astra';
  }

  private initProgressEnhancer(): void {
    // Apply body classes for CSS rules (same as CalendarDomService)
    this.updateBodyClasses();

    // BUG-007 fix: Use SharedGlobalObserver for card enhancement
    this.sharedObserver.register('astra-progress-enhancer', () => {
      this.enhanceNativeCards();
    });

    // React to social preference changes: patch existing processed cards in place
    calendarStore.subscribeToSelector(
      (state: any) => ({
        socialEnabled: state.preferences.socialEnabled,
        socialShowAvatars: state.preferences.socialShowAvatars,
      }),
      (curr: any) => {
        this.updateBodyClasses(); // Update body classes first
        this.refreshNativeCardSocialPills(curr.socialEnabled, curr.socialShowAvatars);
      }
    );

    // ── Event Delegation (window capture phase) ────────────────────────────────
    // window is the FIRST node in capture chain — fires before document, body,
    // and Vue Router's own document-level capture handler (which calls stopPropagation).
    window.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const section = target.closest<HTMLElement>('[data-action]');
      if (!section) return;

      const wrapper = section.closest<HTMLElement>('.au-pill-wrapper');
      if (!wrapper) return;

      const mediaId = parseInt(wrapper.getAttribute('data-au-media-id') || '0', 10);
      log.debug(`[Astra] Delegated click: action=${section.getAttribute('data-action')} mediaId=${mediaId}`);
      if (!mediaId) return;

      const action = section.getAttribute('data-action');

      e.preventDefault();
      // stopImmediatePropagation prevents any other window-level capture handler from running
      e.stopImmediatePropagation();

      // Click animation — immediate feedback regardless of async work
      section.classList.add('au-pill-pressed');
      setTimeout(() => section.classList.remove('au-pill-pressed'), 300);

      // Icon spinner feedback (unifying animation across all buttons as requested)
      const icon = section.querySelector<HTMLElement>('i');
      const originalClass = icon?.className || '';
      if (icon) icon.className = 'fa fa-spinner fa-spin';
      section.style.pointerEvents = 'none';

      const resetState = () => {
        if (icon) icon.className = originalClass;
        section.style.pointerEvents = 'auto';
      };

      if (action === 'mark-watched') {
        // handleMarkWatched already has internal async handling, but we unified the entry point
        // We'll let handleMarkWatched handle its own icons for now, or simplify it
        this.handleMarkWatched(section, wrapper, mediaId);
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

        // Extract type from link
        const link = (card as any)?.href || card?.querySelector<HTMLAnchorElement>('a.cover')?.href || card?.querySelector<HTMLAnchorElement>('a')?.href;
        const typeMatch = link?.match(/\/(anime|manga)\//);
        const type = typeMatch ? typeMatch[1].toUpperCase() : 'ANIME';

        window.dispatchEvent(new CustomEvent('au-open-social-sidebar', {
          detail: { mediaId, title, element: card, type }
        }));
        // Social sidebar is instant, but keep spinner for a micro-beat for feedback
        setTimeout(resetState, 200);
      }
    }, { capture: true });
    // ────────────────────────────────────────────────────────────────────────────

    // Initial run
    this.enhanceNativeCards();
  }

  /**
   * Updates body classes to control CSS rules for social bubbles.
   * This is CRITICAL for the CSS in astra.css to work properly.
   *
   * EXACTLY like CalendarDomService.ts:171-181
   */
  private updateBodyClasses(): void {
    const { socialShowAvatars } = calendarStore.getState().preferences;

    // ═══════════════════════════════════════════════════════════════════════════
    // RULE 1: If avatars are hidden, add class to hide native bubbles via CSS
    // ═══════════════════════════════════════════════════════════════════════════
    if (!socialShowAvatars) {
      document.body.classList.add('au-social-avatars-hidden');
    } else {
      document.body.classList.remove('au-social-avatars-hidden');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RULE 2: Always mark Astra as enabled (our pills are active)
    // ═══════════════════════════════════════════════════════════════════════════
    document.body.classList.add('au-astra-enabled');

    log.debug(`[Astra] Body classes updated: avatars=${socialShowAvatars ? 'visible' : 'hidden'}`);
  }


  /**
   * Enhances media cards with Astra action pills (quick rate, increment progress, etc.)
   *
   * LOGIC SEPARATION:
   * - Home Page "In Progress": Pills ONLY if Calendar is present (operates on calendar cards)
   * - User Lists (/animelist, /mangalist): Pills ALWAYS (independent from calendar)
   * - Media Page Sidebar: Pills ALWAYS (independent from calendar)
   */
  private enhanceNativeCards(): void {
    const path = window.location.pathname;
    const isHome = path === '/' || path === '/home';
    const isUserList = path.includes('/animelist') || path.includes('/mangalist');
    const isMediaPage = !!path.match(/\/(anime|manga)\/\d+/);

    if (!isHome && !isUserList && !isMediaPage) return;

    // ══════════════════════════════════════════════════════════════════════════
    // HOME PAGE: Pills only for Calendar cards
    // ══════════════════════════════════════════════════════════════════════════
    if (isHome) {
      const calendarPresent = !!document.querySelector('#anilist-calendar');
      const headers = Array.from(document.querySelectorAll('h2, .section-header'));

      if (calendarPresent) {
        // Calendar ON: Add pills to "In Progress" only (Calendar manages Airing)
        headers.forEach(header => {
          const headerText = header.textContent?.toLowerCase() || '';
          if (headerText.includes('airing') || headerText.includes('schedule')) return;

          if (headerText.includes('in progress')) {
            const section = header.closest('.list-preview-wrap, .list-preview, .section, [data-v-4f9e87dc]');
            if (!section) return;
            section.querySelectorAll('.media-preview-card, .media-card').forEach(card => {
              this.processCard(card as HTMLElement, true);
            });
          }
        });
      } else {
        // Calendar OFF: Add pills to ALL home sections (In Progress + Airing)
        headers.forEach(header => {
          const headerText = header.textContent?.toLowerCase() || '';
          if (headerText.includes('in progress') || headerText.includes('airing') || headerText.includes('schedule')) {
            // Try multiple container selectors (AniList sections vary in structure)
            const section = header.closest('.list-preview-wrap, .list-preview, .section, [data-v-4f9e87dc]')
              || header.parentElement;
            if (!section) return;
            section.querySelectorAll('.media-preview-card, .media-card').forEach(card => {
              this.processCard(card as HTMLElement, true);
            });
          }
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // USER LISTS: Pills always present (independent from Calendar)
    // ══════════════════════════════════════════════════════════════════════════
    if (isUserList) {
      log.debug('[Astra] Enhancing user list cards');
      document.querySelectorAll('.media-preview-card, .media-card').forEach(card => {
        this.processCard(card as HTMLElement, true);
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MEDIA PAGE: Hijack native status button
    // ══════════════════════════════════════════════════════════════════════════
    if (isMediaPage) {
      this.hijackMediaPageStatusButton();
    }
  }

  /**
   * Internal helper to process a single card and inject the pill
   */
  private processCard(card: HTMLElement, isUserListCard: boolean): void {
    if (card.querySelector('.au-pill-wrapper') || card.hasAttribute('data-astra-processed')) return;

    const link = card.querySelector('a.cover')?.getAttribute('href') || (card as any).href;
    if (!link) return;

    const match = link.match(/\/(anime|manga)\/(\d+)/);
    if (!match) return;

    const mediaId = parseInt(match[2]);
    card.setAttribute('data-astra-processed', 'true');
    card.classList.add('au-astra-card'); // Marker for CSS to hide native overlays
    this.injectCardPill(card, mediaId, isUserListCard);
  }

  /**
   * Hijacks the native AniList status button (Add to List / Watching / etc.)
   * to open Astra Quick Edit instead of the native list editor.
   */
  private hijackMediaPageStatusButton(): void {
    // Select the main status button under the cover image
    // Priorities: header-specific actions, then general actions
    const btn = (document.querySelector('.header .actions .list') || 
                 document.querySelector('.actions .list')) as HTMLElement;
    
    if (!btn) {
      // log.debug('[Astra] Target button NOT found on media page'); // Silent for polling
      return;
    }

    if (btn.hasAttribute('data-astra-hijacked')) return;

    btn.setAttribute('data-astra-hijacked', 'true');
    btn.classList.add('au-astra-hijacked-btn');
    
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      
      const path = window.location.pathname;
      const match = path.match(/\/(anime|manga)\/(\d+)/);
      if (match) {
        this.ratingModal.open(parseInt(match[2]));
      }
    }, { capture: true });

    log.info('[Astra] Native status button hijacked successfully');
  }

  /**
   * Helper to render the common action pill HTML
   */


  /**
   * Injects the action pill into a native AniList card.
   * All click handling is delegated — no per-element listeners attached here.
   * @param isUserListCard - If false (trending/newly added), skip the mark-watched button.
   */
  private injectCardPill(card: HTMLElement, mediaId: number, isUserListCard: boolean): void {
    const { socialEnabled, socialShowAvatars } = calendarStore.getState().preferences;

    // Social button inside pill: show ONLY when Social Features is enabled
    // BUT avatars are hidden. When avatars are visible, the bubble portal handles it.
    const showPillSocial = socialEnabled && !socialShowAvatars;

    const socialSectionHTML = showPillSocial ? `
      <div class="pill-separator"></div>
      <div class="pill-section" data-action="social-activity" title="Social Activity">
        <i class="fa fa-users"></i>
      </div>
    ` : '';

    const markWatchedHTML = isUserListCard ? `
      <div class="pill-section" data-action="mark-watched" title="Increment Progress">
        <i class="fa fa-plus"></i>
      </div>
      <div class="pill-separator"></div>
    ` : '';

    const cover = card.querySelector('.cover') || card.querySelector('.image');
    if (!cover) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'au-pill-wrapper';
    // Store mediaId for the delegated click handler
    wrapper.setAttribute('data-au-media-id', String(mediaId));
    wrapper.innerHTML = `
      <div class="action-pill" style="${showPillSocial ? 'width: 130px;' : ''}">
        ${markWatchedHTML}
        <div class="pill-section" data-action="edit-entry" title="Quick Rate (Astra)">
          <i class="fa fa-pencil"></i>
        </div>
        ${socialSectionHTML}
      </div>
    `;

    cover.appendChild(wrapper);
  }

  /**
   * Handles the mark-watched (increment progress) action.
   * Called by the delegated click handler.
   */
  private handleMarkWatched(section: HTMLElement, wrapper: HTMLElement, mediaId: number): void {
    log.debug('[Astra] handleMarkWatched called, mediaId:', mediaId);
    const icon = section.querySelector<HTMLElement>('i');
    if (icon) icon.className = 'fa fa-spinner fa-spin';
    section.style.pointerEvents = 'none';

    const card = wrapper.closest<HTMLElement>('.media-preview-card, .media-card');

    (async () => {
      try {
        const userId = await this.apiClient.getCurrentUserId();
        if (!userId) {
          this.toast.error('Could not determine your user ID. Are you logged in?');
          return;
        }

        const data = await this.apiClient.query<{
          MediaList: {
            id: number;
            progress: number;
            status: string;
            media: { id: number; title: { romaji: string } };
          } | null;
        }>(`
          query ($mediaId: Int, $userId: Int) {
            MediaList(mediaId: $mediaId, userId: $userId) {
              id
              progress
              status
              media { id title { romaji } }
            }
          }
        `, { mediaId, userId });

        log.debug('[Astra] MediaList response:', data);

        if (!data?.MediaList) {
          this.toast.error('Entry not found in your list.');
          return;
        }

        const entry = data.MediaList;
        const newProgress = entry.progress + 1;

        await this.apiClient.mutate(`
          mutation ($id: Int, $progress: Int) {
            SaveMediaListEntry(id: $id, progress: $progress) {
              id
              progress
            }
          }
        `, { id: entry.id, progress: newProgress });

        this.toast.success(`✓ ${entry.media.title.romaji} → Ep ${newProgress}`, {
          mediaId: entry.media.id,
          progress: newProgress
        });

        // Emit PROGRESS_UPDATED event for Calendar/Store sync
        this.eventBus.emit(EVENT_TYPES.PROGRESS_UPDATED, {
          mediaId: entry.media.id,
          progress: newProgress,
          previousProgress: entry.progress,
          userId,
          status: entry.status
        });

        // Update native UI text (best-effort)
        if (card) {
          const progressEl = card.querySelector('.progress');
          if (progressEl) progressEl.textContent = `${newProgress}`;

          const infoContainer = card.querySelector('.info');
          if (infoContainer) {
            const html = infoContainer.innerHTML;
            if (html.includes('Progress:')) {
              infoContainer.innerHTML = html.replace(/Progress: (\d+)/, `Progress: ${newProgress}`);
            }
          }
        }
      } catch (err) {
        log.error('[Astra] Failed to increment progress', err);
        this.toast.error('Failed to update progress.');
      } finally {
        if (icon) icon.className = 'fa fa-plus';
        section.style.pointerEvents = 'auto';
      }
    })();
  }

  /**
   * Surgically patches the social pill section in all processed native cards.
   * Called when social preferences change — no page refresh needed.
   *
   * LOGIC: Show social pill button ONLY when social is enabled BUT avatars are hidden.
   * When avatars are visible, the bubble portal handles social interaction (no redundancy).
   */
  private refreshNativeCardSocialPills(socialEnabled: boolean, socialShowAvatars: boolean): void {
    // Social button inside pill: show ONLY when enabled AND avatars hidden
    const showPillSocial = socialEnabled && !socialShowAvatars;

    document.querySelectorAll<HTMLElement>('.au-pill-wrapper .action-pill').forEach(pill => {
      // Remove existing social section
      const existingBtn = pill.querySelector<HTMLElement>('[data-action="social-activity"]');
      if (existingBtn) {
        existingBtn.previousElementSibling?.remove();
        existingBtn.remove();
      }

      if (showPillSocial) {
        const separator = document.createElement('div');
        separator.className = 'pill-separator';

        const socialBtn = document.createElement('div');
        socialBtn.className = 'pill-section';
        socialBtn.setAttribute('data-action', 'social-activity');
        socialBtn.setAttribute('title', 'Social Activity');
        socialBtn.innerHTML = '<i class="fa fa-users"></i>';
        // No listener — delegated handler in initProgressEnhancer() covers this

        pill.appendChild(separator);
        pill.appendChild(socialBtn);
      }
    });

  }

  /**
   * Cleanup on module destroy
   */
  public override async destroy(): Promise<void> {
    this.sharedObserver.unregister('astra-progress-enhancer');
    this.sharedObserver.unregister('astra-global-nav');
    this.sharedObserver.unregister('astra-browse-seasonal');
    await super.destroy();
  }

  /**
   * Calculates the current season and year for the Seasonal link.
   */
  private getCurrentSeason(): { season: string; year: number } {
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-11

    let season = 'WINTER';
    if (month >= 3 && month <= 5) season = 'SPRING';
    else if (month >= 6 && month <= 8) season = 'SUMMER';
    else if (month >= 9 && month <= 11) season = 'FALL';

    return { season, year };
  }

  /**
   * Injects the "Seasonal" link into the Browse dropdown menu.
   * Targets the Anime section and inserts it after "Top Movies".
   */
  private enhanceBrowseDropdown(): void {
    let topMoviesLink = document.querySelector('a[href="/search/anime/top-movies"]')
      || document.querySelector('a[href*="top-movies"]');

    if (!topMoviesLink) {
      const allLinks = Array.from(document.querySelectorAll('a'));
      topMoviesLink = allLinks.find(a => a.innerText.trim() === 'Top Movies') || null;
    }

    if (!topMoviesLink) return;

    const container = topMoviesLink.parentElement;
    if (!container || container.querySelector('.au-seasonal-link')) {
      return;
    }

    const { season, year } = this.getCurrentSeason();
    const seasonalUrl = `/search/anime?airing%20status=RELEASING&season=${season}&year=${year}`;

    const seasonalLink = document.createElement('a');
    seasonalLink.className = 'link au-seasonal-link';
    seasonalLink.href = seasonalUrl;
    seasonalLink.innerText = 'Seasonal';
    
    seasonalLink.style.marginLeft = '4px';
    seasonalLink.style.display = 'inline-block';
    
    (container as HTMLElement).style.whiteSpace = 'nowrap';
    (container as HTMLElement).style.width = 'max-content';
    (container as HTMLElement).style.display = 'flex';
    (container as HTMLElement).style.flexWrap = 'nowrap';
    (container as HTMLElement).style.alignItems = 'center';
    
    topMoviesLink.insertAdjacentElement('afterend', seasonalLink);
    
    // Expand the whole dropdown panel to fit the new content
    let dropdown = container.closest('.dropdown, .menu, .nav-dropdown, .dropdown-wrap') as HTMLElement;
    if (!dropdown) {
      dropdown = (container.parentElement?.parentElement || container.parentElement) as HTMLElement;
    }

    if (dropdown) {
      dropdown.style.setProperty('width', 'max-content', 'important');
      dropdown.style.setProperty('min-width', 'max-content', 'important');
      dropdown.style.setProperty('max-width', 'none', 'important');
    }
    
    log.debug(`[Astra] Injected Seasonal link and expanded dropdown panel`);
  }
}
