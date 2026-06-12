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
      delayInMinutes: 1,
    });

    log.debug('[Background] Operational alarms configured');
  } catch (err) {
    console.error('[Background] Critical initialization failure', err);
  }
}

// Start DI initialization once; the message router awaits this promise so it
// never resolves services before setupDI() has completed (MV3 cold-start race).
const backgroundReady = initializeBackground();

/**
 * Message Dispatcher
 * Routes runtime messages to the appropriate unified services.
 *
 * IMPORTANT (MV3 cold-start race): the service worker can be woken by an
 * incoming message before setupDI() has finished. We therefore wait on
 * `backgroundReady` before resolving any DI service, and keep the message
 * channel open by returning `true` synchronously.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  log.debug(`[Background] Router: Received ${message?.type}`);

  // Validate the message shape at the boundary.
  if (!message || typeof message.type !== 'string') {
    sendResponse({ success: false, error: 'Invalid message' });
    return false;
  }

  backgroundReady
    .then(() => {
      const auth = container.resolve<AuthService>(TOKENS.AuthService);
      const queue = container.resolve<ISyncQueueService>(TOKENS.SyncQueue);

      switch (message.type) {
        case MSG.AUTH_LOGIN:
          return auth.performOAuthLogin().then(sendResponse);

        case MSG.AUTH_LOGOUT:
          return auth.performLogout().then(sendResponse);

        case MSG.AUTH_STATUS:
          return auth.getStatus().then(sendResponse);

        case 'SYNC_QUEUE_PROCESS':
          return queue.process().then(() => sendResponse({ success: true }));

        default:
          log.warn(`[Background] Router: Unknown message type ${message.type}`);
          sendResponse({ success: false, error: 'Unknown message type' });
          return undefined;
      }
    })
    .catch((err) => {
      log.error('[Background] Failed to handle message', err);
      sendResponse({ success: false, error: 'Background initialization failed' });
    });

  return true; // Keep the message channel open for the async response.
});

/**
 * Alarm Dispatcher (Background Tasks)
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync_queue_process') {
    log.info('[Background] Alarm: Triggering scheduled sync cycle...');
    const queue = container.resolve<ISyncQueueService>(TOKENS.SyncQueue);
    queue.process().catch((err) => log.error('[Background] Alarm: Scheduled sync failed', err));
  }
});

// Redirect URL info (Dev Diagnostic)
if (import.meta.env.DEV) {
  const redirectURL = chrome.identity.getRedirectURL();
  console.log('%c[Astra] OAUTH REDIRECT URI: ' + redirectURL, 'color: #3dbbee; font-weight: bold;');
}
