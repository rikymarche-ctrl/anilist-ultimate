import 'reflect-metadata';
import '@fortawesome/fontawesome-free/css/all.min.css';
// Self-hosted fonts: extension pages make no third-party font requests.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/outfit/latin-400.css';
import '@fontsource/outfit/latin-500.css';
import '@fontsource/outfit/latin-600.css';
import '@fontsource/outfit/latin-700.css';
import '@fontsource/outfit/latin-800.css';
import '@core/ui/Icons';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import { ConfigClient } from '@core/config/ConfigClient';
import { StorageManager } from '@core/storage/StorageManager';
import { logger } from '@core/logger';
import { EventBus } from '@core/events/EventBus';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import type { FeatureFlags } from '@core/config/types';
import { escapeHtml } from '@core/utils/Template';
import { APP_VERSION } from '@core/constants';
import { RecoveryPanel } from './RecoveryPanel';

/**
 * Settings Page Controller - Version 2.0
 * Improved reliability and premium UI organization.
 */
class SettingsPage {
  private configManager!: IConfigManager;
  private saveIndicatorTimeout: number | null = null;

  constructor() {
    // Start as soon as possible, but ensure DOM is ready for rendering
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        void this.init().catch((error: unknown) => logger.error('[Settings] Initialization failed', error));
      });
    } else {
      void this.init().catch((error: unknown) => logger.error('[Settings] Initialization failed', error));
    }
  }

  private async init() {
    logger.debug('[Settings] Booting up...');

    try {
      // 1. Setup DI Container
      this.setupContainer();

      // 2. Resolve ConfigManager
      this.configManager = container.resolve<IConfigManager>(TOKENS.Config);

      // 3. Load Data
      logger.debug('[Settings] Loading configuration...');
      await this.configManager.load();
      logger.debug('[Settings] Configuration loaded successfully');

      // 3.5 Apply current theme
      this.updateTheme();

      // 4. Initial Render
      this.render();

      // 5. Interactivity
      this.attachListeners();
      const recoveryRoot = document.getElementById('data-recovery');
      if (recoveryRoot) new RecoveryPanel(recoveryRoot);

      logger.debug('[Settings] Ready.');
    } catch (error) {
      logger.error('[Settings] Critical initialization failure:', error);
      this.renderError(error);
    }
  }

  private setupContainer() {
    // Register essential infrastructure
    container.registerInstance(TOKENS.Logger, logger);
    const settingsStorage = new StorageManager('sync', logger);
    container.registerInstance(TOKENS.Storage, settingsStorage);
    container.registerSingleton(TOKENS.EventBus, EventBus);
    container.registerInstance(
      TOKENS.Config,
      new ConfigClient(settingsStorage, container.resolve(TOKENS.EventBus))
    );
  }

  private render() {
    const app = document.getElementById('settings-app');
    if (!app) {
      logger.error('[Settings] Target element #settings-app not found!');
      return;
    }

    app.innerHTML = `
      <aside class="settings-sidebar">
        <div class="settings-logo">
          <span class="settings-brand-mark"><img src="/icons/ultimate-mark.png" alt=""></span>
          <h1>AniList Ultimate <span class="official-status">(Unofficial)</span></h1>
        </div>
        <nav class="sidebar-nav">
          <div class="nav-item active" data-section="modules">
            <i class="fa-solid fa-cubes"></i>
            <span>Feature Modules</span>
          </div>
          <div class="nav-item" data-section="appearance">
            <i class="fa-solid fa-paintbrush"></i>
            <span>Appearance</span>
          </div>
          <div class="nav-item" data-section="advanced">
            <i class="fa-solid fa-sliders"></i>
            <span>Advanced</span>
          </div>
          <div class="nav-item" data-section="about">
            <i class="fa-solid fa-circle-info"></i>
            <span>About</span>
          </div>
        </nav>
      </aside>

      <main class="settings-content">
        <header>
          <h2>Control Panel</h2>
          <p>Manage all extension features and customize your experience.</p>
        </header>

        <div id="sections-container">
          <!-- Modules Section -->
          <section id="section-modules" class="settings-section active">
            <div class="category-block">
              <h3 class="section-title"><i class="fa-solid fa-rocket"></i> Core Experience</h3>
              <div class="module-grid">
                ${this.renderModuleCard('calendar', 'Airing Calendar', 'Modern anime airing schedule directly on your home page.', 'fa-calendar-days')}
                ${this.renderModuleCard('astra', 'Astra Module', 'Advanced episode journal and quick rating system.', 'fa-book-journal-whills')}
                ${this.renderModuleCard('mediaMetadata', 'Media Metadata', 'Extra database links (MAL, Reddit) on anime/manga pages.', 'fa-circle-info')}
                ${this.renderModuleCard('mediaMusic', 'Music Themes', 'Display anime openings and endings with direct video links and YouTube search.', 'fa-music')}
              </div>
            </div>

            <div class="category-block" style="margin-top: 40px;">
              <h3 class="section-title"><i class="fa-solid fa-users"></i> Social Features</h3>
              <div class="module-grid">
                ${this.renderModuleCard('hoverComments', 'Hover Comments', 'Preview user notes and comments by hovering over activity items.', 'fa-comment-dots')}
                ${this.renderModuleCard('socialActivity', 'Social Activity', 'See which friends are watching specific anime on cards and sidebars.', 'fa-user-group')}
                ${this.renderModuleCard('friendAlerts', 'Friend Alerts', 'Alerts for friend activity on selected titles. Turn off to hide alerts and pause checks. Independent of Astra.', 'fa-bell')}
                ${this.renderModuleCard('listEditor', 'Bulk Editor', 'Edit status and custom list memberships on your own anime and manga lists.', 'fa-list-check')}
              </div>
            </div>

            <div class="category-block" style="margin-top: 40px;">
              <h3 class="section-title"><i class="fa-solid fa-bolt"></i> Enhancements</h3>
              <div class="module-grid">
                ${this.renderModuleCard('notificationCleaner', 'Notification Cleaner', 'Keep your notification panel clean and organized.', 'fa-bell-slash')}
                ${this.renderModuleCard('reviewEnhancer', 'Review Enhancer', 'Improved review displays and rating visibility.', 'fa-star-half-stroke')}
                ${this.renderModuleCard('forumEnhancer', 'Forum Enhancer', 'Better forum navigation and layout improvements.', 'fa-comments')}
                ${this.renderModuleCard('activityScore', 'Activity Score', 'Visualize activity trends and scoring metrics.', 'fa-chart-line')}
                ${this.renderModuleCard('pageRestore', 'Back Restore', 'Going back to any page restores what you had loaded, your list filters and the scroll position.', 'fa-arrow-rotate-left')}
              </div>
            </div>
          </section>

          <!-- Appearance Section -->
          <section id="section-appearance" class="settings-section">
            <h3 class="section-title"><i class="fa-solid fa-eye"></i> Appearance Settings</h3>
            <div class="category-block">
              <h4 class="section-title" style="font-size: 0.8rem;">Branding</h4>
              <div class="module-card" style="width: 100%;">
                <div class="module-header">
                  <div class="module-info">
                    <div class="module-icon"><i class="fa-solid fa-palette"></i></div>
                    <div>
                      <span class="module-name">Accent Color</span>
                      <div class="module-desc">Customize the primary color used across Astra and the extension.</div>
                    </div>
                  </div>
                  <div style="display: flex; align-items: center; gap: 15px;">
                    <span id="color-value" style="font-family: monospace; font-size: 0.9rem; color: var(--astra-muted);">#3dbbee</span>
                    <input type="color" id="accent-color-picker" value="${this.configManager.get('theme').accentColor}" style="width: 40px; height: 40px; border: none; border-radius: 8px; cursor: pointer; background: transparent;">
                  </div>
                </div>
              </div>
            </div>
            
            <div class="category-block" style="margin-top: 40px;">
              <h4 class="section-title" style="font-size: 0.8rem;">Experimental</h4>
              <div class="module-card" style="width: 100%;">
                 <p style="color: var(--astra-muted);">More visual options (Blur intensity, Nebula style, Custom Fonts) are coming soon.</p>
              </div>
            </div>
          </section>

          <!-- Advanced Section -->
          <section id="section-advanced" class="settings-section">
            <div id="data-recovery" class="category-block"></div>
            <h3 class="section-title"><i class="fa-solid fa-microchip"></i> Developer Options</h3>
            <div class="module-grid">
               ${this.renderModuleCard('webComponents', 'Web Components', 'Use modern web components for UI rendering.', 'fa-code')}
               ${this.renderModuleCard('virtualScroll', 'Virtual Scrolling', 'Optimize performance for long lists (Experimental).', 'fa-scroll')}
            </div>
          </section>

          <!-- About Section -->
          <section id="section-about" class="settings-section">
            <h3 class="section-title"><i class="fa-solid fa-heart"></i> About</h3>
            <div class="module-card" style="width: 100%; max-width: 600px;">
              <p><strong>AniList Ultimate v${escapeHtml(APP_VERSION)}</strong></p>
              <p>Created by <a href="https://anilist.co/user/ExAstra/" target="_blank" rel="noopener noreferrer">ExAstra</a>. AniList Ultimate brings together the earlier calendar and hover-comment extensions. It is not affiliated with or endorsed by AniList.</p>
              <div style="margin-top: 20px; display: flex; gap: 20px;">
                <a href="https://github.com/rikymarche-ctrl/anilist-ultimate" target="_blank" rel="noopener noreferrer" style="color: var(--astra-text); text-decoration: none; display: flex; align-items: center; gap: 8px;">
                  <i class="fa-brands fa-github" style="color: var(--astra-accent); font-size: 1.2rem;"></i> GitHub
                </a>
              </div>
            </div>
          </section>
        </div>

        <div id="save-indicator" class="save-indicator">
          <i class="fa-solid fa-circle-check"></i>
          <span>Configuration updated</span>
        </div>
      </main>
    `;
  }

  private renderModuleCard(id: keyof FeatureFlags, name: string, desc: string, icon: string) {
    const isEnabled = this.configManager.isFeatureEnabled(id);
    const iconMarkup =
      id === 'astra'
        ? '<svg class="astra-brand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4L4 20H8L12 12L16 20H20L12 4Z"></path><path d="M12 12L10.7 15.5H13.3L12 12Z"></path></svg>'
        : `<i class="fa-solid ${icon}"></i>`;
    return `
      <div class="module-card">
        <div class="module-header">
          <div class="module-info">
            <div class="module-icon">${iconMarkup}</div>
            <span class="module-name">${name}</span>
          </div>
          <label class="switch">
            <input type="checkbox" data-module="${id}" ${isEnabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="module-desc">${desc}</div>
      </div>
    `;
  }

  private renderError(error: unknown) {
    const app = document.getElementById('settings-app');
    if (!app) return;

    app.innerHTML = `
      <div style="padding: 100px; text-align: center; color: #ff4d4d;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size: 3rem; margin-bottom: 20px;"></i>
        <h2>Failed to load settings</h2>
        <p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>
        <button id="settings-retry" style="background: #ff4d4d; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; margin-top: 20px;">
          Retry
        </button>
      </div>
    `;
    document
      .getElementById('settings-retry')
      ?.addEventListener('click', () => window.location.reload());
  }

  private async saveAccentColor(e: Event): Promise<void> {
    const color = (e.target as HTMLInputElement).value;
    const previous = this.configManager.get('theme').accentColor;
    try {
      await this.configManager.set('theme', { accentColor: color });
      this.showSaveIndicator();
    } catch (err) {
      logger.error('[Settings] Failed to save accent color:', err);
      // Roll the live preview back to the last persisted colour.
      this.revertAccentColor(previous);
      this.showSaveIndicator(true);
    }
  }

  private revertAccentColor(color: string): void {
    const colorPicker = document.getElementById('accent-color-picker') as HTMLInputElement | null;
    if (colorPicker) colorPicker.value = color;
    const colorValue = document.getElementById('color-value');
    if (colorValue) colorValue.textContent = color.toUpperCase();
    this.updateTheme(color);
  }

  private async saveToggleSetting(e: Event): Promise<void> {
    const target = e.target as HTMLInputElement;
    const moduleId = target.getAttribute('data-module') as keyof FeatureFlags;
    const isEnabled = target.checked;
    try {
      await this.configManager.setFeature(moduleId, isEnabled);
      this.showSaveIndicator();
    } catch (err) {
      logger.error('[Settings] Failed to save setting:', err);
      // Show the stored state again: the requested change did not persist.
      target.checked = !isEnabled;
      this.showSaveIndicator(true);
    }
  }

  private attachListeners() {
    // Color Picker
    const colorPicker = document.getElementById('accent-color-picker') as HTMLInputElement;
    const colorValue = document.getElementById('color-value');
    if (colorPicker) {
      // Set initial value text
      if (colorValue) colorValue.textContent = colorPicker.value.toUpperCase();

      colorPicker.addEventListener('input', (e) => {
        const color = (e.target as HTMLInputElement).value;
        if (colorValue) colorValue.textContent = color.toUpperCase();
        this.updateTheme(color);
      });

      colorPicker.addEventListener('change', (e) => {
        void this.saveAccentColor(e).catch((error: unknown) => logger.error('[Settings] Failed to save accent color', error));
      });
    }

    // Toggles
    document.querySelectorAll('input[data-module]').forEach((input) => {
      input.addEventListener('change', (e) => {
        void this.saveToggleSetting(e);
      });
    });

    // Navigation
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        const sectionId = item.getAttribute('data-section');
        if (!sectionId) return;

        document.querySelectorAll('.nav-item').forEach((nav) => nav.classList.remove('active'));
        item.classList.add('active');

        document
          .querySelectorAll('.settings-section')
          .forEach((sec) => sec.classList.remove('active'));
        const targetSection = document.getElementById(`section-${sectionId}`);
        if (targetSection) targetSection.classList.add('active');
      });
    });
  }

  private updateTheme(color?: string) {
    const accentColor = color || this.configManager.get('theme').accentColor;
    logger.debug('[Settings] Applying accent color:', accentColor);

    document.documentElement.style.setProperty('--astra-accent', accentColor);

    // Update transparency variants (matches astra.css names)
    document.documentElement.style.setProperty('--astra-accent-a10', `${accentColor}1A`); // ~10%
    document.documentElement.style.setProperty('--astra-accent-a20', `${accentColor}33`); // ~20%
    document.documentElement.style.setProperty('--astra-accent-a50', `${accentColor}80`); // ~50%
  }

  private showSaveIndicator(failed = false) {
    const indicator = document.getElementById('save-indicator');
    if (!indicator) return;

    if (this.saveIndicatorTimeout) {
      clearTimeout(this.saveIndicatorTimeout);
    }

    const icon = indicator.querySelector('i');
    const label = indicator.querySelector('span');
    if (icon) icon.className = failed ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-check';
    if (label) label.textContent = failed ? 'Could not save. Please try again.' : 'Configuration updated';
    indicator.classList.add('visible');
    this.saveIndicatorTimeout = window.setTimeout(() => {
      indicator.classList.remove('visible');
      this.saveIndicatorTimeout = null;
    }, 2000);
  }
}

// Global error boundary
window.onerror = (msg, url, line) => {
  logger.error('[Settings] Global Error:', msg, 'at', url, ':', line);
};

// Initialize
new SettingsPage();
