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

console.log('========================================');
console.log('ANILIST ULTIMATE - MAIN.TS LOADING');
console.log('========================================');

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
import './styles/main.css';
import './styles/toast.css';
import './styles/social-activity.css';
import './styles/custom-lists.css';
import './styles/astra.css';
// BUG-010 & Audit 2.1 Fix: Font Awesome loaded via CDN to ensure correct path resolution in content scripts.
// Local bundling often fails due to relative path breakage when injected into the host page.
function loadFontAwesome(): void {
  if (!document.querySelector('link[href*="fontawesome"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
}

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
  console.log(`[Anilist Ultimate] Starting v${APP_VERSION}...`);
  console.log('[DEBUG] Init function called');

  try {
    console.log('[DEBUG] Setting up DI...');
    // Setup DI container    // Load icons
    loadFontAwesome();

    // Start DI and UI injection
    await setupDI();
    console.log('[DEBUG] DI setup complete');

    console.log('[DEBUG] Resolving services...');
    // Resolve services from container
    const config = container.resolve<IConfigManager>(TOKENS.Config);
    const registry = container.resolve<ModuleRegistry>(TOKENS.ModuleRegistry);
    console.log('[DEBUG] Services resolved');

    // Initialize theme manager
    container.resolve(ThemeManager);

    // Font Awesome now loaded via import at top of file (BUG-010 fix)
    // loadFontAwesome(); // REMOVED - CDN dependency

    // Setup debug exposure
    setupDebugExposure(config, registry);

    console.log('[DEBUG] Initializing modules...');
    // Initialize all registered modules
    await registry.initAll();
    console.log('[DEBUG] All modules initialized!');

    log.success('Extension fully loaded');
    console.log('========================================');
    console.log('ANILIST ULTIMATE FULLY LOADED!');
    console.log('========================================');
  } catch (error) {
    console.error('[Anilist Ultimate] Fatal Error:', error);
    console.error('[DEBUG] Error stack:', error);
  }
}

/**
 * BUG-010 fix: Font Awesome now bundled locally via npm package
 * CDN loading removed to prevent failures in corporate networks
 * Import '@fortawesome/fontawesome-free/css/all.min.css' at top of file
 */
// function loadFontAwesome(): void {
//   if (!document.querySelector('link[href*="fontawesome"]')) {
//     const link = document.createElement('link');
//     link.rel = 'stylesheet';
//     link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
//     link.crossOrigin = 'anonymous';
//     document.head.appendChild(link);
//   }
// }

// Global start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
