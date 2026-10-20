/**
 * @file SettingsPanel.ts
 * @description Modal settings panel for calendar preferences and authentication
 */

import { injectable, inject } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { CalendarStore } from '../CalendarStore';
import { TOKENS } from '@core/di/tokens';
import { logger } from '@core/logger';
import { html, map, when } from '@core/utils/Template';
import type { CalendarPreferences } from '@core/types';
import { calendarPreferenceChange } from '../CalendarPreferences';

interface SettingsPanelProps {
  onClose: () => void;
}

@injectable()
export class SettingsPanel extends BaseComponent<SettingsPanelProps> {
  private viewVersion = 0;
  private writeVersion = 0;
  private activeWrites = 0;
  private saveFailed = false;
  private resetPending = false;
  private lastWrites = new Map<keyof CalendarPreferences, number>();
  private previousOverflow: string | null = null;
  private activeTab: string = 'layout';

  constructor(
    @inject('SettingsPanelProps') props: SettingsPanelProps,
    @inject(TOKENS.CalendarStore) private store: CalendarStore
  ) {
    super(props);
    // Re-render now that this.store is assigned (BaseComponent constructor calls render BEFORE this assignment)
    this.element = this.render();
  }

  protected render(): HTMLElement {
    if (!this.store) return this.createElement('div', { class: 'settings-panel-loading' });
    
    if (!this.activeTab) this.activeTab = 'layout';
    const prefs = this.store.getState().preferences;

    return html`
      <div class="settings-overlay">
        <div class="settings-panel">
          ${this.renderHeader()}
          ${this.renderTabsNav()}
          <div class="settings-panel__content">
            <p class="settings-panel__error" role="alert" hidden></p>
            ${this.renderLayoutTab(prefs)}
            ${this.renderDisplayTab(prefs)}
            ${this.renderWeekTab(prefs)}
            ${this.renderSocialTab(prefs)}
            ${this.renderSystemTab(prefs)}
          </div>
        </div>
      </div>
    `;
  }

