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
import { logger } from '@core/logger';
import { APP_VERSION } from '@core/constants';
import { ThemeManager } from '@core/ThemeManager';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import type { IConfigManager } from '@core/interfaces/IConfigManager';
import type { ModuleRegistry } from '@core/modules/ModuleRegistry';
import type { AstraNavigationService } from './modules/astra/services/AstraNavigationService';
import { setupDI } from './setup';
import { waitForBackground } from '@core/services/BackgroundWake';

declare global {
  interface Window {
    AnilistUltimate?: {
      version: typeof APP_VERSION;
      logger: typeof logger;
      config: IConfigManager;
      registry: ModuleRegistry;
      getModules: ModuleRegistry['getAllInstances'];
      getStatus: ModuleRegistry['getSummary'];
    };
  }
}

// Styles
import './styles/tokens.css';
import './styles/main.css';
import './styles/toast.css';
import './styles/social-activity.css';
import './styles/custom-lists.css';
import './styles/astra.css';
import './styles/astra-wrapped.css';
import './styles/astra-wrapped-year.css';
import './styles/astra-wrapped-hub.css';
import '@core/ui/Icons';

/**
 * Initialize the global debug object
 */
function setupDebugExposure(config: IConfigManager, registry: ModuleRegistry): void {
  try {
    window.AnilistUltimate = {
      version: APP_VERSION,
      logger,
      config,
      registry,
      getModules: () => registry.getAllInstances(),
      getStatus: () => registry.getSummary(),
    };
  } catch {
    // Silent fail if window access restricted
  }
}

/**
 * Initialize the extension
 */
async function init(): Promise<void> {
  try {
    // Wake the MV3 worker (it may be asleep or mid-shutdown) before setup depends on it.
    await waitForBackground();
    await setupDI();

    // High Priority: Inject Astra Navigation Link immediately
    try {
      const navService = container.resolve<AstraNavigationService>(TOKENS.AstraNavigationService);
      navService.injectNavbarButton();
    } catch (e) {
      logger.error('Astra immediate injection failed', e);
    }

    const config = container.resolve<IConfigManager>(TOKENS.Config);
    const registry = container.resolve<ModuleRegistry>(TOKENS.ModuleRegistry);

    container.resolve(ThemeManager);
    // SEC-008/012: only expose internals on window in dev builds, never in production.
    if (import.meta.env.DEV) {
      setupDebugExposure(config, registry);
    }

    await registry.initAll();
    logger.success('Astra Ultimate initialized');
  } catch (error) {
    logger.error('Fatal initialization error', error);
  }
}

// Global start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void init();
  });
} else {
  void init();
}
