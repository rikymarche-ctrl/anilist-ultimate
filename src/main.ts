/**
 * @file main.ts
 * @description Anilist Ultimate - Application Entry Point
 *
 * Bootstrap sequence:
 *   1. Import reflect-metadata (required by tsyringe DI)
 *   2. Setup DI container (register all services and modules)
 *   3. Initialize theme manager
 *   4. Load external resources (Font Awesome)
 *   5. Expose debug API on window
 *   6. Initialize all registered modules via ModuleRegistry
 *
 * This file is injected as a content script into https://anilist.co/*
 * via the Chrome extension manifest (run_at: document_idle).
 *
 * @see setup.ts for DI container configuration
 * @see docs/ARCHITECTURE.md for full system architecture
 */
import 'reflect-metadata'; // Required for tsyringe
import { log } from '@core/logger';
import { APP_VERSION } from '@core/constants';
import { ThemeManager } from '@core/ThemeManager';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import type { ModuleRegistry } from '@core/modules/ModuleRegistry';
import { setupDI } from './setup';

// Styles
import './styles/tokens.css';
import './styles/main.css';
import './styles/toast.css';
import './styles/social-activity.css';
import './styles/custom-lists.css';
import './styles/astra.css';
import '@fortawesome/fontawesome-free/js/all.min.js';
import '@fortawesome/fontawesome-free/js/v4-shims.min.js';

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
 * Initialize the extension
 */
async function init(): Promise<void> {
  try {
    await setupDI();

    // High Priority: Inject Astra Navigation Link immediately
    try {
      const navService = container.resolve<any>(TOKENS.AstraNavigationService);
      navService.injectNavbarButton();
    } catch (e) {
      log.error('Astra immediate injection failed', e);
    }

    const config = container.resolve<IConfigManager>(TOKENS.Config);
    const registry = container.resolve<ModuleRegistry>(TOKENS.ModuleRegistry);

    container.resolve(ThemeManager);
    // SEC-008/012: only expose internals on window in dev builds, never in production.
    if (import.meta.env.DEV) {
      setupDebugExposure(config, registry);
    }

    await registry.initAll();
    log.success('Astra Ultimate initialized');
  } catch (error) {
    log.error('Fatal initialization error', error);
  }
}

// Global start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