  private renderHeader(): HTMLElement {
    return html`
      <div class="settings-panel__header">
        <h2>Calendar Settings</h2>
        <button class="settings-panel__close" aria-label="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;
  }

  private renderTabsNav(): HTMLElement {
    const tabs = [
      { id: 'layout', label: 'Layout' },
      { id: 'display', label: 'Display' },
      { id: 'week', label: 'Week' },
      { id: 'social', label: 'Social' },
      { id: 'system', label: 'System' }
    ];

    return html`
      <div class="settings-panel__tabs">
        ${map(tabs, tab => html`
          <button 
            class="settings-tab ${this.activeTab === tab.id ? 'settings-tab--active' : ''}" 
            data-tab="${tab.id}"
          >
            ${tab.label}
          </button>
        `)}
      </div>
    `;
  }

  private renderLayoutTab(prefs: CalendarPreferences): HTMLElement {
    return html`
      <div 
        class="settings-tab-content ${this.activeTab === 'layout' ? 'settings-tab-content--active' : ''}" 
        data-tab-content="layout"
      >
        <div class="settings-field">
          <label class="settings-field__label">Layout Mode</label>
          <select class="settings-field__select" data-setting="layoutMode">
            <option value="standard" ${when(prefs.layoutMode === 'standard', 'selected')}>Standard</option>
            <option value="compact" ${when(prefs.layoutMode === 'compact', 'selected')}>Compact</option>
            <option value="extended" ${when(prefs.layoutMode === 'extended', 'selected')}>Extended</option>
          </select>
        </div>
        <div class="settings-field">
          <label class="settings-field__label">Title Alignment</label>
          <select class="settings-field__select" data-setting="titleAlignment">
            <option value="left" ${when(prefs.titleAlignment === 'left', 'selected')}>Left</option>
            <option value="center" ${when(prefs.titleAlignment === 'center', 'selected')}>Center</option>
          </select>
        </div>
        <div class="settings-field">
          <label class="settings-field__label">Column Justify</label>
          <select class="settings-field__select" data-setting="columnJustify">
            <option value="top" ${when(prefs.columnJustify === 'top', 'selected')}>Top</option>
            <option value="center" ${when(prefs.columnJustify === 'center', 'selected')}>Center</option>
          </select>
        </div>
      </div>
    `;
  }

  private renderDisplayTab(prefs: CalendarPreferences): HTMLElement {
    return html`
      <div 
        class="settings-tab-content ${this.activeTab === 'display' ? 'settings-tab-content--active' : ''}" 
        data-tab-content="display"
      >
        <div class="settings-field settings-field--toggle">
          <label class="settings-field__label">
            <input type="checkbox" data-setting="showTime" ${when(prefs.showTime, 'checked')}>
            <span>Show Time</span>
          </label>
        </div>
        <div class="settings-field settings-field--toggle">
          <label class="settings-field__label">
            <input type="checkbox" data-setting="showEpisodeNumbers" ${when(prefs.showEpisodeNumbers, 'checked')}>
            <span>Show Episode Numbers</span>
          </label>
        </div>
        <div class="settings-field settings-field--toggle">
          <label class="settings-field__label">
            <input type="checkbox" data-setting="hideEmptyDays" ${when(prefs.hideEmptyDays, 'checked')}>
            <span>Hide Empty Days</span>
          </label>
        </div>
        <div class="settings-field settings-field--toggle">
          <label class="settings-field__label">
            <input type="checkbox" data-setting="fullWidthImages" ${when(prefs.fullWidthImages, 'checked')}>
            <span>Full Width Images</span>
          </label>
        </div>
        <div class="settings-field settings-field--toggle">
          <label class="settings-field__label">
            <input type="checkbox" data-setting="openInNewTab" ${when(prefs.openInNewTab, 'checked')}>
            <span>Open in New Tab</span>
          </label>
          <span class="settings-field__hint">Open anime details in a new tab instead of the current one.</span>
        </div>
        <div class="settings-field" id="time-format-field" style="display: ${when(prefs.showTime, 'block', 'none')}">
          <label class="settings-field__label">Time Display Format</label>
          <select class="settings-field__select" data-setting="timeFormat">
            <option value="release" ${when(prefs.timeFormat === 'release', 'selected')}>Release Time (e.g. 16:00)</option>
            <option value="countdown" ${when(prefs.timeFormat === 'countdown', 'selected')}>Countdown (e.g. 2h 30m)</option>
          </select>
        </div>
      </div>
    `;
  }

  private renderWeekTab(prefs: CalendarPreferences): HTMLElement {
    return html`
      <div 
        class="settings-tab-content ${this.activeTab === 'week' ? 'settings-tab-content--active' : ''}" 
        data-tab-content="week"
      >
        <div class="settings-field">
          <label class="settings-field__label">Start Day</label>
          <select class="settings-field__select" data-setting="startDay">
            <option value="today" ${when(prefs.startDay === 'today', 'selected')}>Today</option>
            <option disabled>─────────</option>
            <option value="1" ${when(prefs.startDay === '1', 'selected')}>Monday</option>
            <option value="2" ${when(prefs.startDay === '2', 'selected')}>Tuesday</option>
            <option value="3" ${when(prefs.startDay === '3', 'selected')}>Wednesday</option>
            <option value="4" ${when(prefs.startDay === '4', 'selected')}>Thursday</option>
            <option value="5" ${when(prefs.startDay === '5', 'selected')}>Friday</option>
            <option value="6" ${when(prefs.startDay === '6', 'selected')}>Saturday</option>
            <option value="0" ${when(prefs.startDay === '0', 'selected')}>Sunday</option>
          </select>
        </div>
        <div class="settings-field">
          <label class="settings-field__label">Max Cards Per Day (Gallery)</label>
          <div class="slider-container">
            <input type="range" class="settings-field__slider" data-setting="maxCardsPerDay" id="maxCardsPerDay" value="${prefs.maxCardsPerDay}" min="0" max="${Math.max(10, prefs.maxCardsPerDay)}" step="1">
            <span class="slider-value" id="maxCardsPerDayValue">${when(prefs.maxCardsPerDay === 0, 'Unlimited', prefs.maxCardsPerDay)}</span>
          </div>
        </div>
      </div>
    `;
  }

  private renderSocialTab(prefs: CalendarPreferences): HTMLElement {
    return html`
      <div 
        class="settings-tab-content ${this.activeTab === 'social' ? 'settings-tab-content--active' : ''}" 
        data-tab-content="social"
      >
        <div class="settings-field settings-field--toggle">
          <label class="settings-field__label">
            <input type="checkbox" data-setting="socialEnabled" ${when(prefs.socialEnabled, 'checked')}>
            <span>Enable Social Features</span>
          </label>
          <span class="settings-field__hint">Show friend activity on cards and enable the social sidebar.</span>
        </div>
        <div class="settings-field settings-field--toggle" id="social-avatars-field" style="display: ${when(prefs.socialEnabled, 'block', 'none')}">
          <label class="settings-field__label">
            <input type="checkbox" data-setting="socialShowAvatars" ${when(prefs.socialShowAvatars, 'checked')}>
            <span>Show Friend Avatars</span>
          </label>
          <span class="settings-field__hint">Display your friends' profiles in circles on anime cards.</span>
        </div>
      </div>
    `;
  }

  private renderSystemTab(_prefs: CalendarPreferences): HTMLElement {
    return html`
      <div 
        class="settings-tab-content ${this.activeTab === 'system' ? 'settings-tab-content--active' : ''}" 
        data-tab-content="system"
      >
        <div class="settings-section">
          <label class="settings-field__label">Storage & Sync</label>
          <div class="settings-field">
            <button class="settings-field__button" data-action="reload">
              <i class="fa-solid fa-arrows-rotate"></i> Force Page Reload
            </button>
            <span class="settings-field__hint">Useful if changes are not reflecting due to SPA state.</span>
          </div>
        </div>

        <div class="settings-reset">
          <button class="settings-field__button settings-panel__reset-link">
            <i class="fa-solid fa-arrow-rotate-left"></i> Reset calendar settings
          </button>
          <span class="settings-field__hint">Restore the default calendar preferences.</span>
        </div>
      </div>
    `;
  }

  protected attachEvents(): void {
    // Header & Overlay events
    this.setupModalEvents();
    
    // Tab switching
    this.setupTabEvents();

    // Settings changes
    this.setupSettingEvents();
  }

  private setupModalEvents(): void {
    const closeBtn = this.element.querySelector('.settings-panel__close');
    this.addEventListener(closeBtn as HTMLElement, 'click', () => this.close());
    this.addEventListener(this.element, 'click', (e) => {
      if (e.target === this.element) this.close();
    });
    const reload = this.element.querySelector<HTMLElement>('[data-action="reload"]');
    if (reload) this.addEventListener(reload, 'click', () => {
      if (this.isCurrent(this.viewVersion)) window.location.reload();
    });
  }

  private setupTabEvents(): void {
    const tabButtons = this.element.querySelectorAll<HTMLButtonElement>('.settings-tab');
    tabButtons.forEach((button) => {
      this.addEventListener(button, 'click', () => {
        const tabName = button.getAttribute('data-tab');
        if (tabName) this.switchTab(tabName);
      });
    });
  }

  private setupSettingEvents(): void {
    // Selects and numbers
    const inputs = this.element.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]');
    inputs.forEach((input) => {
      // Ranges use input; change on release must not submit the same value again.
      if (input.type !== 'range') this.addEventListener(input, 'change', () => this.handleSettingChange(input));
    });

    // Sliders
    const sliders = this.element.querySelectorAll<HTMLInputElement>('input[type="range"][data-setting]');
    sliders.forEach((slider) => {
      this.addEventListener(slider, 'input', () => this.handleSettingChange(slider));
    });

    // Reset link
    const resetBtn = this.element.querySelector('.settings-panel__reset-link');
    if (resetBtn) {
      this.addEventListener(resetBtn as HTMLElement, 'click', () => { void this.handleReset(); });
    }
  }

  private switchTab(tabName: string): void {
    this.activeTab = tabName;
    
    // Update tab button classes
    this.element.querySelectorAll('.settings-tab').forEach(tab => {
      tab.classList.toggle('settings-tab--active', tab.getAttribute('data-tab') === tabName);
    });

    // Update tab content classes
    this.element.querySelectorAll('.settings-tab-content').forEach(content => {
      content.classList.toggle('settings-tab-content--active', content.getAttribute('data-tab-content') === tabName);
    });
  }

  private handleSettingChange(element: HTMLInputElement | HTMLSelectElement): void {
    if (!this.isCurrent(this.viewVersion) || this.resetPending) return;
    const key = element.getAttribute('data-setting');
    const value = element.type === 'checkbox' ? (element as HTMLInputElement).checked
      : element.type === 'number' || element.type === 'range' ? Number(element.value) : element.value;
    const patch = calendarPreferenceChange(key, value);
    if (!patch) return;
    if (key === 'showTime') this.toggleTimeFormatVisibility(value === true);
    if (key === 'socialEnabled') this.toggleSocialAvatarsVisibility(value === true);
    if (element.type === 'range') this.updateSlider(element as HTMLInputElement);
    void this.saveChange(patch);
  }

  private updateSlider(slider: HTMLInputElement): void {
    const value = Number(slider.value);
    const min = Number(slider.min);
    const max = Number(slider.max);
    const percentage = max > min ? ((value - min) / (max - min)) * 100 : 0;
    slider.style.setProperty('--slider-progress', `${percentage}%`);
    const valueDisplay = this.element.querySelector(`#${slider.id}Value`);
    if (valueDisplay) valueDisplay.textContent = value === 0 ? 'Unlimited' : value.toString();
  }

