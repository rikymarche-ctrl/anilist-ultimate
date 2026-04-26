/**
 * Calendar Module
 * Lean orchestrator for the calendar feature
 * Delegating responsibilities to specialized services (SRP)
 */

import { injectable, inject } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { anilistClient } from '@/api/AnilistClient';
import { calendarStore } from './CalendarStore';
import { CSS_CLASSES } from '@core/constants';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { container } from '@core/di/container';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import { CalendarDomService } from './services/CalendarDomService';
import { CalendarDataService } from './services/CalendarDataService';
import { CalendarSocialService } from './services/CalendarSocialService';
import { SettingsPanel } from './components/SettingsPanel';

@injectable()
export class CalendarModule extends BaseModule {
  private userId: number | null = null;
  private isProcessing: boolean = false;

  constructor(
    @inject(TOKENS.CalendarDomService) private domService: CalendarDomService,
    @inject(TOKENS.CalendarDataService) private dataService: CalendarDataService,
    @inject(TOKENS.CalendarSocialService) private socialService: CalendarSocialService,
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
      if (!anilistClient.isAuthenticated()) {
        log.warn('[Calendar] User not authenticated, showing prompt');
        await this.handleUnauthenticated();
        return;
      }

      this.userId = await anilistClient.getCurrentUserId();
      log.info('[Calendar] Initializing for user', { userId: this.userId });

      // 1. Setup MutationObserver for late-loading React sections
      this.setupSectionDetection();

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
  private setupSectionDetection(): void {
    log.debug('[Calendar] Setting up section detection observer');
    
    this.registerObserver(
      'airing-section-detector',
      document.body,
      { childList: true, subtree: true },
      async () => {
        // Only run if on home page and calendar doesn't exist
        const isHomePage = window.location.pathname === '/' || window.location.pathname === '/home';
        if (!isHomePage) return;

        const calendarExists = !!document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
        if (calendarExists) return;

        // Try to find the section
        const section = await this.domService.findAiringSection();
        if (section) {
          log.info('[Calendar] Airing section detected via mutation, triggering injection');
          this.runInjectionFlow();
        }
      },
      500 // Throttle to 500ms
    );
  }

  /**
   * Main flow to inject UI and load data
   */
  private async runInjectionFlow(): Promise<void> {
    if (this.isProcessing) return;
    
    const calendarExists = !!document.querySelector(`#${CSS_CLASSES.CALENDAR}`);
    if (calendarExists) return;

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
        await this.dataService.loadSchedule(this.userId);

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
