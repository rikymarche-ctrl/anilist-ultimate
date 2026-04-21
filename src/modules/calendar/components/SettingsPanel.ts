/**
 * Settings Panel Component
 * Modal panel for calendar preferences
 */

import { BaseComponent } from '@ui/components/BaseComponent';
import { calendarStore } from '../CalendarStore';
import { log } from '@core/logger';
import { anilistClient } from '../../../api';
import type { CalendarPreferences } from '@core/types';

interface SettingsPanelProps {
  onClose: () => void;
}

export class SettingsPanel extends BaseComponent<SettingsPanelProps> {
  private unsubscribe?: () => void;
  private pendingChanges: Partial<CalendarPreferences> = {};

  protected render(): HTMLElement {
    const overlay = this.createElement('div', { class: 'settings-overlay' });

    const panel = this.createElement('div', { class: 'settings-panel' });

    const prefs = calendarStore.getState().preferences;

    panel.innerHTML = `
      <div class="settings-panel__header">
        <h2>Calendar Settings</h2>
        <button class="settings-panel__close" aria-label="Close">
          <i class="fa fa-times"></i>
        </button>
      </div>

      <div class="settings-panel__tabs">
        <button class="settings-tab settings-tab--active" data-tab="layout">Layout</button>
        <button class="settings-tab" data-tab="display">Display</button>
        <button class="settings-tab" data-tab="week">Week</button>
        <button class="settings-tab" data-tab="social">Social</button>
        <button class="settings-tab" data-tab="account">Account</button>
      </div>

      <div class="settings-panel__content">
        <!-- Layout Tab -->
        <div class="settings-tab-content settings-tab-content--active" data-tab-content="layout">
          <div class="settings-field">
            <label class="settings-field__label">Layout Mode</label>
            <select class="settings-field__select" data-setting="layoutMode">
              <option value="standard" ${prefs.layoutMode === 'standard' ? 'selected' : ''}>Standard</option>
              <option value="compact" ${prefs.layoutMode === 'compact' ? 'selected' : ''}>Compact</option>
              <option value="extended" ${prefs.layoutMode === 'extended' ? 'selected' : ''}>Extended</option>
            </select>
          </div>

          <div class="settings-field">
            <label class="settings-field__label">Title Alignment</label>
            <select class="settings-field__select" data-setting="titleAlignment">
              <option value="left" ${prefs.titleAlignment === 'left' ? 'selected' : ''}>Left</option>
              <option value="center" ${prefs.titleAlignment === 'center' ? 'selected' : ''}>Center</option>
            </select>
          </div>

          <div class="settings-field">
            <label class="settings-field__label">Column Justify</label>
            <select class="settings-field__select" data-setting="columnJustify">
              <option value="top" ${prefs.columnJustify === 'top' ? 'selected' : ''}>Top</option>
              <option value="center" ${prefs.columnJustify === 'center' ? 'selected' : ''}>Center</option>
            </select>
          </div>
        </div>

        <!-- Display Tab -->
        <div class="settings-tab-content" data-tab-content="display">
          <div class="settings-field settings-field--toggle">
            <label class="settings-field__label">
              <input type="checkbox" data-setting="showTime" ${prefs.showTime ? 'checked' : ''}>
              <span>Show Time</span>
            </label>
          </div>

          <div class="settings-field settings-field--toggle">
            <label class="settings-field__label">
              <input type="checkbox" data-setting="showEpisodeNumbers" ${prefs.showEpisodeNumbers ? 'checked' : ''}>
              <span>Show Episode Numbers</span>
            </label>
          </div>

          <div class="settings-field settings-field--toggle">
            <label class="settings-field__label">
              <input type="checkbox" data-setting="hideEmptyDays" ${prefs.hideEmptyDays ? 'checked' : ''}>
              <span>Hide Empty Days</span>
            </label>
          </div>

          <div class="settings-field settings-field--toggle">
            <label class="settings-field__label">
              <input type="checkbox" data-setting="fullWidthImages" ${prefs.fullWidthImages ? 'checked' : ''}>
              <span>Full Width Images</span>
            </label>
          </div>
          
          <div class="settings-field settings-field--toggle">
            <label class="settings-field__label" title="When enabled, clicking an anime card will open its page in a new browser tab.">
              <input type="checkbox" data-setting="openInNewTab" ${prefs.openInNewTab ? 'checked' : ''}>
              <span>Open in New Tab</span>
            </label>
            <span class="settings-field__hint">Open anime details in a new tab instead of the current one.</span>
          </div>

          <div class="settings-field" id="time-format-field" style="display: ${prefs.showTime ? 'block' : 'none'}">
            <label class="settings-field__label">Time Display Format</label>
            <select class="settings-field__select" data-setting="timeFormat">
              <option value="release" ${prefs.timeFormat === 'release' ? 'selected' : ''}>Release Time (e.g. 16:00)</option>
              <option value="countdown" ${prefs.timeFormat === 'countdown' ? 'selected' : ''}>Countdown (e.g. 2h 30m)</option>
            </select>
          </div>
        </div>

        <!-- Week Tab -->
        <div class="settings-tab-content" data-tab-content="week">
          <div class="settings-field">
            <label class="settings-field__label">Start Day</label>
            <select class="settings-field__select" data-setting="startDay">
              <option value="today" ${prefs.startDay === 'today' ? 'selected' : ''}>Today</option>
              <option disabled>─────────</option>
              <option value="1" ${prefs.startDay === '1' ? 'selected' : ''}>Monday</option>
              <option value="2" ${prefs.startDay === '2' ? 'selected' : ''}>Tuesday</option>
              <option value="3" ${prefs.startDay === '3' ? 'selected' : ''}>Wednesday</option>
              <option value="4" ${prefs.startDay === '4' ? 'selected' : ''}>Thursday</option>
              <option value="5" ${prefs.startDay === '5' ? 'selected' : ''}>Friday</option>
              <option value="6" ${prefs.startDay === '6' ? 'selected' : ''}>Saturday</option>
              <option value="0" ${prefs.startDay === '0' ? 'selected' : ''}>Sunday</option>
            </select>
          </div>

          <div class="settings-field">
            <label class="settings-field__label">Max Cards Per Day (Gallery)</label>
            <div class="slider-container">
              <input
                type="range"
                class="settings-field__slider"
                data-setting="maxCardsPerDay"
                id="maxCardsPerDay"
                value="${prefs.maxCardsPerDay}"
                min="0"
                max="10"
                step="1"
              >
              <span class="slider-value" id="maxCardsPerDayValue">
                ${prefs.maxCardsPerDay === 0 ? 'Unlimited' : prefs.maxCardsPerDay}
              </span>
            </div>
          </div>
        </div>

        <!-- Social Tab -->
        <div class="settings-tab-content" data-tab-content="social">
          <div class="settings-field settings-field--toggle">
            <label class="settings-field__label">
              <input type="checkbox" data-setting="socialEnabled" ${prefs.socialEnabled ? 'checked' : ''}>
              <span>Enable Social Features</span>
            </label>
            <span class="settings-field__hint">Show friend activity on cards and enable the social sidebar.</span>
          </div>

          <div class="settings-field settings-field--toggle" id="social-avatars-field" style="display: ${prefs.socialEnabled ? 'block' : 'none'}">
            <label class="settings-field__label">
              <input type="checkbox" data-setting="socialShowAvatars" ${prefs.socialShowAvatars ? 'checked' : ''}>
              <span>Show Friend Avatars</span>
            </label>
            <span class="settings-field__hint">Display your friends' profiles in circles on anime cards.</span>
          </div>
        </div>

        <!-- Account Tab -->
        <div class="settings-tab-content" data-tab-content="account">
          <div class="settings-field">
            <label class="settings-field__label">Authentication Status</label>
            <div class="auth-status" id="auth-status">
              <span class="auth-status-text">Checking...</span>
            </div>
          </div>

          <div class="settings-field">
            <button class="settings-field__button settings-field__button--primary" id="auth-button">
              <i class="fa fa-sign-in"></i>
              <span>Authenticate with AniList</span>
            </button>
          </div>

          <div class="settings-field">
            <button class="settings-field__button settings-field__button--danger" id="logout-button">
              <i class="fa fa-sign-out"></i>
              <span>Logout</span>
            </button>
          </div>

          <div class="settings-field">
            <small class="settings-field__hint">
              Authentication is required to mark episodes as watched and access your private lists.
            </small>
          </div>
        </div>
      </div>

      <div class="settings-panel__footer">
        <button class="settings-panel__reset">Reset to Defaults</button>
        <button class="settings-panel__save">Save & Close</button>
      </div>
    `;

    overlay.appendChild(panel);
    return overlay;
  }

