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
import type { IConfigManager } from '@core/interfaces/IConfigManager';

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
  private unsubscribeConfig: (() => void) | null = null;
  private config!: IConfigManager;
  private astraActive = false;

  constructor(@inject(TOKENS.EventBus) protected eventBus: IEventBus) {
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
    this.config = container.resolve(TOKENS.Config);
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
    try {
      this.resolveDependencies();
    } catch (error) {
      this.active = false;
      throw error;
    }
    const isCurrent = () => this.active && generation === this.generation;
    this.syncAstraState();
    // Keep shared card actions available while Astra-specific UI is disabled.
    this.unsubscribeConfig = this.config.onChange('features', () => {
      if (!isCurrent()) return;
      this.syncAstraState();
      this.enhancementService.refreshAllPills();
    });

    logger.info('[Astra] Module initializing...');
    await this.service.init().catch(() => {});
    if (!isCurrent()) return;
    this.maskingService.sync();
    this.enhanceAstraNavigation();

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
      this.enhanceAstraNavigation();
    });

    // 6. Reactive Updates
    // Quick Edit saves emit these events; refresh Astra UI in place.
    this.subscribe(EVENT_TYPES.ASTRA_DATA_UPDATED, () => {
      if (isCurrent()) this.enhancementService.refreshAllPills();
    });
    this.subscribe(EVENT_TYPES.PROGRESS_UPDATED, () => {
      if (isCurrent()) this.enhancementService.refreshAllPills();
    });
    this.unsubscribePreferences = this.preferences.onChanges(() => {
      if (isCurrent()) this.enhancementService.refreshAllPills();
    });

    // 7. Safety Refresh Interval (Fail-safe for static loads)
    this.intervals.push(
      window.setInterval(() => {
        if (!isCurrent()) return;
        this.enhancementService.enhanceCards(window.location.pathname);
        if (this.astraActive) this.navService.injectNavbarButton();
      }, 3000)
    );
  }

  private setupNavbarPersistence(generation: number): void {
    const inject = () => {
      if (this.active && this.astraActive && generation === this.generation)
        this.navService.injectNavbarButton();
    };
    inject();

    this.sharedObserver.register('astra-nav-persistence', () => inject());

    const nav = document.querySelector('.nav') || document.querySelector('.header');
    if (nav) {
      const observer = new MutationObserver(() => inject());
      observer.observe(nav, { childList: true, subtree: true });
      this.observers.set('nav-local', observer);
    }
  }

  public getName(): string {
    return 'astra';
  }

  private syncAstraState(): void {
    const enabled = this.config.isFeatureEnabled('astra');
    if (enabled === this.astraActive) return;
    this.astraActive = enabled;
    if (enabled) {
      this.dashboard?.activate();
      this.dashboard?.preloadAiringData?.();
      this.navService.activate();
      this.bridge.initGlobalListeners();
      this.enhanceAstraNavigation();
      this.navService.injectNavbarButton();
    } else {
      this.dashboard?.deactivate();
      this.bridge.deactivate();
      this.navService.deactivate();
      this.ratingModal.dispose();
    }
  }

  private enhanceAstraNavigation(): void {
    if (!this.astraActive) return;
    const generation = this.generation;
    this.navService.hijackMediaButton(
      (id) =>
        this.active &&
        this.astraActive &&
        generation === this.generation &&
        this.config.isFeatureEnabled('astra')
          ? this.ratingModal.open(id)
          : undefined,
      {
        start: (id) => {
          if (
            this.active &&
            this.astraActive &&
            generation === this.generation &&
            this.config.isFeatureEnabled('astra')
          )
            this.ratingModal.prefetch(id);
        },
        cancel: () => this.ratingModal.cancelPrefetch(),
      }
    );
    this.navService.enhanceBrowseDropdown();
  }

  public override async destroy(): Promise<void> {
    this.active = false;
    this.generation++;
    this.astraActive = false;
    this.unsubscribeConfig?.();
    this.unsubscribeConfig = null;
    this.dashboard?.deactivate();
    this.bridge?.deactivate();
    this.navService?.deactivate();
    this.ratingModal?.dispose();
    this.intervals.forEach((id) => window.clearInterval(id));
    this.intervals = [];
    this.unsubscribePreferences?.();
    this.unsubscribePreferences = null;
    this.pillManager?.stop();
    this.sharedObserver?.unregister('astra-enhancer');
    this.sharedObserver?.unregister('astra-nav-persistence');
    await super.destroy();
  }
}
