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
import { AstraOverlayService } from '../services/AstraOverlayService';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { html, when } from '@core/utils/Template';
import { log } from '@core/logger';

@injectable()
@singleton()
export class AstraDashboard extends AstraView {
  private overlay: HTMLElement | null = null;
  private activeTab: 'dashboard' | 'settings' = 'dashboard';
  private isOpening = false;
  private dashboardHasEntries = false;

  constructor(
    @inject(TOKENS.AstraStore) private store: AstraDashboardStore,
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(AstraStatsHeader) private statsHeader: AstraStatsHeader,
    @inject(AstraFilterBar) private filterBar: AstraFilterBar,
    @inject(AstraWorkTable) private workTable: AstraWorkTable,
    @inject(AstraSettingsView) private settingsView: AstraSettingsView,
    @inject(AstraOverlayService) private overlayService: AstraOverlayService
  ) {
    super({});
    
    // Safety: BaseComponent constructor calls render() before this.store is assigned.
    // We re-render now that dependencies are injected.
    this.element = this.render();

    // Listen for global open event
    this.eventBus.on(EVENT_TYPES.ASTRA_OPEN, (payload) => this.open(payload));

    // Persistent subscription: survives rerenders and open/close cycles
    this.store.subscribe((state) => {
      const tabChanged = this.activeTab !== state.activeTab;
      const hasEntries = state.stats.totalCount > 0;
      const entryStateChanged = this.dashboardHasEntries !== hasEntries;

      this.activeTab = state.activeTab;
      this.dashboardHasEntries = hasEntries;

      if (this.mounted) {
        if (tabChanged || (this.activeTab === 'dashboard' && entryStateChanged)) {
          log.info(`[AstraDashboard] Tab changed to ${this.activeTab}, rerendering...`);
          this.rerender();
        } else {
          this.refreshComponents(state);
        }
      }
    });
  }

  /**
   * Opens the dashboard overlay and initializes data.
   */
  public async open(payload?: { mediaId?: number }): Promise<void> {
    log.info('[AstraDashboard] open() called', payload);
    if (this.overlayService.isActive('dashboard') || this.isOpening) {
      return;
    }
    
    this.isOpening = true;
    try {
      await this.service.init();
    
      this.overlay = this.overlayService.create('dashboard');
      this.mount(this.overlay);
      this.overlayService.show('dashboard');

      // If a mediaId was provided, focus it after a short delay to allow rendering
      if (payload?.mediaId) {
        setTimeout(() => this.workTable.focusEntry(payload.mediaId!), 500);
      }
    } finally {
      this.isOpening = false;
    }
  }

  public mount(parent: HTMLElement): void {
    super.mount(parent);
  }

  protected override onUnmount(): void {
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
    this.overlayService.hide('dashboard', () => {
      this.unmount();
      this.overlay = null;
    });
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
      const state = this.store.getState();
      const hasEntries = state.stats.totalCount > 0;
      const headerActionsHtml = hasEntries
        ? `
          <div class="astra-dashboard-shell-actions">
            <button type="button" class="astra-dashboard-action astra-dashboard-action--primary" id="astra-dashboard-sync">
              <i class="fa-solid fa-rotate"></i>
              <span>Sync</span>
            </button>
            <span class="astra-dashboard-action-separator"></span>
            <button type="button" class="astra-dashboard-action" id="astra-dashboard-stats">
              <i class="fa-solid fa-chart-line"></i>
              <span>Stats</span>
            </button>
            <button type="button" class="astra-dashboard-action" id="astra-dashboard-table-view" title="Table view">
              <i class="fa-solid fa-list"></i>
            </button>
            <span class="astra-dashboard-action-separator"></span>
            <button type="button" class="astra-dashboard-action" id="astra-dashboard-export-wrapped">
              <i class="fa-solid fa-image"></i>
              <span>Export Wrapped</span>
            </button>
          </div>
        `
        : '';

      const layout = document.createElement('div');
      layout.className = 'astra-dashboard-layout';
      layout.innerHTML = `
        <header class="astra-dashboard-shell-header">
          <h2>Astra Dashboard</h2>
          ${headerActionsHtml}
        </header>
        <div id="astra-filters-mount"></div>
        <div id="astra-table-mount"></div>
      `;
      content.appendChild(layout);

      this.filterBar.mount(this.$('#astra-filters-mount')!, state);
      this.workTable.mount(this.$('#astra-table-mount')!, state);
      this.bindDashboardHeaderEvents(layout);
    } else {
      this.settingsView.mount(content);
    }
  }

  /**
   * Refreshes sub-components when store state changes (data-only).
   */
  private refreshComponents(state: IDashboardState): void {
    if (this.activeTab === 'dashboard') {
      this.filterBar.update(state);
      this.workTable.update(state);
    }
  }

  private bindDashboardHeaderEvents(layout: HTMLElement): void {
    layout.querySelector('#astra-dashboard-sync')?.addEventListener('click', async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i><span>Syncing</span>';
      try {
        await this.service.syncWithAniList();
      } catch (error) {
        log.error('[AstraDashboard] Sync failed', error);
      } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fa-solid fa-rotate"></i><span>Sync</span>';
      }
    });

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