  protected attachEvents(): void {
    // Close button
    const closeBtn = this.element.querySelector('.settings-panel__close');
    this.addEventListener(closeBtn as HTMLElement, 'click', () => {
      this.close();
    });

    // Click overlay to close
    this.addEventListener(this.element, 'click', (e) => {
      if (e.target === this.element) {
        this.close();
      }
    });

    // ESC key to close (handled in onMount)

    // Tab switching
    const tabButtons = this.element.querySelectorAll<HTMLButtonElement>('.settings-tab');
    tabButtons.forEach((button) => {
      this.addEventListener(button, 'click', () => {
        const tabName = button.getAttribute('data-tab');
        this.switchTab(tabName!);
      });
    });

    // Setting changes
    const selects = this.element.querySelectorAll<HTMLSelectElement>('[data-setting]');
    selects.forEach((select) => {
      this.addEventListener(select, 'change', () => {
        this.handleSettingChange(select);
      });
    });

    const checkboxes = this.element.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-setting]');
    checkboxes.forEach((checkbox) => {
      this.addEventListener(checkbox, 'change', () => {
        this.handleSettingChange(checkbox);

        // Toggle Time Format visibility when Show Time changes
        if (checkbox.getAttribute('data-setting') === 'showTime') {
          this.toggleTimeFormatVisibility(checkbox.checked);
        }

        // Toggle Social Avatars visibility when Social Features changes
        if (checkbox.getAttribute('data-setting') === 'socialEnabled') {
          this.toggleSocialAvatarsVisibility(checkbox.checked);
        }
      });
    });

