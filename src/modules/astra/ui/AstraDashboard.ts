/**
 * @file AstraDashboard.ts
 * @description Modern, reactive dashboard component for Astra.
 */

import { injectable, singleton, inject } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraView } from './base/AstraView';
import { AstraStore, DashboardState } from '../store/AstraStore';
import { AstraService } from '../AstraService';
import { AstraStatsHeader } from './components/AstraStatsHeader';
import { AstraFilterBar } from './components/AstraFilterBar';
import { AstraWorkTable } from './components/AstraWorkTable';
import { AstraSettingsView } from './components/AstraSettingsView';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { log } from '@core/logger';

@injectable()
@singleton()
export class AstraDashboard extends AstraView {
  private overlay: HTMLElement | null = null;
  private activeTab: 'dashboard' | 'settings' = 'dashboard';
  
  // Sub-components
  private statsHeader: AstraStatsHeader;
  private filterBar: AstraFilterBar;
  private workTable: AstraWorkTable;
  private settingsView: AstraSettingsView;

  constructor(
    @inject(TOKENS.AstraStore) private store: AstraStore,
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus
  ) {
    super({});
    
    // Initialize components
    this.statsHeader = new AstraStatsHeader({});
    this.filterBar = new AstraFilterBar(this.store);
    this.workTable = new AstraWorkTable(this.store, this.service);
    this.settingsView = new AstraSettingsView(this.service);

    // Listen for global open event
    this.eventBus.on(EVENT_TYPES.ASTRA_OPEN, () => this.open());
  }

  public async open(): Promise<void> {
    if (this.overlay) return;

    log.debug('[AstraDashboard] Opening dashboard...');
    await this.service.init();
    
    this.overlay = document.createElement('div');
    this.overlay.className = 'astra-modal-overlay';
    document.body.appendChild(this.overlay);
    document.body.style.overflow = 'hidden';

    this.mount(this.overlay);

    requestAnimationFrame(() => {
      this.overlay?.classList.add('astra-modal-overlay--open');
    });
  }

  public mount(parent: HTMLElement): void {
    this.parent = parent;
    this.renderContainer();
    
    // Subscribe to store updates
    const unsubscribe = this.store.subscribe((state) => {
      this.refreshComponents(state);
    });

    this._unsubscribe = unsubscribe;
  }

  protected onUnmount(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  private _unsubscribe: (() => void) | null = null;

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

  protected template(): string {
    return `
      <div class="astra-modal astra-modal--dashboard">
        <nav class="astra-modal-nav">
          <div class="astra-nav-brand">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 4L4 20H8L12 12L16 20H20L12 4Z" />
            </svg>
          </div>
          <div class="astra-nav-item ${this.activeTab === 'dashboard' ? 'active' : ''}" data-tab="dashboard">
            <i class="fa-solid fa-house"></i> <span>Dashboard</span>
          </div>
          <div class="astra-nav-item ${this.activeTab === 'settings' ? 'active' : ''}" data-tab="settings">
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
    this.overlay.innerHTML = this.template();
    this.element = this.overlay.firstElementChild as HTMLElement;
    this.bindEvents();
    this.onMount();
  }

  protected onMount(): void {
    const content = this.$('#astra-dashboard-content');
    if (!content) return;

    if (this.activeTab === 'dashboard') {
      content.innerHTML = `
        <div class="astra-dashboard-layout">
          <div id="astra-stats-mount"></div>
          <div id="astra-filters-mount"></div>
          <div id="astra-table-mount"></div>
        </div>
      `;
      
      const state = this.store.getState();
      this.statsHeader.mount(this.$('#astra-stats-mount')!, state.stats);
      this.filterBar.mount(this.$('#astra-filters-mount')!, state);
      this.workTable.mount(this.$('#astra-table-mount')!, state);
    } else {
      this.settingsView.mount(content);
    }
  }

  private refreshComponents(state: DashboardState): void {
    if (this.activeTab === 'dashboard') {
      this.statsHeader.update(state.stats);
      this.workTable.update(state);
    }
  }

  protected bindEvents(): void {
    this.$$('.astra-nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const tab = (item as HTMLElement).dataset.tab as any;
        if (tab && tab !== this.activeTab) {
          this.activeTab = tab;
          this.renderContainer();
        }
      });
    });

    this.$('.astra-modal-close')?.addEventListener('click', () => this.close());
    
    this.overlay?.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }
}