  private async saveChange(patch: Partial<CalendarPreferences>): Promise<void> {
    const view = this.viewVersion;
    const write = ++this.writeVersion;
    const keys = Object.keys(patch) as Array<keyof CalendarPreferences>;
    keys.forEach(key => this.lastWrites.set(key, write));
    this.beginSave();
    try {
      await this.store.savePreferences(patch);
    } catch (error) {
      if (!this.isCurrent(view)) return;
      this.saveFailed = true;
      const prefs = this.store.getState().preferences;
      for (const key of keys) {
        if (this.lastWrites.get(key) !== write) continue;
        const input = this.element.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-setting="${key}"]`);
        if (!input) continue;
        if (input.type === 'checkbox') (input as HTMLInputElement).checked = prefs[key] === true;
        else input.value = String(prefs[key]);
        if (input.type === 'range') this.updateSlider(input as HTMLInputElement);
        if (key === 'showTime') this.toggleTimeFormatVisibility(prefs.showTime);
        if (key === 'socialEnabled') this.toggleSocialAvatarsVisibility(prefs.socialEnabled);
      }
      logger.error('[CalendarSettings] Failed to save preferences', error);
    } finally {
      if (this.isCurrent(view)) this.finishSave();
    }
  }

  private async handleReset(): Promise<void> {
    const view = this.viewVersion;
    if (!this.isCurrent(view) || this.resetPending) return;
    this.resetPending = true;
    this.setResetDisabled(true);
    this.beginSave();
    try {
      await this.store.resetPreferences();
      if (!this.isCurrent(view)) return;
      this.rerender();
    } catch (error) {
      if (!this.isCurrent(view)) return;
      this.saveFailed = true;
      logger.error('[CalendarSettings] Failed to reset preferences', error);
    } finally {
      if (this.isCurrent(view)) {
        this.resetPending = false;
        this.setResetDisabled(false);
        this.finishSave();
      }
    }
  }

  private setResetDisabled(disabled: boolean): void {
    this.element.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('[data-setting], .settings-panel__reset-link')
      .forEach(control => { control.disabled = disabled; });
  }

  private isCurrent(view: number): boolean {
    return this.mounted && this.element.isConnected && view === this.viewVersion;
  }

  private beginSave(): void {
    if (this.activeWrites === 0) this.saveFailed = false;
    this.activeWrites++;
    this.setFeedback('');
  }

  private finishSave(): void {
    this.activeWrites--;
    if (this.activeWrites === 0) {
      if (this.saveFailed) this.setFeedback('Changes could not be saved. Try again.');
      else this.setFeedback('');
    }
  }

  private setFeedback(message: string): void {
    const indicator = this.element.querySelector<HTMLElement>('.settings-panel__error');
    if (!indicator) return;
    indicator.textContent = message;
    indicator.hidden = !message;
  }

  private toggleTimeFormatVisibility(showTime: boolean): void {
    const el = this.element.querySelector('#time-format-field') as HTMLElement;
    if (el) el.style.display = showTime ? 'block' : 'none';
  }

  private toggleSocialAvatarsVisibility(socialEnabled: boolean): void {
    const el = this.element.querySelector('#social-avatars-field') as HTMLElement;
    if (el) el.style.display = socialEnabled ? 'block' : 'none';
  }

  private close(): void {
    if (!this.mounted) return;
    this.unmount();
    this.props.onClose();
  }

  protected onMount(): void {
    this.viewVersion++;
    this.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this.addEventListener(document, 'keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') this.close();
    });

    // Remounting the same instance must not retain unsaved controls from an earlier view.
    const prefs = this.store.getState().preferences;
    this.element.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]').forEach(input => {
      const key = input.dataset.setting as keyof CalendarPreferences;
      if (!Object.prototype.hasOwnProperty.call(prefs, key)) return;
      if (input.type === 'checkbox') (input as HTMLInputElement).checked = prefs[key] === true;
      else {
        if (input.type === 'range' && typeof prefs[key] === 'number') (input as HTMLInputElement).max = String(Math.max(10, prefs[key]));
        input.value = String(prefs[key]);
      }
      if (input.type === 'range') this.updateSlider(input as HTMLInputElement);
    });
    this.toggleTimeFormatVisibility(prefs.showTime);
    this.toggleSocialAvatarsVisibility(prefs.socialEnabled);
  }

  protected onUnmount(): void {
    this.viewVersion++;
    this.activeWrites = 0;
    this.saveFailed = false;
    this.resetPending = false;
    this.lastWrites.clear();
    this.setResetDisabled(false);
    this.setFeedback('');
    if (this.previousOverflow !== null && document.body.style.overflow === 'hidden') document.body.style.overflow = this.previousOverflow;
    this.previousOverflow = null;
  }
}
