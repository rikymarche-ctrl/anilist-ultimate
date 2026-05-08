import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { log } from '@core/logger';

/**
 * AstraUIBridge
 * Central hub for capturing UI events that might occur before the full module is ready.
 */
@injectable()
export class AstraUIBridge {
  constructor(
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) { }

  /**
   * Initializes global window listeners. 
   * This is the "Fail-Safe" for SPA navigation.
   */
  public initGlobalListeners(): void {
    log.info('[AstraBridge] Initializing global listeners');

    // Catch-all for native custom events
    window.addEventListener('astra:open', () => {
      console.log('[AstraBridge] Native astra:open intercepted');
      this.eventBus.emit(EVENT_TYPES.ASTRA_OPEN);
    });

    // Nuclear Interceptor: Catch ANY click on an astra-nav element
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.au-astra-nav')) {
        console.log('[AstraBridge] Global click intercept!');
        e.preventDefault();
        this.eventBus.emit(EVENT_TYPES.ASTRA_OPEN);
      }
    }, { capture: true });
  }

  /**
   * Dispatches the open event globally.
   */
  public triggerDashboard(): void {
    this.eventBus.emit(EVENT_TYPES.ASTRA_OPEN);
  }
}