    const numberInputs = this.element.querySelectorAll<HTMLInputElement>('input[type="number"][data-setting]');
    numberInputs.forEach((input) => {
      this.addEventListener(input, 'change', () => {
        this.handleSettingChange(input);
      });
    });

    // Range/slider inputs
    const sliderInputs = this.element.querySelectorAll<HTMLInputElement>('input[type="range"][data-setting]');
    sliderInputs.forEach((slider) => {
      this.addEventListener(slider, 'input', () => {
        this.handleSliderChange(slider);
      });
    });

    // Reset button
    const resetBtn = this.element.querySelector('.settings-panel__reset');
    this.addEventListener(resetBtn as HTMLElement, 'click', async () => {
      if (confirm('Reset all settings to defaults?')) {
        await calendarStore.resetPreferences();
        this.rerender();
        log.success('Settings reset to defaults');
      }
    });

    // Save & Close button
    const saveBtn = this.element.querySelector('.settings-panel__save');
    this.addEventListener(saveBtn as HTMLElement, 'click', async () => {
      // Apply all pending changes
      if (Object.keys(this.pendingChanges).length > 0) {
        await calendarStore.savePreferences(this.pendingChanges);
        log.success('Settings saved');
        this.close();

        // Emit event to refresh calendar without reload
        window.dispatchEvent(new CustomEvent('calendar-preferences-updated'));
      } else {
        log.info('No changes to save');
        this.close();
      }
    });

    // Auth button
    const authBtn = this.element.querySelector('#auth-button');
    if (authBtn) {
      this.addEventListener(authBtn as HTMLElement, 'click', () => {
        const authUrl = anilistClient.getAuthUrl();
        window.open(authUrl, '_blank');
      });
    }

