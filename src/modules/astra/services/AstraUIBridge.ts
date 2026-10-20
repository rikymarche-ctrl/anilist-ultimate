import { injectable, inject, type Disposable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';

/** Document-owned bridge; feature OFF removes listeners without retiring the singleton. */
@injectable()
export class AstraUIBridge implements Disposable {
  private active = false;
  private disposed = false;
  private generation = 0;
  private openHandler: EventListener | undefined;
  private clickHandler: EventListener | undefined;
  constructor(@inject(TOKENS.EventBus) private eventBus: IEventBus) {}

  public initGlobalListeners(): void {
    if (this.disposed || this.active) return;
    this.active = true;
    const generation = ++this.generation;
    const isCurrent = () => this.active && !this.disposed && generation === this.generation;
    this.openHandler = () => { if (isCurrent()) this.triggerDashboard(); };
    this.clickHandler = event => {
      if (!isCurrent()) return;
      const target = event.target instanceof Element ? event.target
        : event.target instanceof Node ? event.target.parentElement : null;
      if (target?.closest('.au-astra-nav')?.isConnected) {
        event.preventDefault();
        this.triggerDashboard();
      }
    };
    window.addEventListener('astra:open', this.openHandler);
    document.addEventListener('click', this.clickHandler, true);
  }

  public deactivate(): void {
    if (!this.active) return;
    this.active = false; this.generation++;
    if (this.openHandler) window.removeEventListener('astra:open', this.openHandler);
    if (this.clickHandler) document.removeEventListener('click', this.clickHandler, true);
    this.openHandler = undefined; this.clickHandler = undefined;
  }

  public triggerDashboard(): void {
    if (this.active && !this.disposed) this.eventBus.emit(EVENT_TYPES.ASTRA_OPEN);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.deactivate(); this.disposed = true;
  }
}
