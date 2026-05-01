/**
 * @file SettingsPanel.ts
 * @description Modal settings panel for calendar preferences and authentication
 *
 * Provides tabbed UI for layout options (mode, time format, alignment),
 * social toggles, authentication status, and logout. Preferences are
 * persisted via CalendarStore on change.
 *
 * @see CalendarStore.ts for preference persistence
 * @see docs/MODULES.md#1-calendar-module
 */

import { injectable, inject } from 'tsyringe';
import { BaseComponent } from '@ui/components/BaseComponent';
import { calendarStore } from '../CalendarStore';
import { log } from '@core/logger';
import { TOKENS } from '@core/di/tokens';
import { html, map, when } from '@core/utils/Template';
import type { CalendarPreferences } from '@core/types';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { MSG, type AuthLoginResponse } from '@shared/messages';

interface SettingsPanelProps {
  onClose: () => void;
}

@injectable()
export class SettingsPanel extends BaseComponent<SettingsPanelProps> {
  private unsubscribe?: () => void;
  private pendingChanges: Partial<CalendarPreferences> = {};
  private activeTab: string = 'layout';

  constructor(
    @inject('SettingsPanelProps') props: SettingsPanelProps,
    @inject(TOKENS.ApiClient) private apiClient: IApiClient
  ) {
    super(props);
  }

  protected render(): HTMLElement {
    if (!this.activeTab) this.activeTab = 'layout';
    const prefs = calendarStore.getState().preferences;

    return html`
      <div class="settings-overlay">
        <div class="settings-panel">
          ${this.renderHeader()}
          ${this.renderTabsNav()}
          <div class="settings-panel__content">
            ${this.renderLayoutTab(prefs)}
            ${this.renderDisplayTab(prefs)}
            ${this.renderWeekTab(prefs)}
            ${this.renderSocialTab(prefs)}
          </div>
          ${this.renderFooter()}
        </div>
      </div>
    `;
  }

  private renderHeader(): HTMLElement {
    return html`
      <div class="settings-panel__header">
        <h2>Calendar Settings</h2>
        <button class="settings-panel__close" aria-label="Close">
          <i class="fa fa-times"></i>
        </button>
      </div>
    `;
  }

  private renderTabsNav(): HTMLElement {
    const tabs = [
      { id: 'layout', label: 'Layout' },
      { id: 'display', label: 'Display' },
      { id: 'week', label: 'Week' },
      { id: 'social', label: 'Social' }
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
            <input type="range" class="settings-field__slider" data-setting="maxCardsPerDay" id="maxCardsPerDay" value="${prefs.maxCardsPerDay}" min="0" max="10" step="1">
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


  private renderFooter(): HTMLElement {
    return html`
      <div class="settings-panel__footer">
        <button class="settings-panel__reset">Reset to Defaults</button>
        <button class="settings-panel__save">Save & Close</button>
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

    // Footer actions
    this.setupFooterEvents();
  }

  private setupModalEvents(): void {
    const closeBtn = this.element.querySelector('.settings-panel__close');
    this.addEventListener(closeBtn as HTMLElement, 'click', () => this.close());
    this.addEventListener(this.element, 'click', (e) => {
      if (e.target === this.element) this.close();
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
      this.addEventListener(input, 'change', () => this.handleSettingChange(input));
    });

    // Checkboxes (with dependent fields)
    const checkboxes = this.element.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-setting]');
    checkboxes.forEach((checkbox) => {
      this.addEventListener(checkbox, 'change', () => {
        const setting = checkbox.getAttribute('data-setting');
        if (setting === 'showTime') this.toggleTimeFormatVisibility(checkbox.checked);
        if (setting === 'socialEnabled') this.toggleSocialAvatarsVisibility(checkbox.checked);
      });
    });

    // Sliders
    const sliders = this.element.querySelectorAll<HTMLInputElement>('input[type="range"][data-setting]');
    sliders.forEach((slider) => {
      this.addEventListener(slider, 'input', () => this.handleSliderChange(slider));
    });
  }

  private setupFooterEvents(): void {
    const resetBtn = this.element.querySelector('.settings-panel__reset');
    this.addEventListener(resetBtn as HTMLElement, 'click', () => this.handleReset());

    const saveBtn = this.element.querySelector('.settings-panel__save');
    this.addEventListener(saveBtn as HTMLElement, 'click', () => this.handleSave());
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

    // Toggle footer visibility (not needed anymore without Account tab, but kept for future tabs)
    const footer = this.element.querySelector('.settings-panel__footer');
    if (footer) footer.classList.remove('settings-panel__footer--hidden');
  }

  private handleSettingChange(element: HTMLInputElement | HTMLSelectElement): void {
    const setting = element.getAttribute('data-setting') as keyof CalendarPreferences;
    let value: any;

    if (element.type === 'checkbox') {
      value = (element as HTMLInputElement).checked;
    } else if (element.type === 'number') {
      value = parseInt((element as HTMLInputElement).value, 10);
    } else {
      value = element.value;
    }

    this.pendingChanges[setting] = value;
    
    // Auto-save immediately
    calendarStore.savePreferences({ [setting]: value }).then(() => {
      window.dispatchEvent(new CustomEvent('calendar-preferences-updated'));
    });
  }

  private handleSliderChange(slider: HTMLInputElement): void {
    const setting = slider.getAttribute('data-setting') as keyof CalendarPreferences;
    const value = parseInt(slider.value, 10);
    const min = parseInt(slider.min, 10);
    const max = parseInt(slider.max, 10);

    const percentage = ((value - min) / (max - min)) * 100;
    slider.style.setProperty('--slider-progress', `${percentage}%`);

    const valueDisplay = this.element.querySelector(`#${slider.id}Value`);
    if (valueDisplay) {
      valueDisplay.textContent = value === 0 ? 'Unlimited' : value.toString();
    }

    (this.pendingChanges as any)[setting] = value;
    
    // Auto-save immediately
    calendarStore.savePreferences({ [setting]: value }).then(() => {
      window.dispatchEvent(new CustomEvent('calendar-preferences-updated'));
    });
  }

  private async handleReset(): Promise<void> {
    if (confirm('Reset all settings to defaults?')) {
      await calendarStore.resetPreferences();
      this.rerender();
      log.success('Settings reset');
    }
  }

  private async handleSave(): Promise<void> {
    // Settings are now auto-saved on change, just close
    log.success('Settings closed');
    this.close();
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
    this.props.onClose();
    this.unmount();
  }

  protected onMount(): void {
    document.body.style.overflow = 'hidden';
    
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
    };
    document.addEventListener('keydown', handleEsc);

    // Register cleanup for ESC listener
    this.unsubscribe = () => {
      document.removeEventListener('keydown', handleEsc);
    };

    // Initial slider styling
    this.element.querySelectorAll<HTMLInputElement>('.settings-field__slider').forEach(slider => {
      const percentage = ((parseInt(slider.value) - parseInt(slider.min)) / (parseInt(slider.max) - parseInt(slider.min))) * 100;
      slider.style.setProperty('--slider-progress', `${percentage}%`);
    });
  }


  protected onUnmount(): void {
    document.body.style.overflow = '';
    if (this.unsubscribe) this.unsubscribe();
  }
}
