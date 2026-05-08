import { injectable, inject } from 'tsyringe';
import { AstraUIBridge } from './AstraUIBridge';

/**
 * Service responsible for resolving and executing Astra-specific routes.
 * Refactored to delegate to AstraUIBridge for modal-based navigation.
 */
@injectable()
export class AstraRoutingService {
  constructor(
    @inject(AstraUIBridge) private bridge: AstraUIBridge
  ) {}

  /**
   * Navigates to the Astra Dashboard.
   */
  public navigateToDashboard(): void {
    // Strictly modal-based navigation (Master branch behavior)
    this.bridge.triggerDashboard();
  }

  /**
   * Checks if the current path is the Astra dashboard.
   */
  public isDashboardPath(): boolean {
    return window.location.pathname.endsWith('/astra');
  }
}
