/**
 * @file AstraDashboard.ts
 * @description Modern, reactive dashboard component for Astra.
 * Refactored to use Constructor Injection for all sub-components and secure templates.
 */

import { injectable, singleton, inject, type Disposable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { AstraView } from './base/AstraView';
import { AstraDashboardStore } from '../store/AstraDashboardStore';
import { IDashboardState } from '../interfaces/IDashboardState';
import { AstraService } from '../AstraService';
import { AstraFilterBar } from './components/AstraFilterBar';
import { AstraWorkTable } from './components/AstraWorkTable';
import { AstraSettingsView } from './components/AstraSettingsView';
import { AstraOverlayService } from '../services/AstraOverlayService';
import type { IEventBus, EventSubscription } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { html, when } from '@core/utils/Template';
import { logger } from '@core/logger';
import { AstraWrappedView } from './AstraWrappedView';
import { SeasonalWrappedService } from '../services/SeasonalWrappedService';
import { YearReviewService } from '../services/year/YearReviewService';
import { SeasonalWrappedView } from './SeasonalWrappedView';
import { latestReleasedSeason, seasonLabel, type SeasonalPeriod } from '../services/SeasonalWrappedModel';
import { paintWrappedHub, wrappedHub } from './wrapped/WrappedHub';

@injectable()
@singleton()
export class AstraDashboard extends AstraView implements Disposable {
  private overlay: HTMLElement | null = null;
  private activeTab: 'dashboard' | 'settings' = 'dashboard';
  private isOpening = false;
  private closing = false;
  private active = false;
  private disposed = false;
  private lifecycleVersion = 0;
  private openVersion = 0;
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeStore: (() => void) | undefined;
  private openSubscription: EventSubscription | undefined;
  private authSubscription: EventSubscription | undefined;
  private dashboardHasEntries = false;
  private dashboardLayout: 'table' | 'list' | 'grid' = 'table';
  private wrappedView: AstraWrappedView | null = null;
  private showWrapped = false;
  private showRecaps = false;
  private seasonalView: SeasonalWrappedView | null = null;
  private showSeasonal = false;
  private seasonalInitialPeriod: SeasonalPeriod | null = null;
  private pendingSeasonalRelease: SeasonalPeriod | null = null;
  private userInteractedDuringOpen = false;

  constructor(
    @inject(TOKENS.AstraStore) private store: AstraDashboardStore,
    @inject(TOKENS.AstraService) private service: AstraService,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(AstraFilterBar) private filterBar: AstraFilterBar,
    @inject(AstraWorkTable) private workTable: AstraWorkTable,
    @inject(AstraSettingsView) private settingsView: AstraSettingsView,
    @inject(AstraOverlayService) private overlayService: AstraOverlayService,
    @inject(SeasonalWrappedService) private seasonalService?: SeasonalWrappedService,
    @inject(YearReviewService) private yearService?: YearReviewService
  ) {
    super({});

    // Safety: BaseComponent constructor calls render() before this.store is assigned.
    // We re-render now that dependencies are injected.
    this.element = this.render();

    this.activate();
  }

  /** Feature lifecycle is reusable; the document owner alone permanently disposes it. */
  public activate(): void {
    if (this.disposed || this.active) return;
    this.active = true;
    const version = ++this.lifecycleVersion;
    const isCurrent = () => this.active && !this.disposed && version === this.lifecycleVersion;
    this.openSubscription = this.eventBus.on(EVENT_TYPES.ASTRA_OPEN, (payload) => {
      if (isCurrent())
        return this.open(payload).catch(() => {
          if (isCurrent()) logger.error('[AstraDashboard] Open failed');
        });
      return undefined;
    });
    this.authSubscription = this.eventBus.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      if (isCurrent()) this.clearView();
    });
    const unsubscribe = this.store.subscribe((state) => {
      if (!isCurrent()) return;
      const tabChanged = this.activeTab !== state.activeTab;
      const hasEntries = state.stats.totalCount > 0;
      const entryStateChanged = this.dashboardHasEntries !== hasEntries;
      const layoutChanged = this.dashboardLayout !== state.layout;
      this.activeTab = state.activeTab;
      this.dashboardHasEntries = hasEntries;
      this.dashboardLayout = state.layout;
      if (this.mounted) {
        if (tabChanged || (this.activeTab === 'dashboard' && (entryStateChanged || layoutChanged)))
          this.rerender();
        else this.refreshComponents(state);
      }
    });
    if (isCurrent()) this.unsubscribeStore = unsubscribe;
    else unsubscribe?.();
  }

  /** Start loading Airing while Astra initializes, before the user opens the dashboard. */
  public preloadAiringData(): void {
    if (!this.active || this.disposed || document.visibilityState === 'hidden') return;
    void this.workTable.prepareAiringData().catch((error) => {
      logger.warn('[AstraDashboard] Airing preload failed', error);
    });
  }

  public deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycleVersion++;
    this.openSubscription?.unsubscribe();
    this.openSubscription = undefined;
    this.authSubscription?.unsubscribe();
    this.authSubscription = undefined;
    this.unsubscribeStore?.();
    this.unsubscribeStore = undefined;
    this.clearView();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.deactivate();
    this.disposed = true;
  }

  private cancelOpen(): void {
    this.openVersion++;
    this.isOpening = false;
    this.workTable.cancelAiringDataRequest?.();
    if (this.focusTimer !== null) clearTimeout(this.focusTimer);
    this.focusTimer = null;
  }

  private async refreshSeasonalRelease(version: number, overlay: HTMLElement): Promise<void> {
    if (!this.seasonalService) return;
    try {
      const period = await this.seasonalService.getPendingRelease();
      if (version !== this.openVersion || !this.active || this.disposed || this.closing
        || this.overlay !== overlay || !overlay.isConnected) return;
      const changed = this.pendingSeasonalRelease?.year !== period?.year
        || this.pendingSeasonalRelease?.season !== period?.season;
      this.pendingSeasonalRelease = period;
      const canRefresh = (this.showRecaps && !this.showSeasonal && !this.showWrapped)
        || (!this.userInteractedDuringOpen && this.activeTab === 'dashboard' && !this.showWrapped && !this.showSeasonal);
      if (changed && canRefresh) this.rerender();
    } catch (error) {
      logger.warn('[AstraDashboard] Could not check for a Seasonal Wrapped announcement', error);
    }
  }

  private clearView(): void {
    this.cancelOpen();
    this.showWrapped = false;
    this.showRecaps = false;
    this.showSeasonal = false;
    this.seasonalInitialPeriod = null;
    this.pendingSeasonalRelease = null;
    super.unmount();
    if (this.overlay) this.overlayService.remove('dashboard');
    this.overlay = null;
    this.closing = false;
  }

  /**
   * Opens the dashboard overlay and initializes data.
   *
   * @param payload Optional payload containing a mediaId to focus after loading.
   * @returns A promise that resolves when the dashboard open operation has initialized.
   */
  public async open(payload?: { mediaId?: number }): Promise<void> {
    if (
      this.disposed ||
      !this.active ||
      this.isOpening ||
      (this.overlayService.isActive('dashboard') && !this.closing)
    )
      return;
    if (this.closing) this.clearView();
    const version = ++this.openVersion;
    this.isOpening = true;
    this.userInteractedDuringOpen = false;
    const mediaId = payload?.mediaId;
    try {
      this.store.setTab('dashboard');
      if (version !== this.openVersion || !this.active || this.disposed) return;
      await Promise.all([this.service.init(), this.workTable.prepareAiringData()]);
      if (version !== this.openVersion || !this.active || this.disposed) return;
      const overlay = this.overlayService.create('dashboard');
      this.overlay = overlay;
      this.mount(overlay);
      this.overlayService.show('dashboard');
      if (mediaId === undefined) void this.refreshSeasonalRelease(version, overlay);
      if (
        typeof mediaId === 'number' &&
        Number.isInteger(mediaId) &&
        mediaId > 0 &&
        mediaId <= 2147483647
      ) {
        const root = this.element;
        const timer = setTimeout(() => {
          if (
            this.focusTimer !== timer ||
            version !== this.openVersion ||
            !this.active ||
            this.disposed ||
            !this.mounted ||
            this.element !== root ||
            this.overlay !== overlay ||
            !overlay.isConnected
          )
            return;
          this.focusTimer = null;
          this.workTable.focusEntry(mediaId);
        }, 500);
        this.focusTimer = timer;
      }
    } finally {
      if (version === this.openVersion) this.isOpening = false;
    }
  }

  /**
   * Mounts the dashboard component to the parent element.
   *
   * @param parent The parent container element.
   */
  public mount(parent: HTMLElement): void {
    if (!this.active || this.disposed || this.mounted) return;
    super.mount(parent);
  }

  public override unmount(): void {
    this.cancelOpen();
    super.unmount();
  }

  protected override onUnmount(): void {
    this.seasonalView?.unmount(); this.seasonalView = null;
    this.wrappedView?.unmount();
    this.wrappedView = null;
    this.filterBar.unmount();
    this.workTable.unmount();
    this.settingsView.unmount();
    super.onUnmount();
  }

  /**
   * Closes the dashboard overlay view with a fade-out animation.
   */
  public close(): void {
    this.cancelOpen();
    this.wrappedView?.unmount();
    this.showWrapped = false;
    this.showRecaps = false;
    this.seasonalView?.unmount(); this.showSeasonal = false;
    const overlay = this.overlay;
    if (!overlay) {
      super.unmount();
      return;
    }
    if (this.closing) return;
    this.closing = true;
    this.overlayService.hide('dashboard', () => {
      if (this.overlay !== overlay || !this.closing) return;
      super.unmount();
      this.overlay = null;
      this.closing = false;
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
              <path d="M12 12L10.7 15.5H13.3L12 12Z" />
            </svg>
          </div>
          <div class="astra-nav-item ${when(tab === 'dashboard' && !this.showRecaps && !this.showWrapped && !this.showSeasonal, 'active')}" data-tab="dashboard">
            <i class="fa-solid fa-house"></i> <span>Dashboard</span>
          </div>
          <div class="astra-nav-item ${when(this.showRecaps || this.showWrapped || this.showSeasonal, 'active')}" data-tab="recaps" role="button" tabindex="0" aria-label="Wrapped recaps">
            <i class="fa-solid fa-chart-line"></i> <span>Wrapped</span>
            ${when(this.pendingSeasonalRelease, html`<b class="astra-nav-new">New</b>`)}
          </div>
          <div class="astra-nav-item ${when(tab === 'settings' && !this.showRecaps && !this.showWrapped && !this.showSeasonal, 'active')}" data-tab="settings">
            <i class="fa-solid fa-gear"></i> <span>Settings</span>
          </div>
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
    this.filterBar.unmount();
    this.workTable.unmount();
    this.settingsView.unmount();

    this.addEventListener(content, 'pointerdown', () => { this.userInteractedDuringOpen = true; }, true);
    this.addEventListener(content, 'keydown', () => { this.userInteractedDuringOpen = true; }, true);

    if (this.activeTab === 'dashboard' && this.showRecaps && !this.showSeasonal && !this.showWrapped) {
      this.mountRecaps(content);
      return;
    }

    if (this.activeTab === 'dashboard' && this.showSeasonal) {
      const initialPeriod = this.seasonalInitialPeriod ?? undefined;
      this.seasonalInitialPeriod = null;
      this.seasonalView = new SeasonalWrappedView(this.seasonalService, () => {
        this.showSeasonal = false;
        this.showRecaps = true;
        this.rerender();
        this.$<HTMLElement>('[data-open-seasonal]')?.focus();
        if (this.overlay) void this.refreshSeasonalRelease(this.openVersion, this.overlay);
      }, initialPeriod);
      this.seasonalView.mount(content); return;
    }
    if (this.activeTab === 'dashboard' && this.showWrapped) {
      this.wrappedView = new AstraWrappedView(this.yearService, () => {
        this.showWrapped = false;
        this.showRecaps = true;
        this.rerender();
        this.$<HTMLElement>('[data-open-astra-wrapped]')?.focus();
      });
      this.wrappedView.mount(content);
      return;
    }

    if (this.activeTab === 'dashboard') {
      const state = this.store.getState();
      const hasEntries = state.stats.totalCount > 0;
      const activeLayout = state.layout;
      const headerActionsHtml = hasEntries
        ? `
          <div class="astra-dashboard-shell-actions">
            <button
              type="button"
              class="astra-dashboard-action astra-dashboard-action--icon ${state.showProgress ? 'active' : ''}"
              id="astra-dashboard-progress"
              title="Progress fill"
              aria-label="Progress fill"
            >
              <i class="fa-solid fa-bars-progress"></i>
            </button>
            <span class="astra-dashboard-action-separator"></span>
            <div class="astra-dashboard-layout-toggle" aria-label="Dashboard layout">
              <button
                type="button"
                class="astra-dashboard-layout-btn ${activeLayout === 'table' ? 'active' : ''}"
                data-layout="table"
                title="Table view"
                aria-label="Table view"
              >
                <i class="fa-solid fa-table-list"></i>
              </button>
              <button
                type="button"
                class="astra-dashboard-layout-btn ${activeLayout === 'list' ? 'active' : ''}"
                data-layout="list"
                title="List view"
                aria-label="List view"
              >
                <i class="fa-solid fa-list"></i>
              </button>
              <button
                type="button"
                class="astra-dashboard-layout-btn ${activeLayout === 'grid' ? 'active' : ''}"
                data-layout="grid"
                title="Grid view"
                aria-label="Grid view"
              >
                <i class="fa-solid fa-border-all"></i>
              </button>
            </div>
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
        ${this.pendingSeasonalRelease ? `
          <section class="astra-seasonal-release" aria-label="Seasonal Wrapped ready">
            <div><strong>${seasonLabel(this.pendingSeasonalRelease)} Wrapped is ready</strong><span>Your seasonal recap is ready when you are.</span></div>
            <button type="button" class="astra-btn astra-btn--secondary" data-open-released-seasonal>Open recap</button>
          </section>
        ` : ''}
        <div id="astra-filters-mount"></div>
        <div id="astra-table-mount"></div>
      `;
      content.appendChild(layout);

      this.filterBar.mount(this.$('#astra-filters-mount')!, state);
      const tableMount = this.$('#astra-table-mount')!;
      tableMount.classList.toggle('astra-show-progress', state.showProgress);
      this.workTable.mount(tableMount, state);
      this.bindDashboardHeaderEvents(layout);
    } else {
      this.settingsView.mount(content);
    }
  }

  /**
   * Refreshes sub-components when store state changes (data-only).
   */
  private refreshComponents(state: IDashboardState): void {
    if (this.activeTab === 'dashboard' && !this.showRecaps && !this.showWrapped && !this.showSeasonal) {
      this.filterBar.update(state);
      this.workTable.update(state);
    }
  }

  private mountRecaps(content: HTMLElement): void {
    const released = this.pendingSeasonalRelease ?? latestReleasedSeason();
    const layout = wrappedHub({ year: new Date().getFullYear(), season: released, seasonReady: !!this.pendingSeasonalRelease });
    content.append(layout);
    paintWrappedHub(layout);
    const yearly = layout.querySelector<HTMLButtonElement>('[data-open-astra-wrapped]');
    if (yearly) this.addEventListener(yearly, 'click', () => {
      if (!this.active || this.disposed || !this.mounted || !layout.isConnected) return;
      this.showRecaps = false;
      this.showWrapped = true;
      this.rerender();
      this.$<HTMLElement>('[data-wrapped-back]')?.focus();
    });
    const seasonal = layout.querySelector<HTMLButtonElement>('[data-open-seasonal]');
    if (seasonal) this.addEventListener(seasonal, 'click', () => {
      if (!this.active || this.disposed || !this.mounted || !layout.isConnected) return;
      this.openSeasonal(this.pendingSeasonalRelease ?? undefined);
    });
  }

  private openSeasonal(period?: SeasonalPeriod): void {
    this.showRecaps = true;
    this.showSeasonal = true;
    this.seasonalInitialPeriod = period ? { ...period } : null;
    this.rerender();
    this.$<HTMLElement>('[data-seasonal-back]')?.focus();
  }

  private bindDashboardHeaderEvents(layout: HTMLElement): void {
    const isCurrent = () =>
      this.active && !this.disposed && this.mounted && this.$('.astra-dashboard-layout') === layout;
    const progress = layout.querySelector('#astra-dashboard-progress');
    const releasedSeasonal = layout.querySelector<HTMLButtonElement>('[data-open-released-seasonal]');
    if (releasedSeasonal) this.addEventListener(releasedSeasonal, 'click', () => {
      if (!isCurrent() || !this.pendingSeasonalRelease) return;
      this.openSeasonal(this.pendingSeasonalRelease);
    });
    if (progress)
      this.addEventListener(progress, 'click', (event) => {
        if (!isCurrent()) return;
        const button = event.currentTarget as HTMLButtonElement;
        const next = !this.store.getState().showProgress;
        this.store.setShowProgress(next);
        button.classList.toggle('active', next);
        layout.querySelector('#astra-table-mount')?.classList.toggle('astra-show-progress', next);
      });

    layout.querySelectorAll<HTMLElement>('[data-layout]').forEach((button) => {
      this.addEventListener(button, 'click', () => {
        if (!isCurrent()) return;
        const nextLayout = button.dataset.layout as 'table' | 'list' | 'grid' | undefined;
        if (nextLayout) {
          this.store.setLayout(nextLayout);
        }
      });
    });
  }

  /**
   * Binds navigation and modal events.
   */
  protected bindEvents(): void {
    const root = this.element;
    const isCurrent = () => this.active && !this.disposed && this.mounted && this.element === root;
    this.$$('.astra-nav-item').forEach((item) => {
      this.addEventListener(item, 'click', () => {
        if (!isCurrent()) return;
        this.userInteractedDuringOpen = true;
        const tab = item.dataset.tab;
        if (tab === 'recaps') {
          this.showRecaps = true;
          this.showWrapped = false;
          this.showSeasonal = false;
          if (this.activeTab === 'dashboard') this.rerender();
          else this.store.setTab('dashboard');
          return;
        }
        if (tab === 'dashboard' || tab === 'settings') {
          this.showRecaps = false;
          this.showWrapped = false;
          this.showSeasonal = false;
          if (tab === this.activeTab) this.rerender();
          else this.store.setTab(tab);
        }
      });
    });
    const recaps = this.$<HTMLElement>('[data-tab="recaps"]');
    if (recaps) this.addEventListener(recaps, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.key !== 'Enter' && key.key !== ' ') return;
      key.preventDefault();
      recaps.click();
    });

    if (this.overlay) {
      this.addEventListener(this.overlay, 'mousedown', (e) => {
        if (isCurrent() && e.target === this.overlay) this.close();
      });
    }

    // Escape dismisses like a backdrop click. Nested panels and other Astra overlays own the key while open.
    // Registered through addEventListener, so unmounting after close removes it.
    this.addEventListener(document, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.key !== 'Escape' || this.closing || !isCurrent()) return;
      if (this.showWrapped || this.showRecaps || this.showSeasonal) return;
      if ([...document.querySelectorAll('.astra-modal-overlay')].some(element => element !== this.overlay)) return;
      this.close();
    });
  }
}
