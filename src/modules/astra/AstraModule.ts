import { injectable, inject, container } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { logger } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { AstraService } from './AstraService';
import { AstraRatingModal } from './ui/AstraRatingModal';
import { AstraEnhancementService } from './services/AstraEnhancementService';
import { AstraNavigationService } from './services/AstraNavigationService';
import { AstraPillManager } from './services/AstraPillManager';
import { AstraUIBridge } from './services/AstraUIBridge';
import { AstraDashboard } from './ui/AstraDashboard';
import { PreferencesService } from '@core/services/PreferencesService';
import { SocialMaskingService } from '@core/services/SocialMaskingService';
import { EVENT_TYPES } from '@core/events/EventTypes';

/**
 * Main module for the Astra advanced scoring system.
 * Orchestrates navigation, card enhancements, and dashboard state.
 */
@injectable()
export class AstraModule extends BaseModule {
  private service!: AstraService;
  private ratingModal!: AstraRatingModal;
  private sharedObserver!: SharedGlobalObserver;
  private maskingService!: SocialMaskingService;
  private enhancementService!: AstraEnhancementService;
  private navService!: AstraNavigationService;
  private pillManager!: AstraPillManager;
  private preferences!: PreferencesService;
  private bridge!: AstraUIBridge;
  private dashboard: AstraDashboard | undefined;
  private active = false;
  private generation = 0;
  private intervals: number[] = [];
  private unsubscribePreferences: (() => void) | null = null;

  constructor(
    @inject(TOKENS.EventBus) protected eventBus: IEventBus
  ) {
    super(eventBus);
  }

  /**
   * Lazy-resolves dependencies to break circular patterns in the ModuleRegistry lifecycle.
   */
  private resolveDependencies(): void {
    this.service = container.resolve(AstraService);
    this.ratingModal = container.resolve(AstraRatingModal);
    this.sharedObserver = container.resolve(TOKENS.SharedGlobalObserver);
    this.maskingService = container.resolve(TOKENS.SocialMaskingService);
    this.enhancementService = container.resolve(AstraEnhancementService);
    this.navService = container.resolve(AstraNavigationService);
    this.pillManager = container.resolve(AstraPillManager);
    this.preferences = container.resolve(TOKENS.PreferencesService);
    this.bridge = container.resolve(AstraUIBridge);
    // Initialize Dashboard to start listening for global open events
    try {
      this.dashboard = container.resolve(AstraDashboard);
    } catch {
      logger.error('[AstraModule] Failed to resolve AstraDashboard');
    }
  }

  public async init(): Promise<void> {
    if (this.active) return;
    this.active = true;
    const generation = ++this.generation;
    try { this.resolveDependencies(); } catch (error) { this.active = false; throw error; }
    this.dashboard?.activate();
    this.dashboard?.preloadAiringData?.();
    this.navService.activate();
    const isCurrent = () => this.active && generation === this.generation;

    // 0. Initialize Bridge (Static listeners for early clicks)
    this.bridge.initGlobalListeners();

    logger.info('[Astra] Module initializing...');
    await this.service.init().catch(() => { });
    if (!isCurrent()) return;
    this.maskingService.sync();
    this.navService.hijackMediaButton(id => isCurrent() ? this.ratingModal.open(id) : undefined);

    // 2. Initial Enhancement Pass
    this.enhancementService.enhanceCards(window.location.pathname);

    // 3. Pill Interactions
    this.pillManager.start();

    // 4. Navbar Persistence
    this.setupNavbarPersistence(generation);

    // 5. Background Enhancement Loop (Mutation-based)
    this.sharedObserver.register('astra-enhancer', () => {
      if (!isCurrent()) return;
      const path = window.location.pathname;
      this.enhancementService.enhanceCards(path);
      this.navService.hijackMediaButton(id => isCurrent() ? this.ratingModal.open(id) : undefined);
      this.navService.enhanceBrowseDropdown();
    });

    // 6. Reactive Updates
    // Quick Edit saves emit these events; refresh Astra UI in place.
    this.subscribe(EVENT_TYPES.ASTRA_DATA_UPDATED, () => { if (isCurrent()) this.enhancementService.refreshAllPills(); });
    this.subscribe(EVENT_TYPES.PROGRESS_UPDATED, () => { if (isCurrent()) this.enhancementService.refreshAllPills(); });
    this.unsubscribePreferences = this.preferences.onChanges(() => {
      if (isCurrent()) this.enhancementService.refreshAllPills();
    });

    // 7. Safety Refresh Interval (Fail-safe for static loads)
    this.intervals.push(window.setInterval(() => {
      if (!isCurrent()) return;
      this.enhancementService.enhanceCards(window.location.pathname);
      this.navService.injectNavbarButton();
    }, 3000));
  }

  private setupNavbarPersistence(generation: number): void {
    const inject = () => { if (this.active && generation === this.generation) this.navService.injectNavbarButton(); };
    inject();

    this.sharedObserver.register('astra-nav-persistence', () => inject());

    const nav = document.querySelector('.nav') || document.querySelector('.header');
    if (nav) {
      const observer = new MutationObserver(() => inject());
      observer.observe(nav, { childList: true, subtree: true });
      this.observers.set('nav-local', observer);
    }
  }

  public getName(): string { return 'astra'; }

  public override async destroy(): Promise<void> {
    this.active = false; this.generation++;
    this.dashboard?.deactivate();
    this.bridge?.deactivate();
    this.navService?.deactivate();
    this.ratingModal?.dispose();
    this.intervals.forEach(id => window.clearInterval(id));
    this.intervals = [];
    this.unsubscribePreferences?.();
    this.unsubscribePreferences = null;
    this.pillManager?.stop();
    this.sharedObserver?.unregister('astra-enhancer');
    this.sharedObserver?.unregister('astra-nav-persistence');
    await super.destroy();
  }
}
