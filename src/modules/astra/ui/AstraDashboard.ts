/**
 * @file AstraDashboard.ts
 * @description Modern, reactive dashboard component for Astra.
 * Refactored to use Constructor Injection for all sub-components and secure templates.
 */

import { injectable, singleton, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraView } from './base/AstraView';
import { AstraDashboardStore } from '../store/AstraDashboardStore';
import { IDashboardState } from '../interfaces/IDashboardState';
import { AstraService } from '../AstraService';
import { AstraStatsHeader } from './components/AstraStatsHeader';
import { AstraFilterBar } from './components/AstraFilterBar';
import { AstraWorkTable } from './components/AstraWorkTable';
import { AstraSettingsView } from './components/AstraSettingsView';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { html, when } from '@core/utils/Template';

@injectable()
@singleton()
export class AstraDashboard extends AstraView {
  private overlay: HTMLElement | null = null;
  private activeTab: 'dashboard' | 'settings' = 'dashboard';
  private isOpening = false;
  private _unsubscribe: (() => void) | null = null;

  constructor(
    @inject(TOKENS.AstraStore) private store: AstraDashboardStore,
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(AstraStatsHeader) private statsHeader: AstraStatsHeader,
    @inject(AstraFilterBar) private filterBar: AstraFilterBar,
    @inject(AstraWorkTable) private workTable: AstraWorkTable,
    @inject(AstraSettingsView) private settingsView: AstraSettingsView
  ) {
    super({});
    
    // Safety: BaseComponent constructor calls render() before this.store is assigned.
    // We re-render now that dependencies are injected.
    this.element = this.render();

    // Listen for global open event
    this.eventBus.on(EVENT_TYPES.ASTRA_OPEN, () => this.open());
  }

  /**
   * Opens the dashboard overlay and initializes data.
   */
  public async open(): Promise<void> {
    console.log('[AstraDashboard] open() called');
    if (this.overlay || this.isOpening) {
      console.log('[AstraDashboard] Already open or opening, skipping');
      return;
    }
    
    this.isOpening = true;
    try {
      await this.service.init();
    
    this.overlay = document.createElement('div');
    this.overlay.className = 'astra-modal-overlay';
    const target = document.body || document.documentElement;
    if (target) {
      target.appendChild(this.overlay);
      if (document.body) document.body.style.overflow = 'hidden';
    }

    this.mount(this.overlay);

    requestAnimationFrame(() => {
      this.overlay?.classList.add('astra-modal-overlay--open');
    });
    } finally {
      this.isOpening = false;
    }
  }

  /**
   * Orchestrates mounting of the dashboard and store subscription.
   */
  public mount(parent: HTMLElement): void {
    this.parent = parent;
    this.renderContainer();
    
    // Subscribe to store updates
    this._unsubscribe = this.store.subscribe((state) => {
      this.activeTab = state.activeTab;
      this.refreshComponents(state);
    });
  }

  protected override onUnmount(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this.statsHeader.unmount();
    this.filterBar.unmount();
    this.workTable.unmount();
    this.settingsView.unmount();
    super.onUnmount();
  }

  /**
   * Closes the dashboard with a fade-out animation.
   */
  public close(): void {
    if (!this.overlay) return;
    
    this.overlay.classList.add('astra-modal-overlay--closing');
    setTimeout(() => {
      this.unmount();
      this.overlay?.remove();
      this.overlay = null;
      document.body.style.overflow = '';
    }, 350);
  }

  /**
   * Main shell template for the dashboard.
   */
  protected template(): HTMLElement {
    const tab = this.activeTab || 'dashboard';
    return html`
      <div class="astra-modal astra-modal--dashboard">
        <nav class="astra-modal-nav">
          <div class="astra-nav-brand">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 4L4 20H8L12 12L16 20H20L12 4Z" />
            </svg>
          </div>
          <div class="astra-nav-item ${when(tab === 'dashboard', 'active')}" data-tab="dashboard">
            <i class="fa-solid fa-house"></i> <span>Dashboard</span>
          </div>
          <div class="astra-nav-item ${when(tab === 'settings', 'active')}" data-tab="settings">
            <i class="fa-solid fa-gear"></i> <span>Settings</span>
          </div>
          <div class="astra-nav-spacer"></div>
          <button class="astra-modal-close"><i class="fa-solid fa-xmark"></i></button>
        </nav>
 
        <div class="astra-modal-main">
          <div id="astra-dashboard-content">
             <!-- Sub-components will be mounted here -->
          </div>
        </div>
      </div>
    `;
  }

  private renderContainer(): void {
    if (!this.overlay) return;
    
    const root = this.template();
    this.element = root;
    this.overlay.innerHTML = '';
    this.overlay.appendChild(this.element);
    
    this.bindEvents();
    this.onMount();
  }

  /**
   * Renders the active tab content.
   */
  protected onMount(): void {
    const content = this.$('#astra-dashboard-content');
    if (!content) return;

    // Unmount previous components before switching tabs
    this.statsHeader.unmount();
    this.filterBar.unmount();
    this.workTable.unmount();
    this.settingsView.unmount();

    if (this.activeTab === 'dashboard') {
      const layout = document.createElement('div');
      layout.className = 'astra-dashboard-layout';
      layout.innerHTML = `
        <div id="astra-stats-mount"></div>
        <div id="astra-filters-mount"></div>
        <div id="astra-table-mount"></div>
      `;
      content.appendChild(layout);
      
      const state = this.store.getState();
      this.statsHeader.mount(this.$('#astra-stats-mount')!, state.stats);
      this.filterBar.mount(this.$('#astra-filters-mount')!, state);
      this.workTable.mount(this.$('#astra-table-mount')!, state);
    } else {
      this.settingsView.mount(content);
    }
  }

  /**
   * Refreshes sub-components when store state changes.
   */
  private refreshComponents(state: IDashboardState): void {
    if (this.activeTab === 'dashboard') {
      this.statsHeader.update(state.stats);
      this.filterBar.update(state);
      this.workTable.update(state);
    } else {
      this.renderContainer();
    }
  }

  /**
   * Binds navigation and modal events.
   */
  protected bindEvents(): void {
    this.$$('.astra-nav-item').forEach(item => {
      this.addEventListener(item, 'click', () => {
        const tab = (item as HTMLElement).dataset.tab as any;
        if (tab && tab !== this.activeTab) {
          this.store.setTab(tab);
        }
      });
    });

    const closeBtn = this.$('.astra-modal-close');
    if (closeBtn) {
      this.addEventListener(closeBtn, 'click', () => this.close());
    }
    
    if (this.overlay) {
      this.addEventListener(this.overlay, 'mousedown', (e) => {
        if (e.target === this.overlay) this.close();
      });
    }
  }
}
