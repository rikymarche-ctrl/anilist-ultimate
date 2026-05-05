/**
 * @file AstraDashboard.ts
 * @description Root component for the Astra Dashboard modal.
 * Orchestrates sub-components and binds them to the Dashboard Controller.
 */

import { injectable, singleton, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraView } from './base/AstraView';
import type { IDashboardController } from '../interfaces/IDashboardController';
import { AstraDashboardHeader } from './components/AstraDashboardHeader';
import { AstraStatsOverview } from './components/AstraStatsOverview';
import { AstraWorkGrid } from './components/AstraWorkGrid';
import { log } from '@core/logger';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';

/**
 * Implementation of the Astra Dashboard.
 */
@injectable()
@singleton()
export class AstraDashboard extends AstraView {
  private overlay: HTMLElement | null = null;

  // Child Components
  private header: AstraDashboardHeader;
  private stats: AstraStatsOverview;
  private grid: AstraWorkGrid;

  constructor(
    @inject(TOKENS.AstraDashboardController) private controller: IDashboardController,
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) {
    super({});

    // Initialize components
    this.header = new AstraDashboardHeader(this.controller);
    this.stats = new AstraStatsOverview();
    this.grid = new AstraWorkGrid();

    // Global listeners
    this.eventBus.on(EVENT_TYPES.ASTRA_OPEN, () => this.open());
  }

  /**
   * Opens the dashboard modal.
   */
  public async open(): Promise<void> {
    if (this.overlay) return;

    log.debug('[AstraDashboard] Opening dashboard shell...');

    // Initialize data through controller
    await this.controller.open();

    this.overlay = document.createElement('div');
    this.overlay.className = 'astra-modal-overlay';
    document.body.appendChild(this.overlay);
    document.body.style.overflow = 'hidden';

    // Mount shell template
    this.mount(this.overlay);

    // Initial render of children
    this.renderInternal();

    // Subscribe to state changes for reactive updates
    const unsubscribe = this.controller.subscribe((state) => {
      this.header.updateView();
      this.stats.updateStats(state.stats);
      this.grid.updateWorks(state.filteredWorks);
    });

    // Handle closing via ESC
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
    };
    window.addEventListener('keydown', escHandler);

    // Cleanup subscription on close
    this.onCloseCleanup = () => {
      unsubscribe();
      window.removeEventListener('keydown', escHandler);
    };

    requestAnimationFrame(() => {
      this.overlay?.classList.add('astra-modal-overlay--open');
    });
  }

  private onCloseCleanup: (() => void) | null = null;

  /**
   * Closes the dashboard modal.
   */
  public close(): void {
    if (!this.overlay) return;

    this.overlay.classList.add('astra-modal-overlay--closing');

    if (this.onCloseCleanup) {
      this.onCloseCleanup();
      this.onCloseCleanup = null;
    }

    this.controller.close();

    setTimeout(() => {
      this.unmount();
      this.overlay?.remove();
      this.overlay = null;
      document.body.style.overflow = '';
    }, 350);
  }

  protected render(): HTMLElement {
    const container = this.createFromHTML(this.template());
    this.attachEventsInternal(container);
    return container;
  }

  protected attachEvents(): void {
    // Required by BaseComponent
  }

  protected template(): string {
    return `
      <div class="astra-modal astra-modal--dashboard astra-v2">
        <nav class="astra-modal-nav">
          <div class="astra-nav-brand">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 4L4 20H8L12 12L16 20H20L12 4Z" />
            </svg>
          </div>
          <div class="astra-nav-item active" data-tab="dashboard">
            <i class="fa fa-home"></i> <span>Dashboard</span>
          </div>
          <div class="astra-nav-item" data-tab="settings">
            <i class="fa fa-cog"></i> <span>Settings</span>
          </div>
          <div class="astra-nav-spacer"></div>
          <button class="astra-modal-close" id="astra-dashboard-close">
            <i class="fa fa-times"></i>
          </button>
        </nav>

        <div class="astra-modal-main">
           <div id="astra-header-mount"></div>
           <div id="astra-stats-mount"></div>
           <div id="astra-grid-mount" class="astra-scroll-container"></div>
        </div>
      </div>
    `;
  }

  private renderInternal(): void {
    this.header.mount(this.$('#astra-header-mount')!);
    this.stats.mount(this.$('#astra-stats-mount')!);
    this.grid.mount(this.$('#astra-grid-mount')!);

    // Initial data push to components
    const state = this.controller.getState();
    this.stats.updateStats(state.stats);
    this.grid.updateWorks(state.filteredWorks);
  }

  private attachEventsInternal(container: HTMLElement): void {
    container.querySelector('#astra-dashboard-close')?.addEventListener('click', () => this.close());

    container.addEventListener('mousedown', (e) => {
      if (e.target === container.parentElement) this.close();
    });
  }
}