    // Logout button
    const logoutBtn = this.element.querySelector('#logout-button');
    if (logoutBtn) {
      this.addEventListener(logoutBtn as HTMLElement, 'click', () => {
        if (confirm('Are you sure you want to logout?')) {
          localStorage.removeItem('access_token');
          localStorage.removeItem('jwt');
          sessionStorage.removeItem('access_token');
          log.success('Logged out successfully');
          this.updateAuthStatus();
        }
      });
    }
  }

  /**
   * Switch between tabs
   */
  private switchTab(tabName: string): void {
    // Remove active class from all tabs
    const allTabs = this.element.querySelectorAll('.settings-tab');
    allTabs.forEach((tab) => tab.classList.remove('settings-tab--active'));

    // Remove active class from all tab contents
    const allContents = this.element.querySelectorAll('.settings-tab-content');
    allContents.forEach((content) => content.classList.remove('settings-tab-content--active'));

    // Add active class to selected tab
    const selectedTab = this.element.querySelector(`[data-tab="${tabName}"]`);
    selectedTab?.classList.add('settings-tab--active');

    // Add active class to selected content
    const selectedContent = this.element.querySelector(`[data-tab-content="${tabName}"]`);
    selectedContent?.classList.add('settings-tab-content--active');

    // Hide footer (Reset/Save buttons) when on Account tab
    const footer = this.element.querySelector('.settings-panel__footer');
    if (footer) {
      if (tabName === 'account') {
        footer.classList.add('settings-panel__footer--hidden');
      } else {
        footer.classList.remove('settings-panel__footer--hidden');
      }
    }
  }

  /**
   * Handle setting change
   */
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

    log.debug('Setting changed (pending)', { setting, value });

    // Save to pending changes instead of applying immediately
    this.pendingChanges[setting] = value;
  }

  /**
   * Handle slider change with dynamic value display and track styling
   */
  private handleSliderChange(slider: HTMLInputElement): void {
    const setting = slider.getAttribute('data-setting') as keyof CalendarPreferences;
    const value = parseInt(slider.value, 10);
    const min = parseInt(slider.min, 10);
    const max = parseInt(slider.max, 10);

    // Calculate percentage for blue track fill
    const percentage = ((value - min) / (max - min)) * 100;
    slider.style.setProperty('--slider-progress', `${percentage}%`);

    // Update the display value
    const valueDisplay = this.element.querySelector(`#${slider.id}Value`);
    if (valueDisplay) {
      valueDisplay.textContent = value === 0 ? 'Unlimited' : value.toString();
    }

    log.debug('Slider changed (pending)', { setting, value });

    // Save to pending changes (cast to any to avoid TypeScript issues)
    (this.pendingChanges as any)[setting] = value;
  }

  /**
   * Toggle Time Format field visibility based on Show Time setting
   */
  private toggleTimeFormatVisibility(showTime: boolean): void {
    const timeFormatField = this.element.querySelector('#time-format-field') as HTMLElement;

    if (timeFormatField) {
      timeFormatField.style.display = showTime ? 'block' : 'none';
    }
  }

  /**
   * Toggle Social Avatars field visibility based on Social Enabled setting
   */
  private toggleSocialAvatarsVisibility(socialEnabled: boolean): void {
    const avatarsField = this.element.querySelector('#social-avatars-field') as HTMLElement;
    if (avatarsField) {
      avatarsField.style.display = socialEnabled ? 'block' : 'none';
    }
  }

  /**
   * Close the panel
   */
  private close(): void {
    this.props.onClose();
    this.unmount();
  }

  protected onMount(): void {
    // Prevent body scroll when panel is open
    document.body.style.overflow = 'hidden';

    // ESC key to close
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
      }
    };
    document.addEventListener('keydown', handleEsc);

    // Store the cleanup for onUnmount
    const originalUnmount = this.onUnmount.bind(this);
    this.onUnmount = () => {
      document.removeEventListener('keydown', handleEsc);
      originalUnmount();
    };

    // Subscribe to store changes to update UI
    this.unsubscribe = calendarStore.subscribe((state, prevState) => {
      if (state.preferences !== prevState.preferences) {
        // Preferences changed externally, could update UI here if needed
      }
    });

    // Update initial slider track progress
    const sliders = this.element.querySelectorAll<HTMLInputElement>('.settings-field__slider');
    sliders.forEach(slider => {
      const val = parseInt(slider.value);
      const min = parseInt(slider.min);
      const max = parseInt(slider.max);
      const percentage = ((val - min) / (max - min)) * 100;
      slider.style.setProperty('--slider-progress', `${percentage}%`);
    });

    // Update auth status
    this.updateAuthStatus();
  }

  /**
   * Update authentication status display
   */
  private updateAuthStatus(): void {
    const statusEl = this.element.querySelector('#auth-status');
    const authBtn = this.element.querySelector('#auth-button');
    const logoutBtn = this.element.querySelector('#logout-button');

    if (!statusEl) return;

    const isAuthenticated = anilistClient.isAuthenticated();

    if (isAuthenticated) {
      statusEl.innerHTML = `
        <span class="auth-status-text auth-status-text--authenticated">
          <i class="fa fa-check-circle"></i>
          Authenticated
        </span>
      `;

      // Hide authenticate button, show logout button
      if (authBtn) (authBtn as HTMLElement).style.display = 'none';
      if (logoutBtn) (logoutBtn as HTMLElement).style.display = 'flex';
    } else {
      statusEl.innerHTML = `
        <span class="auth-status-text auth-status-text--not-authenticated">
          <i class="fa fa-times-circle"></i>
          Not Authenticated
        </span>
      `;

      // Show authenticate button, hide logout button
      if (authBtn) (authBtn as HTMLElement).style.display = 'flex';
      if (logoutBtn) (logoutBtn as HTMLElement).style.display = 'none';
    }
  }

  protected onUnmount(): void {
    // Restore body scroll
    document.body.style.overflow = '';

    // Unsubscribe from store
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}
