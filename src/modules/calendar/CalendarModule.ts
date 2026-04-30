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
          } else {
            calendarStore.updateEntry(payload.mediaId, { progress: payload.progress });
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
    }, 1000); // 1s throttle is enough
  }

  /**
   * Main flow to inject UI and load data
   */
  private async runInjectionFlow(forceRefresh: boolean = false): Promise<void> {
    if (this.isProcessing) return;
    
    const calendarExists = !!document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
    if (calendarExists && !forceRefresh) return;

    try {
      this.isProcessing = true;
      log.info('[Calendar] Running injection flow...');

      // 1. Inject UI via DOM Service
      const calendarContainer = await this.domService.injectCalendar(
        () => this.handleSettingsClick(),
        () => {
          this.eventBus.emit(EVENT_TYPES.ASTRA_OPEN);
        },
        (mediaId) => this.handleMarkWatched(mediaId)
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
    const calendarContainer = await this.domService.injectCalendar(() => {}, () => {}, async () => {});
    if (calendarContainer) {
      this.domService.showAuthPrompt();
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
