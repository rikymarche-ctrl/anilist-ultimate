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
import { logger } from '@core/logger';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { TOKENS } from '@core/di/tokens';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { CalendarStore } from './CalendarStore';
import { CSS_CLASSES } from '@core/constants';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { EventPayload, IEventBus } from '@core/interfaces/IEventBus';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import { CalendarDomService } from './services/CalendarDomService';
import { CalendarDataService } from './services/CalendarDataService';
import { CalendarSocialService } from './services/CalendarSocialService';
import { AuthService } from '@core/auth/AuthService';
import { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { SettingsPanel } from './components/SettingsPanel';
import { CustomCalendarPlanPanel } from './components/CustomCalendarPlanPanel';
import type { CalendarCustomPlan } from '@core/types';
import { MediaListStatus } from '@/api/AnilistTypes';
import { isCalendarId } from './CalendarEntries';
import { hasLapsedAiring } from './CalendarAiring';

@injectable()
export class CalendarModule extends BaseModule {
  /** The AniList user ID for schedule filtering */
  private generation = 0;
  private destroyed = false;
  private userId: number | null = null;

  /** Guard to prevent overlapping injection attempts during React re-renders */
  private isProcessing: boolean = false;
  private refreshRequested = false;

  /** Timestamp of the last full data refresh to throttle EventBus triggers */
  private lastRefreshTime: number = 0;
  private lastAiringRefresh: number | null = null;

  /** Tracked intervals for automatic cleanup on module destruction */
  private intervals: number[] = [];

  /** Stored resize listener to prevent memory leaks */
  private resizeListener: (() => void) | null = null;

  /** Tracked preference listener for cleanup */
  private preferencesListener: (() => void) | null = null;
  private visibilityListener: (() => void) | null = null;
  private settingsPanel: SettingsPanel | null = null;
  private customPlanPanel: CustomCalendarPlanPanel | null = null;

  constructor(
    @inject(TOKENS.ApiClient) private apiClient: IApiClient,
    @inject(TOKENS.CalendarDomService) private domService: CalendarDomService,
    @inject(TOKENS.CalendarDataService) private dataService: CalendarDataService,
    @inject(TOKENS.CalendarSocialService) private socialService: CalendarSocialService,
    @inject(TOKENS.CalendarStore) private store: CalendarStore,
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
    this.destroyed = false;
    const generation = ++this.generation;
    try {
      logger.group('Calendar Module Initialization');

      await this.store.init();
      if (this.destroyed || generation !== this.generation) return;
      logger.success('[Calendar] Preferences loaded from storage');
      this.subscribe(EVENT_TYPES.SYNC_QUEUE_CHANGED, () => {
        if (!this.isCurrent(this.generation) || !this.apiClient.isAuthenticated()) return;
        if (this.isProcessing) this.refreshRequested = true;
        else void this.runInjectionFlow(true);
      });

      const authenticated = this.apiClient.isAuthenticated();
      if (!authenticated) {
        logger.warn('[Calendar] User not authenticated, showing prompt');
      }

      // Listeners go live before the first flow so events during the initial load are not missed; each handler re-checks its generation.
      this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
        void this.handleAuthStateChanged().catch((error: unknown) => logger.error('[Calendar] Auth state change handling failed', error));
      });

      // 3. Reactive Page Changes (Event-Driven)
      this.onPageChange((event) => {
        void this.handlePageChange(event?.path).catch((error: unknown) => logger.error('[Calendar] Page change handling failed', error));
      });

      // 4. Handle Resize Events (Layout persistence)
      this.resizeListener = () => {
        const path = window.location.pathname;
        if (path === '/' || path === '/home') {
          const calendarExists = !!document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
          if (!calendarExists && !this.isProcessing) {
            void this.runInjectionFlow().catch((error: unknown) => logger.error('[Calendar] Injection flow failed', error));
          }
        }
      };
      window.addEventListener('resize', this.resizeListener);

      // 5. Data Update Subscriptions
      this.subscribe(EVENT_TYPES.ASTRA_DATA_UPDATED, () => {
        void this.handleAstraDataUpdated().catch((error: unknown) => logger.error('[Calendar] Astra data update handling failed', error));
      });

      this.subscribe(EVENT_TYPES.PROGRESS_UPDATED, (payload) => {
        void this.handleProgressUpdated(payload).catch((error: unknown) => logger.error('[Calendar] Progress update handling failed', error));
      });

      this.subscribe(EVENT_TYPES.CALENDAR_DATA_REFRESH, () => {
        void this.handleCalendarDataRefresh().catch((error: unknown) => logger.error('[Calendar] Calendar data refresh handling failed', error));
      });

      // 5b. Settings Reactivity
      this.preferencesListener = () => {
        const path = window.location.pathname;
        if (path === '/' || path === '/home') {
          this.domService.refreshGrid();
        }
      };
      window.addEventListener('calendar-preferences-updated', this.preferencesListener);

      this.visibilityListener = () => {
        if (document.visibilityState === 'hidden' || !this.isCurrent(this.generation) || this.isProcessing) return;
        if (this.refreshRequested) {
          this.refreshRequested = false;
          void this.runInjectionFlow(true);
        }
      };
      document.addEventListener('visibilitychange', this.visibilityListener);

      // 6. Persistence Polling (Robustness for SPA misses)
      this.intervals.push(window.setInterval(() => {
        const path = window.location.pathname;
        if (path === '/' || path === '/home') {
          const calendarContainer = document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
          const hasContent = !!calendarContainer?.querySelector('.calendar-grid, .calendar-grid__empty, .calendar-skeleton, .calendar-grid__error, .calendar-error, .calendar-auth-prompt');
          if ((!calendarContainer || !hasContent) && !this.isProcessing) {
            void this.runInjectionFlow().catch((error: unknown) => logger.error('[Calendar] Injection flow failed', error));
          } else if (hasContent && !this.isProcessing && this.apiClient.isAuthenticated()) {
            const now = Date.now();
            const expired = hasLapsedAiring(this.store.getState().entries, now);
            if (expired && (this.lastAiringRefresh === null || now < this.lastAiringRefresh || now - this.lastAiringRefresh >= 300000)) {
              // Refresh the provider after airing; never invent a weekly date.
              // Retry lagging/offline schedules at most once every five minutes.
              this.lastAiringRefresh = now;
              void this.runInjectionFlow(true);
            }
          }
        }
      }, 2000));

      // 1. Setup late-loading section detection
      await this.setupSectionDetection();

      // 2. Initial injection attempt
      await this.runInjectionFlow();
      if (this.destroyed || generation !== this.generation) return;

      // 7. Native Airing Section Masking
      this.sharedObserver.register('calendar-native-hider', () => {
        this.domService.maskNativeSections();
      }, 800);

      logger.success('[Calendar] Module initialized successfully');
    } catch (error) {
      logger.error('[Calendar] Initialization failed', error);
    } finally {
      logger.groupEnd();
    }
  }

  private async handleAuthStateChanged(): Promise<void> {
    this.generation++;
    this.closeSettings();
    this.closeCustomPlanPanel();
    this.userId = null;
    this.lastAiringRefresh = null;
    this.isProcessing = false;
    this.refreshRequested = false;
    this.domService.cleanup();
    if (!this.isCurrent(this.generation)) return;
    if (this.apiClient.isAuthenticated()) await this.runInjectionFlow(true);
    else await this.handleUnauthenticated();
  }

  private async handlePageChange(eventPath: string | undefined): Promise<void> {
    this.generation++;
    this.lastAiringRefresh = null;
    this.closeSettings();
    this.closeCustomPlanPanel();
    this.isProcessing = false;
    this.refreshRequested = false;
    const path = eventPath || window.location.pathname;
    // A new route generation needs fresh callbacks even when both routes show the home page.
    this.domService.cleanup();
    if (path === '/' || path === '/home') await this.runInjectionFlow();
  }

  private async handleAstraDataUpdated(): Promise<void> {
    const path = window.location.pathname;
    if (path !== '/' && path !== '/home') return;
    if (Date.now() - this.lastRefreshTime < 2000) return;

    void this.runInjectionFlow(true).catch((error: unknown) => logger.error('[Calendar] Astra data refresh failed', error));
  }

  private async handleProgressUpdated(payload?: EventPayload<typeof EVENT_TYPES.PROGRESS_UPDATED>): Promise<void> {
    if (payload && payload.mediaId && payload.userId === this.userId && this.apiClient.isAuthenticated()) {
      if (payload.status && payload.status !== MediaListStatus.CURRENT && payload.status !== MediaListStatus.REPEATING) {
        this.store.removeEntry(payload.mediaId);
        const path = window.location.pathname;
        if (path === '/' || path === '/home') await this.runInjectionFlow(true);
      } else {
        this.store.updateEntry(payload.mediaId, { progress: payload.progress });
      }
    }
  }

  private async handleCalendarDataRefresh(): Promise<void> {
    const path = window.location.pathname;
    if (path === '/' || path === '/home') {
      await this.runInjectionFlow(true);
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

      const generation = this.generation;
      const section = await this.domService.findAiringSection();
      if (this.isCurrent(generation) && section) {
        void this.runInjectionFlow().catch((error: unknown) => logger.error('[Calendar] Airing section injection failed', error));
      }
    }, 500);
  }

  /**
   * Main flow to inject UI and load schedule data.
   * Reuses the mounted hierarchy during refresh and prevents overlapping flows.
   */
  private isCurrent(generation: number): boolean {
    return !this.destroyed && generation === this.generation && ['/', '/home'].includes(window.location.pathname);
  }

  private async runInjectionFlow(forceRefresh: boolean = false): Promise<void> {
    const generation = this.generation;
    if (!this.isCurrent(generation) || this.isProcessing) return;
    if (!this.apiClient.isAuthenticated()) {
      await this.handleUnauthenticated();
      return;
    }
    if (document.visibilityState === 'hidden') {
      // Every tab receives queue broadcasts. Keep the invalidation, but defer
      // provider work until this calendar can actually be seen.
      this.refreshRequested = true;
      return;
    }

    const existingContainer = document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
    const hasContent = !!existingContainer?.querySelector('.calendar-grid, .calendar-grid__empty, .calendar-skeleton, .calendar-grid__error, .calendar-error');

    if (existingContainer && hasContent && !forceRefresh) return;

    try {
      this.isProcessing = true;
      const context = await captureApiContext(this.apiClient);
      // The initialized auth session already supplies the owner. A Viewer read
      // here would serialize calendar startup behind the shared API queue.
      const owner = isCalendarId(context?.userId) ? context.userId : await this.apiClient.getCurrentUserId();
      if (!this.isCurrent(generation)) return;
      assertApiContext(this.apiClient, context, owner);
      this.userId = owner;
      this.lastRefreshTime = Date.now();
      await this.store.loadCustomPlans(owner);
      if (!this.isCurrent(generation)) return;
      assertApiContext(this.apiClient, context, owner);

      const astraEnabled = this.config.isFeatureEnabled('astra');
      // Refresh data in the live hierarchy, preserving pending card actions and controls.
      const calendarContainer = existingContainer && hasContent && forceRefresh ? existingContainer : await this.domService.injectCalendar(
        () => { if (this.isCurrent(generation)) this.handleSettingsClick(); },
        (mediaId) => this.handleMarkWatched(mediaId),
        astraEnabled,
        () => this.isCurrent(generation),
        async () => {
          if (!this.isCurrent(generation)) return;
          assertApiContext(this.apiClient, context, owner);
          await this.runInjectionFlow(true);
        },
        () => { if (this.isCurrent(generation)) this.handleCustomPlanClick(); },
        mediaId => { if (this.isCurrent(generation)) this.handleCustomPlanClick(mediaId); }
      );

      if (!calendarContainer || !this.isCurrent(generation)) return;
      assertApiContext(this.apiClient, context, owner);

      if (this.userId) {
        await this.dataService.loadSchedule(this.userId, forceRefresh);
        if (!this.isCurrent(generation)) return;
        assertApiContext(this.apiClient, context, owner);
        if (this.config.isFeatureEnabled('friendActivity')) {
          void this.socialService.loadFriendActivity().catch((error: unknown) => logger.error('[Calendar] Friend activity load failed', error));
        }
      }
    } catch (error) {
      logger.error('[Calendar] Injection flow failed', error);
    } finally {
      if (generation === this.generation) {
        this.isProcessing = false;
        if (this.refreshRequested && this.isCurrent(generation)) {
          this.refreshRequested = false;
          void this.runInjectionFlow(true);
        }
      }
    }
  }

  /**
   * Shows an authentication prompt if the user is not logged in.
   */
  private async handleUnauthenticated(): Promise<void> {
    const generation = this.generation;
    if (!this.isCurrent(generation) || this.isProcessing) return;
    this.isProcessing = true;
    try {
      const astraEnabled = this.config.isFeatureEnabled('astra');
      const calendarContainer = await this.domService.injectCalendar(() => {}, async () => {}, astraEnabled, () => this.isCurrent(generation));
      if (calendarContainer && this.isCurrent(generation)) {
        this.domService.showAuthPrompt(async () => {
          if (!this.isCurrent(generation)) return;
          // Auth state events replace this prompt when login completes, including
          // a login initiated from the extension popup or another tab.
          await this.auth.login();
        });
      }
    } finally {
      if (generation === this.generation) this.isProcessing = false;
    }
  }

  /**
   * Opens the calendar settings panel.
   */
  private handleSettingsClick(): void {
    if (!this.isCurrent(this.generation)) return;
    this.closeCustomPlanPanel();
    if (this.settingsPanel?.getElement().isConnected) return;
    this.closeSettings();
    // Use the same injected store as this module, even in a child DI scope.
    const panel = new SettingsPanel({ onClose: () => {
      if (this.settingsPanel === panel) this.settingsPanel = null;
    } }, this.store);
    this.settingsPanel = panel;
    panel.mount(document.body);
  }

  private closeSettings(): void {
    this.settingsPanel?.unmount();
    this.settingsPanel = null;
  }

  private handleCustomPlanClick(mediaId?: number): void {
    const ownerId = this.userId;
    if (!ownerId || !this.apiClient.isAuthenticated()) return;
    this.closeSettings();
    if (this.customPlanPanel) { this.customPlanPanel.close(); this.customPlanPanel = null; }
    const initialPlan: CalendarCustomPlan | undefined = mediaId
      ? this.store.getCustomPlans(ownerId).find(plan => plan.mediaId === mediaId) : undefined;
    if (mediaId && !initialPlan) return;
    const panel = new CustomCalendarPlanPanel({
      api: this.apiClient,
      store: this.store,
      ownerId,
      initialPlan,
      onChanged: () => {
        if (this.userId !== ownerId || !this.apiClient.isAuthenticated()) return;
        void this.reloadAfterPersonalPlanChange(ownerId).catch(error => logger.warn('[Calendar] Personal plan refresh failed', error));
      },
      onClose: () => { if (this.customPlanPanel === panel) this.customPlanPanel = null; },
    });
    this.customPlanPanel = panel;
    panel.mount(document.body);
  }

  private closeCustomPlanPanel(): void {
    this.customPlanPanel?.close();
    this.customPlanPanel = null;
  }

  /**
   * Reloads the schedule after a personal plan change. The reload replaces every
   * entry, so friend avatars are restored the same way the injection flow does.
   */
  private async reloadAfterPersonalPlanChange(ownerId: number): Promise<void> {
    await this.dataService.loadSchedule(ownerId, true);
    if (this.userId !== ownerId || !this.apiClient.isAuthenticated()) return;
    if (this.config.isFeatureEnabled('friendActivity')) {
      void this.socialService.loadFriendActivity().catch((error: unknown) => logger.error('[Calendar] Friend activity load failed', error));
    }
  }

  /**
   * Handles the mark as watched action for a specific anime.
   */
  private async handleMarkWatched(mediaId: number): Promise<void> {
    try {
      await this.dataService.updateProgress(mediaId);
    } catch (error) {
      logger.error('[Calendar] Mark watched failed', error);
    }
  }

  public getName(): string {
    return 'calendar';
  }

  /**
   * Cleans up all intervals, listeners, and observers.
   */
  public override async destroy(): Promise<void> {
    this.destroyed = true;
    this.generation++;
    this.closeSettings();
    this.closeCustomPlanPanel();
    this.userId = null;
    this.lastAiringRefresh = null;
    this.isProcessing = false;
    this.refreshRequested = false;
    logger.info('[Calendar] Destroying module');

    // 1. Clear managed intervals
    this.intervals.forEach(id => window.clearInterval(id));
    this.intervals = [];

    // 2. Remove window listeners
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = null;
    }

    // 4. Component cleanup
    if (this.preferencesListener) {
      window.removeEventListener('calendar-preferences-updated', this.preferencesListener);
      this.preferencesListener = null;
    }
    if (this.visibilityListener) {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }

    this.domService.cleanup();
    this.store.stopCountdownInterval();

    // 5. Unregister observers
    this.sharedObserver.unregister('calendar-native-hider');
    this.sharedObserver.unregister('calendar-airing-detector');

    await super.destroy();
  }
}
