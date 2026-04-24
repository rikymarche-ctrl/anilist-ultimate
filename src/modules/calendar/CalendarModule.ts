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
import { container } from '@core/di/container';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import { CalendarDomService } from './services/CalendarDomService';
import { CalendarDataService } from './services/CalendarDataService';
import { CalendarSocialService } from './services/CalendarSocialService';

@injectable()
export class CalendarModule extends BaseModule {
  private userId: number | null = null;
  private isProcessing: boolean = false;

  constructor(
    @inject(TOKENS.CalendarDomService) private domService: CalendarDomService,
    @inject(TOKENS.CalendarDataService) private dataService: CalendarDataService,
    @inject(TOKENS.CalendarSocialService) private socialService: CalendarSocialService,
    @inject(TOKENS.Config) private config: IConfigManager
  ) {
    super();
  }

  /**
   * Initialize the calendar module
   */
  public async init(): Promise<void> {
    try {
      log.group('Calendar Module Initialization');

      // Check authentication via centralized client
      if (!anilistClient.isAuthenticated()) {
        log.warn('[Calendar] User not authenticated, showing prompt');
        await this.handleUnauthenticated();
        return;
      }

      this.userId = await anilistClient.getCurrentUserId();
      log.info('[Calendar] Initializing for user', { userId: this.userId });

      // Initial injection
      await this.runInjectionFlow();

      // Subscribe to navigation events (Event-Driven reactivity)
      this.onPageChange(async (event) => {
        const path = event?.path || window.location.pathname;
        log.debug('[Calendar] Page changed, checking injection', { path });
        const isHomePage = path === '/' || path === '/home';
        if (isHomePage) {
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
          const eventBus = container.resolve<any>(TOKENS.EventBus);
          eventBus.emit('astra:open');
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
    // Note: SettingsPanel logic could eventually move to a dedicated UI service
    log.info('[Calendar] Settings click handled');
    import('./components/SettingsPanel').then(({ SettingsPanel }) => {
      const panel = new SettingsPanel({ onClose: () => {} });
      panel.mount(document.body);
    });
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
