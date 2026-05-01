import 'reflect-metadata';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import { ConfigManager } from '@core/config/ConfigManager';
import { syncStorage } from '@core/storage/StorageManager';
import { logger } from '@core/logger';
import { EventBus } from '@core/events/EventBus';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import type { FeatureFlags } from '@core/config/types';

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
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  private async init() {
    console.log('[Settings] Booting up...');
    
    try {
      // 1. Setup DI Container
      this.setupContainer();
      
      // 2. Resolve ConfigManager
      this.configManager = container.resolve<IConfigManager>(TOKENS.Config);
      
      // 3. Load Data
      console.log('[Settings] Loading configuration...');
      await this.configManager.load();
      console.log('[Settings] Configuration loaded successfully');
      
      // 3.5 Apply current theme
      this.updateTheme();
      
      // 4. Initial Render
      this.render();
      
      // 5. Interactivity
      this.attachListeners();
      
      console.log('[Settings] Ready.');
    } catch (error) {
      console.error('[Settings] Critical initialization failure:', error);
      this.renderError(error);
    }
  }

  private setupContainer() {
    // Register essential infrastructure
    container.registerInstance(TOKENS.Logger, logger);
    container.registerInstance(TOKENS.Storage, syncStorage);
    container.registerSingleton(TOKENS.EventBus, EventBus);
    container.registerSingleton(TOKENS.Config, ConfigManager);
  }

  private render() {
    const app = document.getElementById('settings-app');
    if (!app) {
      console.error('[Settings] Target element #settings-app not found!');
      return;
    }

    app.innerHTML = `
      <aside class="settings-sidebar">
        <div class="settings-logo">
          <img src="/icons/icon48.png" alt="Logo">
          <h1>Anilist Ultimate</h1>
        </div>
        <nav class="sidebar-nav">
          <div class="nav-item active" data-section="modules">
            <i class="fas fa-cubes"></i>
            <span>Feature Modules</span>
          </div>
          <div class="nav-item" data-section="appearance">
            <i class="fas fa-paint-brush"></i>
            <span>Appearance</span>
          </div>
          <div class="nav-item" data-section="advanced">
            <i class="fas fa-sliders"></i>
            <span>Advanced</span>
          </div>
          <div class="nav-item" data-section="about">
            <i class="fas fa-info-circle"></i>
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
              <h3 class="section-title"><i class="fas fa-rocket"></i> Core Experience</h3>
              <div class="module-grid">
                ${this.renderModuleCard('calendar', 'Airing Calendar', 'Modern anime airing schedule directly on your home page.', 'fa-calendar-days')}
                ${this.renderModuleCard('astra', 'Astra Journal', 'Advanced episode journal and quick rating system.', 'fa-journal-whills')}
                ${this.renderModuleCard('mediaMetadata', 'Media Metadata', 'Extra database links (MAL, Reddit) on anime/manga pages.', 'fa-circle-info')}
              </div>
            </div>

            <div class="category-block" style="margin-top: 40px;">
              <h3 class="section-title"><i class="fas fa-users"></i> Social Features</h3>
              <div class="module-grid">
                ${this.renderModuleCard('hoverComments', 'Hover Comments', 'Preview user notes and comments by hovering over activity items.', 'fa-comment-dots')}
                ${this.renderModuleCard('socialActivity', 'Social Activity', 'See which friends are watching specific anime on cards and sidebars.', 'fa-user-group')}
                ${this.renderModuleCard('listEditor', 'Custom Lists', 'Enhanced management for your AniList custom lists.', 'fa-list-check')}
              </div>
            </div>

            <div class="category-block" style="margin-top: 40px;">
              <h3 class="section-title"><i class="fas fa-bolt"></i> Enhancements</h3>
              <div class="module-grid">
                ${this.renderModuleCard('notificationCleaner', 'Notification Cleaner', 'Keep your notification panel clean and organized.', 'fa-bell-slash')}
                ${this.renderModuleCard('reviewEnhancer', 'Review Enhancer', 'Improved review displays and rating visibility.', 'fa-star-half-stroke')}
                ${this.renderModuleCard('forumEnhancer', 'Forum Enhancer', 'Better forum navigation and layout improvements.', 'fa-comments')}
                ${this.renderModuleCard('activityScore', 'Activity Score', 'Visualize activity trends and scoring metrics.', 'fa-chart-line')}
              </div>
            </div>
          </section>

          <!-- Appearance Section -->
          <section id="section-appearance" class="settings-section">
            <h3 class="section-title"><i class="fas fa-eye"></i> Appearance Settings</h3>
            <div class="category-block">
              <h4 class="section-title" style="font-size: 0.8rem;">Branding</h4>
              <div class="module-card" style="width: 100%;">
                <div class="module-header">
                  <div class="module-info">
                    <div class="module-icon"><i class="fas fa-palette"></i></div>
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
            <h3 class="section-title"><i class="fas fa-microchip"></i> Developer Options</h3>
            <div class="module-grid">
               ${this.renderModuleCard('webComponents', 'Web Components', 'Use modern web components for UI rendering.', 'fa-code')}
               ${this.renderModuleCard('virtualScroll', 'Virtual Scrolling', 'Optimize performance for long lists (Experimental).', 'fa-scroll')}
            </div>
          </section>

          <!-- About Section -->
          <section id="section-about" class="settings-section">
            <h3 class="section-title"><i class="fas fa-heart"></i> About</h3>
            <div class="module-card" style="width: 100%; max-width: 600px;">
              <p><strong>AniList Ultimate v2.0.0</strong></p>
              <p>An all-in-one enhancement suite for AniList users. Built with modern web technologies for maximum performance and security.</p>
              <div style="margin-top: 20px; display: flex; gap: 20px;">
                <a href="#" style="color: var(--astra-text); text-decoration: none; display: flex; align-items: center; gap: 8px;">
                  <i class="fab fa-github" style="color: var(--astra-accent); font-size: 1.2rem;"></i> GitHub
                </a>
                <a href="#" style="color: var(--astra-text); text-decoration: none; display: flex; align-items: center; gap: 8px;">
                  <i class="fab fa-discord" style="color: var(--astra-accent); font-size: 1.2rem;"></i> Discord
                </a>
              </div>
            </div>
          </section>
        </div>

        <div id="save-indicator" class="save-indicator">
          <i class="fas fa-check-circle"></i>
          <span>Configuration updated</span>
        </div>
      </main>
    `;
  }

  private renderModuleCard(id: keyof FeatureFlags, name: string, desc: string, icon: string) {
    const isEnabled = this.configManager.isFeatureEnabled(id);
    return `
      <div class="module-card">
        <div class="module-header">
          <div class="module-info">
            <div class="module-icon"><i class="fas ${icon}"></i></div>
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

  private renderError(error: any) {
    const app = document.getElementById('settings-app');
    if (!app) return;

    app.innerHTML = `
      <div style="padding: 100px; text-align: center; color: #ff4d4d;">
        <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 20px;"></i>
        <h2>Failed to load settings</h2>
        <p>${error instanceof Error ? error.message : String(error)}</p>
        <button onclick="window.location.reload()" style="background: #ff4d4d; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; margin-top: 20px;">
          Retry
        </button>
      </div>
    `;
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

      colorPicker.addEventListener('change', async (e) => {
        const color = (e.target as HTMLInputElement).value;
        await this.configManager.set('theme', { accentColor: color });
        this.showSaveIndicator();
      });
    }

    // Toggles
    document.querySelectorAll('input[data-module]').forEach(input => {
      input.addEventListener('change', async (e) => {
        try {
          const target = e.target as HTMLInputElement;
          const moduleId = target.getAttribute('data-module') as keyof FeatureFlags;
          const isEnabled = target.checked;
          
          await this.configManager.setFeature(moduleId, isEnabled);
          this.showSaveIndicator();
        } catch (err) {
          console.error('[Settings] Failed to save setting:', err);
        }
      });
    });

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const sectionId = item.getAttribute('data-section');
        if (!sectionId) return;

        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');

        document.querySelectorAll('.settings-section').forEach(sec => sec.classList.remove('active'));
        const targetSection = document.getElementById(`section-${sectionId}`);
        if (targetSection) targetSection.classList.add('active');
      });
    });
  }

  private updateTheme(color?: string) {
    const accentColor = color || this.configManager.get('theme').accentColor;
    console.log('[Settings] Applying accent color:', accentColor);
    
    document.documentElement.style.setProperty('--astra-accent', accentColor);
    
    // Update transparency variants (matches astra.css names)
    document.documentElement.style.setProperty('--astra-accent-a10', `${accentColor}1A`); // ~10%
    document.documentElement.style.setProperty('--astra-accent-a20', `${accentColor}33`); // ~20%
    document.documentElement.style.setProperty('--astra-accent-a50', `${accentColor}80`); // ~50%
  }

  private showSaveIndicator() {
    const indicator = document.getElementById('save-indicator');
    if (!indicator) return;

    if (this.saveIndicatorTimeout) {
      clearTimeout(this.saveIndicatorTimeout);
    }

    indicator.classList.add('visible');
    this.saveIndicatorTimeout = window.setTimeout(() => {
      indicator.classList.remove('visible');
      this.saveIndicatorTimeout = null;
    }, 2000);
  }
}

// Global error boundary
window.onerror = (msg, url, line) => {
  console.error('[Settings] Global Error:', msg, 'at', url, ':', line);
};

// Initialize
new SettingsPage();
