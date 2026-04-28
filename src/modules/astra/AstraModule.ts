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
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import type { ToastService } from '@core/services/ToastService';
import { AstraService } from './AstraService';
import { AstraDashboard } from './ui/AstraDashboard';
import { AstraRatingModal } from './ui/AstraRatingModal';
import type { CalendarStore } from '../calendar/CalendarStore';

@injectable()
export class AstraModule extends BaseModule {
  constructor(
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.AstraDashboard) private dashboard: AstraDashboard,
    @inject(TOKENS.AstraRatingModal) private ratingModal: AstraRatingModal,
    @inject(TOKENS.CalendarStore) private calendarStore: CalendarStore,
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.ToastService) private toast: ToastService,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  public async init(): Promise<void> {
    log.group('Astra Module Initialization');

    // Do not await service init to avoid blocking other modules (like Calendar)
    this.service.init().then(() => {
      log.success('[Astra] Service data loaded');
    });

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
    });

    log.success('[Astra] Module initialized');

    // Initialize Progress Enhancer for home page cards
    this.initProgressEnhancer();

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

  private renderDashboard(): void {
    const container = document.querySelector('.user .content');
    if (!container) return;

    // Clear existing content for the custom view
    container.innerHTML = '';
    (container as HTMLElement).style.display = 'block';

    this.dashboard.mount(container as HTMLElement);
    
    // BUG-009 Fix: Lazy sync on tab open
    if (this.service) {
      this.service.syncWithAniList((this as any).apiClient).then(({updated}) => {
        if (updated > 0) this.dashboard.refresh();
      }).catch((e: any) => log.error('[Astra] Lazy sync failed', e));
    }
  }

  public getName(): string {
    return 'astra';
  }

  private initProgressEnhancer(): void {
    // BUG-007 fix: Use SharedGlobalObserver instead of individual observer
    this.sharedObserver.register('astra-progress-enhancer', () => {
      this.enhanceNativeCards();
    });

    // React to social preference changes: patch existing processed cards in place
    this.calendarStore.subscribeToSelector(
      state => ({
        socialEnabled: state.preferences.socialEnabled,
        socialShowAvatars: state.preferences.socialShowAvatars,
      }),
      (curr) => {
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

      if (action === 'mark-watched') {
        this.handleMarkWatched(section, wrapper, mediaId);
      } else if (action === 'edit-entry') {
        this.ratingModal.open(mediaId);
      } else if (action === 'social-activity') {
        const card = wrapper.closest<HTMLElement>('.media-preview-card, .media-card');
        const titleEl = card?.querySelector('.title');
        const title = titleEl?.textContent?.trim() || 'Anime';
        window.dispatchEvent(new CustomEvent('au-open-social-sidebar', {
          detail: { mediaId, title, element: card }
        }));
      }
    }, { capture: true });
    // ────────────────────────────────────────────────────────────────────────────

    // Initial run
    this.enhanceNativeCards();
  }

  private enhanceNativeCards(): void {
    const path = window.location.pathname;
    const isHome = path === '/' || path === '/home';
    const isUserList = path.includes('/animelist') || path.includes('/mangalist');

    if (!isHome && !isUserList) {
      log.debug('[Astra] enhanceNativeCards: skipping — path not matched', path);
      return;
    }

    const noMarkWatched: Set<Element> = isHome
      ? this.buildNoMarkWatchedSet()
      : new Set();

    const cards = document.querySelectorAll('.media-preview-card, .media-card');
    log.debug(`[Astra] enhanceNativeCards: found ${cards.length} cards on ${path}`);

    let injected = 0;
    cards.forEach(card => {
      if (card.querySelector('.au-pill-wrapper') || card.hasAttribute('data-astra-processed')) return;
      card.setAttribute('data-astra-processed', 'true');

      const link = card.querySelector('a.cover')?.getAttribute('href') || (card as HTMLAnchorElement).href;
      if (!link) {
        log.debug('[Astra] enhanceNativeCards: skipping card — no link', card);
        return;
      }

      const match = link.match(/\/(anime|manga)\/(\d+)/);
      if (!match) {
        log.debug('[Astra] enhanceNativeCards: skipping card — link does not match', link);
        return;
      }

      const mediaId = parseInt(match[2]);
      const isUserListCard = !noMarkWatched.has(card);
      log.debug(`[Astra] injectCardPill: mediaId=${mediaId} isUserListCard=${isUserListCard}`);

      this.injectCardPill(card as HTMLElement, mediaId, isUserListCard);
      injected++;
    });

    log.debug(`[Astra] enhanceNativeCards: injected pills into ${injected} cards`);
  }

  /**
   * Scans the DOM for the three known "non-list" sections by their h2.section-header text
   * and returns a Set of all card elements within them.
   * DOM structure: <div data-v-xxx><h2 class="section-header">Title</h2><div.media-preview>...cards</div></div>
   */
  private buildNoMarkWatchedSet(): Set<Element> {
    const excluded = new Set<Element>();
    const noListTitles = ['Trending Anime & Manga', 'Newly Added Anime', 'Newly Added Manga'];

    document.querySelectorAll<HTMLElement>('h2.section-header').forEach(h2 => {
      const text = h2.textContent?.trim() ?? '';
      if (noListTitles.some(title => text.includes(title))) {
        const parent = h2.parentElement;
        parent?.querySelectorAll('.media-preview-card, .media-card').forEach(card => {
          excluded.add(card);
        });
      }
    });

    return excluded;
  }

  /**
   * Injects the action pill into a native AniList card.
   * All click handling is delegated — no per-element listeners attached here.
   * @param isUserListCard - If false (trending/newly added), skip the mark-watched button.
   */
  private injectCardPill(card: HTMLElement, mediaId: number, isUserListCard: boolean): void {
    const { socialEnabled, socialShowAvatars } = this.calendarStore.getState().preferences;
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
            media: { title: { romaji: string } };
          } | null;
        }>(`
          query ($mediaId: Int, $userId: Int) {
            MediaList(mediaId: $mediaId, userId: $userId) {
              id
              progress
              media { title { romaji } }
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

        this.toast.success(`✓ ${entry.media.title.romaji} → Ep ${newProgress}`);

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
   */
  private refreshNativeCardSocialPills(socialEnabled: boolean, socialShowAvatars: boolean): void {
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
    // BUG-007 fix: Unregister from SharedGlobalObserver
    this.sharedObserver.unregister('astra-progress-enhancer');
    await super.destroy();
  }
}
