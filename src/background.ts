/**
 * @file background.ts
 * @description Enterprise Service Worker orchestrator.
 * 
 * Fully unified with the Astra DI architecture. 
 * Delegates all logic to injected services.
 */

import 'reflect-metadata';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import { log } from '@core/logger';
import { setupDI } from './setup';
import type { ISyncQueueService } from '@core/interfaces/ISyncQueueService';
import type { AuthService } from '@core/auth/AuthService';
import { MSG } from './shared/messages';

/**
 * Initialize Background context
 */
async function initializeBackground(): Promise<void> {
  try {
    // 1. Initialize DI Container for Background context
    await setupDI(true);
    log.info('[Background] Service Worker initialized with DI');

    // 2. Setup Alarms for background synchronization (BUG-005 fix)
    chrome.alarms.create('sync_queue_process', {
      periodInMinutes: 5,
      delayInMinutes: 1
    });

    log.debug('[Background] Operational alarms configured');
  } catch (err) {
    console.error('[Background] Critical initialization failure', err);
  }
}

/**
 * Message Dispatcher
 * Routes runtime messages to the appropriate unified services.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  log.debug(`[Background] Router: Received ${message.type}`);

  // Resolve services lazily to ensure DI is ready
  const auth = container.resolve<AuthService>(TOKENS.AuthService);
  const queue = container.resolve<ISyncQueueService>(TOKENS.SyncQueue);

  switch (message.type) {
    case MSG.AUTH_LOGIN:
      auth.performOAuthLogin().then(sendResponse);
      return true;

    case MSG.AUTH_LOGOUT:
      auth.performLogout().then(sendResponse);
      return true;

    case MSG.AUTH_STATUS:
      auth.getStatus().then(sendResponse);
      return true;

    case 'SYNC_QUEUE_PROCESS':
      queue.process().then(() => sendResponse({ success: true }));
      return true;

    default:
      log.warn(`[Background] Router: Unknown message type ${message.type}`);
      sendResponse({ success: false, error: 'Unknown message type' });
      return false;
  }
});

/**
 * Alarm Dispatcher (Background Tasks)
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync_queue_process') {
    log.info('[Background] Alarm: Triggering scheduled sync cycle...');
    const queue = container.resolve<ISyncQueueService>(TOKENS.SyncQueue);
    queue.process().catch(err => log.error('[Background] Alarm: Scheduled sync failed', err));
  }
});

// Start initialization
initializeBackground();

// Redirect URL info (Dev Diagnostic)
if (import.meta.env.DEV) {
  const redirectURL = chrome.identity.getRedirectURL();
  console.log('%c[Astra] OAUTH REDIRECT URI: ' + redirectURL, 'color: #3dbbee; font-weight: bold;');
}
