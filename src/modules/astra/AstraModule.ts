import { injectable, inject, container } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { log } from '@core/logger';
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
  private intervals: number[] = [];

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
      container.resolve(AstraDashboard);
    } catch (e) {
      log.error('[AstraModule] Failed to resolve AstraDashboard', e);
    }
  }

  public async init(): Promise<void> {
    this.resolveDependencies();

    // 0. Initialize Bridge (Static listeners for early clicks)
    this.bridge.initGlobalListeners();

    log.info('[Astra] Module initializing...');
    await this.service.init().catch(() => { });
    this.maskingService.sync();

    // 2. Initial Enhancement Pass
    this.enhancementService.enhanceCards(window.location.pathname);

    // 3. Pill Interactions
    this.pillManager.start();

    // 4. Navbar Persistence
    this.setupNavbarPersistence();

    // 5. Background Enhancement Loop (Mutation-based)
    this.sharedObserver.register('astra-enhancer', () => {
      const path = window.location.pathname;
      this.enhancementService.enhanceCards(path);
      this.navService.hijackMediaButton((id) => this.ratingModal.open(id));
      this.navService.enhanceBrowseDropdown();
    });

    // 6. Reactive Updates
    this.preferences.onChanges(() => {
      this.enhancementService.refreshAllPills();
    });

    // 7. Safety Refresh Interval (Fail-safe for static loads)
    this.intervals.push(window.setInterval(() => {
      this.enhancementService.enhanceCards(window.location.pathname);
      this.navService.injectNavbarButton();
    }, 3000));
  }

  private setupNavbarPersistence(): void {
    const inject = () => this.navService.injectNavbarButton();
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
    this.intervals.forEach(id => window.clearInterval(id));
    this.pillManager.stop();
    this.sharedObserver.unregister('astra-enhancer');
    this.sharedObserver.unregister('astra-nav-persistence');
    await super.destroy();
  }
}
