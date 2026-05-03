/**
 * @file CalendarModule.ts
 * @description Orchestrator module for the weekly anime calendar feature
 *
 * Delegates all responsibilities to specialized services (SRP):
 *   - CalendarDataService: data fetching and progress updates
 *   - CalendarDomService: DOM injection and container management
 *   - CalendarSocialService: friend activity overlay loading
 *   - CalendarStore: centralized state and preference persistence
 *
 * Lifecycle: init() → loadAndRender() on home page, re-renders on
 * SPA navigation back to home, destroys on page leave.
 *
 * @see docs/MODULES.md#1-calendar-module
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { calendarStore } from './CalendarStore';
import { CSS_CLASSES } from '@core/constants';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { container } from '@core/di/container';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import { CalendarDomService } from './services/CalendarDomService';
import { CalendarDataService } from './services/CalendarDataService';
import { CalendarSocialService } from './services/CalendarSocialService';
import { AuthService } from '@core/auth/AuthService';
import { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { SettingsPanel } from './components/SettingsPanel';
import { MediaListStatus } from '@/api/AnilistTypes';

@injectable()
export class CalendarModule extends BaseModule {
  private userId: number | null = null;
  private isProcessing: boolean = false;

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.CalendarDomService) private domService: CalendarDomService,
    @inject(TOKENS.CalendarDataService) private dataService: CalendarDataService,
    @inject(TOKENS.CalendarSocialService) private socialService: CalendarSocialService,
    @inject(TOKENS.SharedGlobalObserver) private sharedObserver: SharedGlobalObserver,
    @inject(TOKENS.Config) private config: IConfigManager,
    @inject(TOKENS.AuthService) private auth: AuthService,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  /**
   * Initialize the calendar module
   */
  public async init(): Promise<void> {
    try {
      log.group('Calendar Module Initialization');

      // CRITICAL: Load calendar preferences from storage FIRST
      await calendarStore.init();
      log.success('[Calendar] Preferences loaded from storage');

      // Check authentication via centralized client
      if (!this.apiClient.isAuthenticated()) {
        log.warn('[Calendar] User not authenticated, showing prompt');
        await this.handleUnauthenticated();
        return;
      }

      this.userId = await this.apiClient.getCurrentUserId();
      log.info('[Calendar] Initializing for user', { userId: this.userId });

      // 1. Setup MutationObserver for late-loading React sections
      await this.setupSectionDetection();

      // 2. Initial injection attempt
      await this.runInjectionFlow();

      // 3. Subscribe to navigation events (Event-Driven reactivity)
      this.onPageChange(async (event) => {
        const path = event?.path || window.location.pathname;
        log.debug('[Calendar] Page changed, checking injection', { path });
        const isHomePage = path === '/' || path === '/home';
        
        if (isHomePage) {
          // Reset processed state on page change to allow re-injection
          this.isProcessing = false;
          // Delay to let React/DOM settle
          setTimeout(() => this.runInjectionFlow(), 500);
        }
      });

      // BUG-FIX: Handle resize events that might disrupt the layout or detach the container
      window.addEventListener('resize', () => {
        const isHomePage = window.location.pathname === '/' || window.location.pathname === '/home';
        if (isHomePage) {
          // If calendar is missing but we are on home page, re-inject
          const calendarExists = !!document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
          if (!calendarExists && !this.isProcessing) {
            log.info('[Calendar] Calendar missing after resize, re-injecting...');
            this.runInjectionFlow();
          }
        }
      });

      // Listen for data updates from other modules
      this.eventBus.on(EVENT_TYPES.ASTRA_DATA_UPDATED, async () => {
        const isHomePage = window.location.pathname === '/' || window.location.pathname === '/home';
        if (isHomePage) {
          log.info('[Calendar] Astra data updated, refreshing schedule (delayed)...');
          // Delay a bit to let AniList API sync after mutation
          setTimeout(async () => {
            await this.runInjectionFlow(true);
          }, 1500);
        }
      });

      this.eventBus.on(EVENT_TYPES.PROGRESS_UPDATED, async (payload) => {
        // Optimistic update: update the store directly instead of re-fetching
        if (payload && payload.mediaId) {
          log.info('[Calendar] Progress updated event received', payload);
          
          const entry = calendarStore.getState().entries.find(e => e.mediaId === payload.mediaId);
          if (entry) {
             log.info(`[Calendar] Found entry ${entry.title} (mediaId: ${entry.mediaId}). Current progress: ${entry.progress}, New progress: ${payload.progress}`);
          } else {
             log.warn(`[Calendar] Could not find entry for mediaId: ${payload.mediaId}`);
          }

          if (payload.status && payload.status !== MediaListStatus.CURRENT) {
            log.info('[Calendar] Media status is no longer CURRENT, removing from calendar', payload.status);
            calendarStore.removeEntry(payload.mediaId);
            // Re-render to remove the card from UI
            const isHomePage = window.location.pathname === '/' || window.location.pathname === '/home';
            if (isHomePage) await this.runInjectionFlow(true);
          } else {
            calendarStore.updateEntry(payload.mediaId, { progress: payload.progress });
            // Optimistic UI update: directly update visible card DOM
            this.updateCardProgressUI(payload.mediaId, payload.progress);
          }
        }
      });

      this.eventBus.on(EVENT_TYPES.CALENDAR_DATA_REFRESH, async () => {
        const isHomePage = window.location.pathname === '/' || window.location.pathname === '/home';
        if (isHomePage) {
          log.info('[Calendar] Calendar data refresh requested...');
          await this.runInjectionFlow(true);
        }
      });

      // Persistent Polling for SPA navigation robustness
      // Sometimes MutationObserver misses the window when React replaces the entire container
      setInterval(() => {
        const isHomePage = window.location.pathname === '/' || window.location.pathname === '/home';
        if (isHomePage) {
          const calendarContainer = document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
          const hasContent = !!calendarContainer?.querySelector('.calendar-grid, .calendar-grid__empty, .calendar-skeleton');
          
          if ((!calendarContainer || !hasContent) && !this.isProcessing) {
            log.info('[Calendar] Polling check: Calendar missing or empty, re-injecting...', {
              hasContainer: !!calendarContainer,
              hasContent
            });
            this.runInjectionFlow();
          }
        }
      }, 2000);

      // 4. Initialize global social visibility classes
      const syncClasses = () => this.domService.syncSocialVisibilityClasses(this.config.isFeatureEnabled('astra'));
      syncClasses();

      // 5. Subscribe to preference changes to update body classes in real-time
      calendarStore.subscribeToSelector(
        (state: any) => ({
          socialEnabled: state.preferences.socialEnabled,
          socialShowAvatars: state.preferences.socialShowAvatars,
        }),
        () => syncClasses()
      );

      // 6. PERSISTENCE: Use shared observer to ensure classes stay applied even after React re-renders body
      this.sharedObserver.register('social-visibility-persistence', () => syncClasses(), 2000);

      // 7. ANTI-DOUBLE: Aggressively hide native airing section if calendar is active
      this.sharedObserver.register('calendar-native-hider', () => {
        const isHomePage = window.location.pathname === '/' || window.location.pathname === '/home';
        if (!isHomePage) return;
        
        const calendarExists = !!document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
        if (!calendarExists) return;

        const headers = Array.from(document.querySelectorAll('h2, h3, .section-header'));
        headers.forEach(h => {
          const text = h.textContent?.trim().toLowerCase() || '';
          if (text === 'airing' && !h.classList.contains('au-calendar-title') && !h.hasAttribute('data-au-artificial')) {
            const section = h.closest('section') || h.closest('.list-preview-wrap') || h.closest('.list-preview') || h.parentElement;
            if (section && !(section as HTMLElement).classList.contains('au-native-airing-hidden')) {
              const el = section as HTMLElement;
              
              // CRITICAL BUG-FIX: Don't hide the section if it's currently hosting our calendar!
              if (el.contains(document.getElementById(CSS_CLASSES.CALENDAR))) {
                log.debug('[Calendar] Skipping hider for container hosting our calendar');
                return;
              }

              el.style.display = 'none';
              el.style.opacity = '0';
              el.style.visibility = 'hidden';
              el.style.pointerEvents = 'none';
              el.style.height = '0';
              el.style.overflow = 'hidden';
              el.classList.add('au-native-airing-hidden');
              log.debug('[Calendar] Aggressively suppressed native Airing section');
            }
          }
        });
      }, 800); // Faster check (800ms) to beat React re-renders

      log.success('[Calendar] Module initialized successfully');
    } catch (error) {
      log.error('[Calendar] Initialization failed', error);
    } finally {
      log.groupEnd();
    }
  }

  /**
   * Setup observer to watch for the Airing section being added to the DOM
   */
  private async setupSectionDetection(): Promise<void> {
    log.debug('[Calendar] Setting up section detection using SharedGlobalObserver');

    this.sharedObserver.register('calendar-airing-detector', async () => {
      // Only run if on home page and calendar doesn't exist
      const isHomePage = window.location.pathname === '/' || window.location.pathname === '/home';
      if (!isHomePage) return;

      const calendarExists = !!document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
      if (calendarExists) return;

      // Try to find the section
      const section = await this.domService.findAiringSection();
      if (section) {
        log.info('[Calendar] Airing section detected via shared observer, triggering injection');
        this.runInjectionFlow();
      }
    }, 500); // Faster check (500ms) for better SPA response
  }

  /**
   * Main flow to inject UI and load data
   */
  private async runInjectionFlow(forceRefresh: boolean = false): Promise<void> {
    if (this.isProcessing) return;
    
    const existingContainer = document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
    const hasContent = !!existingContainer?.querySelector('.calendar-grid, .calendar-grid__empty, .calendar-skeleton');
    
    // If it exists AND has content AND we aren't forcing a refresh, skip
    if (existingContainer && hasContent && !forceRefresh) return;

    try {
      this.isProcessing = true;
      // Safety timeout: if injection hangs, allow retry after 10s
      setTimeout(() => { this.isProcessing = false; }, 10000);
      
      log.info(`[Calendar] Running injection flow (force=${forceRefresh}, exists=${!!existingContainer}, content=${hasContent})...`);

      // 1. Inject UI via DOM Service
      const astraEnabled = this.config.isFeatureEnabled('astra');
      const calendarContainer = await this.domService.injectCalendar(
        () => this.handleSettingsClick(),
        (mediaId) => this.handleMarkWatched(mediaId),
        astraEnabled
      );

      if (!calendarContainer) return;

      // 2. Load Data via Data Service
      if (this.userId) {
        try {
          await this.dataService.loadSchedule(this.userId, forceRefresh);
        } catch (err) {
          log.warn('[Calendar] Schedule load failed, attempting stale cache fallback', err);
          // DataService already sets error in store, but we can try to force stale load if entries are 0
          const state = calendarStore.getState();
          if (state.entries.length === 0) {
            const stale = await calendarStore.loadEntriesFromCache(true); // true = allowStale
            if (stale) {
              log.info('[Calendar] Fallback successful: using stale entries');
              calendarStore.setEntries(stale);
            }
          }
        }

        // 3. Load Social Data (Async, non-blocking)
        if (this.config.isFeatureEnabled('friendActivity')) {
          this.socialService.loadFriendActivity();
        }
      }
    } catch (error) {
      log.error('[Calendar] Injection flow failed', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async handleUnauthenticated(): Promise<void> {
    const astraEnabled = this.config.isFeatureEnabled('astra');
    const calendarContainer = await this.domService.injectCalendar(() => {}, async () => {}, astraEnabled);
    if (calendarContainer) {
      this.domService.showAuthPrompt(async () => {
        try {
          await this.auth.login();
          log.success('[Calendar] Login successful, reloading page...');
          window.location.reload();
        } catch (error) {
          log.error('[Calendar] Login error:', error);
          alert('Login failed. Please try again.');
        }
      });
    }
  }

  private handleSettingsClick(): void {
    const child = container.createChildContainer();
    child.register('SettingsPanelProps', {
      useValue: { onClose: () => { /* handled by component */ } }
    });
    const panel = child.resolve(SettingsPanel);
    panel.mount(document.body);
  }

  private async handleMarkWatched(mediaId: number): Promise<void> {
    try {
      await this.dataService.updateProgress(mediaId);
      log.success('[Calendar] Progress updated');
    } catch (error) {
      log.error('[Calendar] Mark watched failed', error);
      alert('Failed to update progress. Please try again.');
    }
  }

  /**
   * Optimistically update card progress UI without full re-render
   */
  private updateCardProgressUI(mediaId: number, newProgress: number): void {
    const card = document.querySelector(`[data-media-id="${mediaId}"]`);
    if (!card) {
      log.warn(`[Calendar] Card not found for mediaId ${mediaId}, skipping UI update`);
      return;
    }

    // Update episode number
    const episodeEl = card.querySelector('.anime-card__episode');
    if (episodeEl) {
      // Get entry data to calculate behind status
      const entry = calendarStore.getState().entries.find(e => e.mediaId === mediaId);
      if (entry) {
        const isBehind = newProgress < (entry.episode - 1);
        const behindDot = isBehind ? '<span class="behind-indicator"></span>' : '';
        const total = entry.totalEpisodes;
        const episodeStr = total && total > 0 ? `${newProgress}/${total}` : `${newProgress}`;
        episodeEl.innerHTML = `${behindDot}Ep ${episodeStr}`;
        log.debug(`[Calendar] Updated card UI for mediaId ${mediaId}: progress ${newProgress}`);
      }
    }
  }

  public getName(): string {
    return 'calendar';
  }

  /**
   * Cleanup
   */
  public async destroy(): Promise<void> {
    log.info('[Calendar] Destroying module');
    this.domService.cleanup();
    calendarStore.stopCountdownInterval();
    await super.destroy();
  }
}
