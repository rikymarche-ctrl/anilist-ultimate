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
import { logger } from '@core/logger';
import { STORAGE_PREFIX } from '@core/constants';
import { setupDI } from './setup';
import type { ISyncQueueService } from '@core/interfaces/ISyncQueueService';
import type { AuthService } from '@core/auth/AuthService';
import { createBackgroundMessageHandler } from '@core/services/BackgroundRouter';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { broadcastLocalStorageChanges } from '@core/storage/LocalStorageBridge';
import { AstraRepositoryHost } from '@/modules/astra/store/AstraRepositoryHost';
import type { ConfigManager } from '@core/config/ConfigManager';
import { CustomListHost } from '@/modules/social/CustomListHost';
import { FriendAlertsHost } from '@/modules/notifications/FriendAlertsHost';
import { FRIEND_ALERTS_ALARM } from '@/modules/notifications/FriendAlerts';

/**
 * Keep an alarm's schedule across worker restarts: re-creating it resets its next fire time, so it
 * is registered only when missing or when its period differs.
 */
async function registerAlarm(name: string, periodInMinutes: number): Promise<void> {
  const existing = await chrome.alarms.get(name);
  if (existing?.periodInMinutes === periodInMinutes) return;
  await chrome.alarms.create(name, { periodInMinutes, delayInMinutes: 1 });
}

/**
 * Initialize Background context
 */
async function initializeBackground(): Promise<void> {
  try {
    // Firefox has no setAccessLevel: there content scripts can always read storage.local
    // (web pages still cannot), so the barrier resolves immediately.
    const storageReady = typeof chrome.storage.local.setAccessLevel === 'function'
      ? chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
      : Promise.resolve();
    // 1. Initialize DI Container for Background context
    await setupDI(true, storageReady);
    logger.info('[Background] Service Worker initialized with DI');

    // 2. Setup Alarms for background synchronization (BUG-005 fix)
    void registerAlarm('sync_queue_process', 5)
      .catch((error: unknown) => logger.error('[Background] Alarm registration failed', error));
    void registerAlarm(FRIEND_ALERTS_ALARM, 5)
      .catch((error: unknown) => logger.error('[Background] Alarm registration failed', error));

    logger.debug('[Background] Operational alarms configured');

    // Earlier builds persisted the follower cache to disk; it is now memory-only (privacy).
    void Promise.resolve().then(() => chrome.storage.local.remove(`${STORAGE_PREFIX}cache_social_followers`))
      .catch((error: unknown) => logger.error('[Background] Legacy follower cache cleanup failed', error));
  } catch (err) {
    logger.error('[Background] Critical initialization failure', err);
    throw err;
  }
}

// Readiness is retryable: a failed DI setup is retried by the next message or alarm instead of
// staying rejected for the whole worker lifetime. Callers share the attempt already in flight.
let initialization: Promise<void> | null = null;

function ensureBackgroundReady(): Promise<void> {
  if (initialization) return initialization;
  const attempt = initializeBackground();
  initialization = attempt;
  attempt.catch(() => {
    if (initialization === attempt) initialization = null;
  });
  return attempt;
}

// Start DI initialization once; the message router awaits readiness so it
// never resolves services before setupDI() has completed (MV3 cold-start race).
void ensureBackgroundReady();

// The router awaits readiness once per message, so this thenable re-enters
// ensureBackgroundReady() on every message; BackgroundRouter itself is unchanged.
const routerReady = {
  then: (onFulfilled?: ((value: void) => unknown) | null, onRejected?: ((reason: unknown) => unknown) | null) =>
    ensureBackgroundReady().then(onFulfilled, onRejected),
} as unknown as Promise<void>;

/**
 * Message Dispatcher
 * Routes runtime messages to the appropriate unified services.
 *
 * IMPORTANT (MV3 cold-start race): the service worker can be woken by an
 * incoming message before setupDI() has finished. We therefore wait on
 * readiness (`routerReady`) before resolving any DI service, and keep the message
 * channel open by returning `true` synchronously.
 */
chrome.runtime.onMessage.addListener(createBackgroundMessageHandler(
  routerReady,
  () => container.resolve<AuthService>(TOKENS.AuthService),
  () => container.resolve<ISyncQueueService>(TOKENS.SyncQueue),
  () => container.resolve<IApiClient>(TOKENS.ApiClient),
  () => container.resolve(AstraRepositoryHost),
  () => container.resolve<ConfigManager>(TOKENS.Config),
  () => container.resolve(CustomListHost),
  () => container.resolve(FriendAlertsHost),
));
chrome.storage.onChanged.addListener(broadcastLocalStorageChanges);

/**
 * Alarm Dispatcher (Background Tasks)
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FRIEND_ALERTS_ALARM) {
    void ensureBackgroundReady().then(() => container.resolve(FriendAlertsHost).poll())
      .catch((err) => logger.error('[Background] Friend alerts check failed', err));
  }
  if (alarm.name === 'sync_queue_process') {
    logger.info('[Background] Alarm: Triggering scheduled sync cycle...');
    void ensureBackgroundReady().then(() => container.resolve<ISyncQueueService>(TOKENS.SyncQueue).process())
      .catch((err) => logger.error('[Background] Alarm: Scheduled sync failed', err));
  }
});

// Redirect URL info (Dev Diagnostic)
if (import.meta.env.DEV) {
  const redirectURL = chrome.identity.getRedirectURL();
  logger.debug('%c[Astra] OAUTH REDIRECT URI: ' + redirectURL, 'color: #3dbbee; font-weight: bold;');
}
