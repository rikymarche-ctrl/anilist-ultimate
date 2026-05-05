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
  /** The AniList user ID for schedule filtering */
  private userId: number | null = null;

  /** Guard to prevent overlapping injection attempts during React re-renders */
  private isProcessing: boolean = false;

  /** Timestamp of the last full data refresh to throttle EventBus triggers */
  private lastRefreshTime: number = 0;

  /** Tracked intervals for automatic cleanup on module destruction */
  private intervals: number[] = [];

  /** Stored resize listener to prevent memory leaks */
  private resizeListener: (() => void) | null = null;

  /** Timeout reference for the processing guard safety valve */
  private processingTimeout: number | null = null;

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
   * Initialize the calendar module.
   * Sets up auth checks, initial injection, and reactive listeners.
   */
  public async init(): Promise<void> {
    try {
      log.group('Calendar Module Initialization');

      await calendarStore.init();
      log.success('[Calendar] Preferences loaded from storage');

      const authenticated = this.apiClient.isAuthenticated();
      if (!authenticated) {
        log.warn('[Calendar] User not authenticated, showing prompt');
        await this.handleUnauthenticated();
        return;
      }

      try {
        this.userId = await this.apiClient.getCurrentUserId();
      } catch (e) {
        log.error('[Calendar] Failed to get userId', e);
        return;
      }

      // 1. Setup late-loading section detection
      await this.setupSectionDetection();

      // 2. Initial injection attempt
      await this.runInjectionFlow();

      // 3. Reactive Page Changes (Event-Driven)
      this.onPageChange(async (event) => {
        const path = event?.path || window.location.pathname;
        if (path === '/' || path === '/home') {
          this.isProcessing = false;
          setTimeout(() => this.runInjectionFlow(), 500);
        }
      });

      // 4. Handle Resize Events (Layout persistence)
      this.resizeListener = () => {
        const path = window.location.pathname;
        if (path === '/' || path === '/home') {
          const calendarExists = !!document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
          if (!calendarExists && !this.isProcessing) {
            this.runInjectionFlow();
          }
        }
      };
      window.addEventListener('resize', this.resizeListener);

      // 5. Data Update Subscriptions
      this.subscribe(EVENT_TYPES.ASTRA_DATA_UPDATED, async () => {
        const path = window.location.pathname;
        if (path !== '/' && path !== '/home') return;
        if (Date.now() - this.lastRefreshTime < 2000) return;

        setTimeout(() => this.runInjectionFlow(true), 1500);
      });

      this.subscribe(EVENT_TYPES.PROGRESS_UPDATED, async (payload) => {
        if (payload && payload.mediaId) {
          if (payload.status && payload.status !== MediaListStatus.CURRENT) {
            calendarStore.removeEntry(payload.mediaId);
            const path = window.location.pathname;
            if (path === '/' || path === '/home') await this.runInjectionFlow(true);
          } else {
            calendarStore.updateEntry(payload.mediaId, { progress: payload.progress });
            this.updateCardProgressUI(payload.mediaId, payload.progress);
          }
        }
      });

      this.subscribe(EVENT_TYPES.CALENDAR_DATA_REFRESH, async () => {
        const path = window.location.pathname;
        if (path === '/' || path === '/home') {
          await this.runInjectionFlow(true);
        }
      });

      // 6. Persistence Polling (Robustness for SPA misses)
      this.intervals.push(window.setInterval(() => {
        const path = window.location.pathname;
        if (path === '/' || path === '/home') {
          const calendarContainer = document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
          const hasContent = !!calendarContainer?.querySelector('.calendar-grid, .calendar-grid__empty, .calendar-skeleton');
          if ((!calendarContainer || !hasContent) && !this.isProcessing) {
            this.runInjectionFlow();
          }
        }
      }, 2000));

      // 7. Native Airing Section Masking
      this.sharedObserver.register('calendar-native-hider', () => {
        const path = window.location.pathname;
        if (path !== '/' && path !== '/home') return;
        
        const calendarExists = !!document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
        if (!calendarExists) return;

        const headers = Array.from(document.querySelectorAll('h2, h3, .section-header'));
        headers.forEach(h => {
          const text = h.textContent?.trim().toLowerCase() || '';
          if (text === 'airing' && !h.classList.contains('au-calendar-title') && !h.hasAttribute('data-au-artificial')) {
            const section = h.closest('section') || h.closest('.list-preview-wrap') || h.closest('.list-preview') || h.parentElement;
            if (section && !(section as HTMLElement).classList.contains('au-native-airing-hidden')) {
              const el = section as HTMLElement;
              if (el.contains(document.getElementById(CSS_CLASSES.CALENDAR))) return;
              el.style.display = 'none';
              el.classList.add('au-native-airing-hidden');
            }
          }
        });
      }, 800);

      log.success('[Calendar] Module initialized successfully');
    } catch (error) {
      log.error('[Calendar] Initialization failed', error);
    } finally {
      log.groupEnd();
    }
  }

  /**
   * Setup detection for late-loading React sections using the SharedGlobalObserver.
   */
  private async setupSectionDetection(): Promise<void> {
    this.sharedObserver.register('calendar-airing-detector', async () => {
      const path = window.location.pathname;
      if (path !== '/' && path !== '/home') return;
      if (document.querySelector(`#${CSS_CLASSES.CALENDAR}`)) return;

      const section = await this.domService.findAiringSection();
      if (section) {
        this.runInjectionFlow();
      }
    }, 500);
  }

  /**
   * Main flow to inject UI and load schedule data.
   * Handles atomic swaps and prevents concurrent execution.
   */
  private async runInjectionFlow(forceRefresh: boolean = false): Promise<void> {
    if (this.isProcessing) return;
    
    const existingContainer = document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
    const hasContent = !!existingContainer?.querySelector('.calendar-grid, .calendar-grid__empty, .calendar-skeleton');
    
    if (existingContainer && hasContent && !forceRefresh) return;

    try {
      this.isProcessing = true;
      this.lastRefreshTime = Date.now();
      
      if (this.processingTimeout) window.clearTimeout(this.processingTimeout);
      this.processingTimeout = window.setTimeout(() => { this.isProcessing = false; }, 10000);
      
      const astraEnabled = this.config.isFeatureEnabled('astra');
      const calendarContainer = await this.domService.injectCalendar(
        () => this.handleSettingsClick(),
        (mediaId) => this.handleMarkWatched(mediaId),
        astraEnabled
      );

      if (!calendarContainer) return;

      if (this.userId) {
        await this.dataService.loadSchedule(this.userId, forceRefresh);
        if (this.config.isFeatureEnabled('friendActivity')) {
          this.socialService.loadFriendActivity();
        }
      }
    } catch (error) {
      log.error('[Calendar] Injection flow failed', error);
    } finally {
      this.isProcessing = false;
      if (this.processingTimeout) {
        window.clearTimeout(this.processingTimeout);
        this.processingTimeout = null;
      }
    }
  }

  /**
   * Shows an authentication prompt if the user is not logged in.
   */
  private async handleUnauthenticated(): Promise<void> {
    const astraEnabled = this.config.isFeatureEnabled('astra');
    const calendarContainer = await this.domService.injectCalendar(() => {}, async () => {}, astraEnabled);
    if (calendarContainer) {
      this.domService.showAuthPrompt(async () => {
        try {
          await this.auth.login();
          window.location.reload();
        } catch (error) {
          log.error('[Calendar] Login error:', error);
        }
      });
    }
  }

  /**
   * Opens the calendar settings panel.
   */
  private handleSettingsClick(): void {
    const child = container.createChildContainer();
    child.register('SettingsPanelProps', {
      useValue: { onClose: () => { /* handled by component */ } }
    });
    const panel = child.resolve(SettingsPanel);
    panel.mount(document.body);
  }

  /**
   * Handles the mark as watched action for a specific anime.
   */
  private async handleMarkWatched(mediaId: number): Promise<void> {
    try {
      await this.dataService.updateProgress(mediaId);
    } catch (error) {
      log.error('[Calendar] Mark watched failed', error);
    }
  }

  /**
   * Optimistically update the progress indicator on a specific anime card.
   */
  private updateCardProgressUI(mediaId: number, newProgress: number): void {
    const card = document.querySelector(`[data-media-id="${mediaId}"]`);
    if (!card) return;

    const episodeEl = card.querySelector('.anime-card__episode');
    if (episodeEl) {
      const entry = calendarStore.getState().entries.find(e => e.mediaId === mediaId);
      if (entry) {
        const isBehind = newProgress < (entry.episode - 1);
        const behindDot = isBehind ? '<span class="behind-indicator"></span>' : '';
        const total = entry.totalEpisodes;
        const episodeStr = total && total > 0 ? `${newProgress}/${total}` : `${newProgress}`;
        episodeEl.innerHTML = `${behindDot}Ep ${episodeStr}`;
      }
    }
  }

  public getName(): string {
    return 'calendar';
  }

  /**
   * Cleans up all intervals, listeners, and observers.
   */
  public override async destroy(): Promise<void> {
    log.info('[Calendar] Destroying module');
    
    // 1. Clear managed intervals
    this.intervals.forEach(id => window.clearInterval(id));
    this.intervals = [];

    // 2. Remove window listeners
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = null;
    }

    // 3. Clear processing timeout
    if (this.processingTimeout) {
      window.clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }

    // 4. Component cleanup
    this.domService.cleanup();
    calendarStore.stopCountdownInterval();

    // 5. Unregister observers
    this.sharedObserver.unregister('calendar-native-hider');
    this.sharedObserver.unregister('calendar-airing-detector');

    await super.destroy();
  }
}
