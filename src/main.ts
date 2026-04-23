/**
 * Anilist Ultimate - Main Entry Point
 * Modern TypeScript rewrite - Stabilized Static Version
 */

/**
 * Anilist Ultimate v2 - Main Entry Point
 * Enterprise-grade architecture with DI, ConfigManager, and ModuleRegistry
 */

import 'reflect-metadata'; // Required for tsyringe
import { log } from '@core/logger';
import { APP_VERSION } from '@core/constants';
import { ThemeManager } from '@core/ThemeManager';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import type { ModuleRegistry } from '@core/modules/ModuleRegistry';
import type { AuthTokenService } from '@core/auth/AuthTokenService';
import { setupDI } from './setup';

// Styles
import './styles/main.css';
import './styles/toast.css';
import './styles/social-activity.css';
import './styles/custom-lists.css';
import './styles/astra.css';

/**
 * Initialize the global debug object
 */
function setupDebugExposure(config: IConfigManager, registry: ModuleRegistry): void {
  try {
    (window as any).AnilistUltimate = {
      version: APP_VERSION,
      log,
      config,
      registry,
      getModules: () => registry.getAllInstances(),
      getStatus: () => registry.getSummary(),
    };
  } catch (e) {
    // Silent fail if window access restricted
  }
}

/**
 * Check for OAuth callback and save token
 */
function checkOAuthCallback(authService: AuthTokenService): void {
  if (window.location.hash && window.location.hash.includes('access_token')) {
    try {
      const params = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = params.get('access_token');
      if (accessToken) {
        log.info('OAuth token received, saving via AuthTokenService');

        // Save using centralized service (migrates from legacy keys automatically)
        authService.setToken(accessToken);

        history.replaceState(null, document.title, window.location.pathname + window.location.search);
        log.success('Access token saved successfully');
      }
    } catch (error) {
      log.error('OAuth processing failed', error);
    }
  }
}

/**
 * Initialize the extension
 */
async function init(): Promise<void> {
  console.log(`[Anilist Ultimate] Starting v${APP_VERSION}...`);

  try {
    // Setup DI container and load configuration
    await setupDI();

    // Resolve services from container
    const config = container.resolve<IConfigManager>(TOKENS.Config);
    const registry = container.resolve<ModuleRegistry>(TOKENS.ModuleRegistry);
    const authService = container.resolve<AuthTokenService>(TOKENS.AuthTokenService);

    // Setup OAuth handling
    checkOAuthCallback(authService);

    // Initialize theme manager
    ThemeManager.getInstance();

    // Load Font Awesome icons
    loadFontAwesome();

    // Setup debug exposure
    setupDebugExposure(config, registry);

    // Initialize all registered modules
    await registry.initAll();

    log.success('Extension fully loaded');
  } catch (error) {
    console.error('[Anilist Ultimate] Fatal Error:', error);
  }
}

/**
 * Load Font Awesome icons if not already loaded
 */
function loadFontAwesome(): void {
  if (!document.querySelector('link[href*="fontawesome"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
}

// Global start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
