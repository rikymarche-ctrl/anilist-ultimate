/** Full foreground composition in an isolated bundle/container over real logged-out extension RPC. */
import 'reflect-metadata';
import { setupDI } from '@/setup';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MSG, AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY } from '@shared/messages';
import { ThemeManager } from '@core/ThemeManager';
import type { EventBus } from '@core/events/EventBus';
import type { AuthStateClient } from '@core/auth/AuthStateClient';
import type { AuthService } from '@core/auth/AuthService';
import type { ConfigClient } from '@core/config/ConfigClient';
import type { PreferencesService } from '@core/services/PreferencesService';
import type { CustomListClient } from '@modules/social/CustomListClient';
import type { NavigationService } from '@core/navigation/NavigationService';
import type { ToastService } from '@core/services/ToastService';
import type { NativeUiSyncService } from '@core/services/NativeUiSyncService';
import type { SocialMaskingService } from '@core/services/SocialMaskingService';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import type { ErrorHandler } from '@core/errors/ErrorHandler';
import { CacheFactory } from '@core/cache/CacheFactory';
import { AstraDashboard } from '@modules/astra/ui/AstraDashboard';
import { AstraOverlayService } from '@modules/astra/services/AstraOverlayService';
import { AstraNavigationService } from '@modules/astra/services/AstraNavigationService';
import { AstraUIBridge } from '@modules/astra/services/AstraUIBridge';
import { AstraService } from '@modules/astra/AstraService';
import { AstraDashboardStore } from '@modules/astra/store/AstraDashboardStore';
import { AstraRepositoryClient } from '@modules/astra/store/AstraRepositoryClient';
import type { AnilistClientProxy } from '@/api/AnilistClientProxy';
import { parseAstraBackup } from '@modules/astra/store/AstraBackup';
import { MediaListStatus } from '@/api/AnilistTypes';

export async function runForegroundBrowserFixture(): Promise<string[]> {
  const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  const checks: string[] = [];
  let initialized = false;
  let disposed = false;
  try {
    await setupDI(false);
    initialized = true;
    const auth = container.resolve<AuthStateClient>(TOKENS.AuthTokenService);
    const config = container.resolve<ConfigClient>(TOKENS.Config);
    const preferences = container.resolve<PreferencesService>(TOKENS.PreferencesService);
    const authListeners = auth as unknown as {
      runtimeListener: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
      storageListener: Parameters<typeof chrome.storage.onChanged.addListener>[0];
    };
    assert(!auth.hasToken() && auth.getToken() === null && auth.getUserCache() === null
      && typeof auth.getSessionId() === 'string', 'foreground startup must use the real logged-out public session');
    assert(chrome.runtime.onMessage.hasListener(authListeners.runtimeListener)
      && chrome.storage.onChanged.hasListener(authListeners.storageListener), 'public auth client must own its exact native listeners');
    await config.applyPatch({ theme: { accentColor: '#123456' } });
    await config.load();
    assert(config.get('theme').accentColor === '#123456', 'public config patch must round-trip through the real background');
    checks.push('full foreground setup completes real auth/config RPC, registers factories and starts shared services while logged out');

    const beforeLogout = auth.getSessionId();
    await container.resolve<AuthService>(TOKENS.AuthService).logout();
    const logoutStorage: Record<string, unknown> = await chrome.storage.local.get([AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY]);
    assert(!auth.hasToken() && auth.getUserCache() === null && typeof auth.getSessionId() === 'string'
      && auth.getSessionId() !== beforeLogout && logoutStorage[AUTH_SESSION_KEY] === auth.getSessionId()
      && (logoutStorage[AUTH_STORAGE_KEY] === undefined || logoutStorage[AUTH_STORAGE_KEY] === null)
      && (logoutStorage[AUTH_USER_CACHE_KEY] === undefined || logoutStorage[AUTH_USER_CACHE_KEY] === null),
    'public logout must confirm a fresh anonymous session through actual worker RPC and native storage');
    checks.push('client logout validates the real worker confirmation and refreshes its anonymous native-storage session');

    // Corrupt only this synthetic profile's public account metadata. Credentials
    // remain absent; restore each key before the other foreground scenarios.
    const originalSession = auth.getSessionId();
    for (const [key, malformed] of [[AUTH_USER_CACHE_KEY, { userId: '7', userName: {} }], [AUTH_SESSION_KEY, 17]] as const) {
      const saved: Record<string, unknown> = await chrome.storage.local.get(key);
      try {
        await chrome.storage.local.set({ [key]: malformed });
        let failedClosed = false;
        for (let attempt = 0; attempt < 50 && !failedClosed; attempt++) {
          try { await auth.refresh(); } catch { /* A failed RPC also invalidates the public metadata. */ }
          failedClosed = !auth.hasToken() && auth.getUserCache() === null && auth.getSessionId() === undefined;
          if (!failedClosed) await new Promise<void>(resolve => setTimeout(resolve, 20));
        }
        assert(failedClosed, 'malformed native storage must fail closed without retaining an owner/session');
        const preserved: Record<string, unknown> = await chrome.storage.local.get(key);
        assert(JSON.stringify(preserved[key]) === JSON.stringify(malformed), 'corruption handling must preserve the persisted input');
      } finally {
        if (Object.prototype.hasOwnProperty.call(saved, key)) await chrome.storage.local.set({ [key]: saved[key] });
        else await chrome.storage.local.remove(key);
      }
      let recovered = false;
      for (let attempt = 0; attempt < 50 && !recovered; attempt++) {
        try { await auth.refresh(); recovered = auth.getSessionId() === originalSession && !auth.hasToken(); } catch { /* Storage signals may still be settling. */ }
        if (!recovered) await new Promise<void>(resolve => setTimeout(resolve, 20));
      }
      assert(recovered && auth.getUserCache() === null, 'restoring native metadata must recover the original logged-out session');
      checks.push(key === AUTH_USER_CACHE_KEY
        ? 'corrupt native owner metadata fails closed without persistence changes and recovers after restoration'
        : 'corrupt native session metadata fails closed without persistence changes and recovers after restoration');
    }

    const cacheFactory = container.resolve(CacheFactory);
    const lifecycleCache = cacheFactory.create<string, number>({ namespace: 'reviews_session', persistent: false });
    await lifecycleCache.set('lifetime-probe', 7);
    const client = container.resolve<CustomListClient>(TOKENS.CustomListService);
    assert(container.resolve(TOKENS.CustomListService) === client, 'actual composition must resolve one document list client');
    await client.init();
    await client.createList('Foreground synthetic fixture');
    await client.toggleUserInList('Foreground synthetic fixture', { id: 42, name: 'Synthetic local user', avatar: '' }, true);
    await client.init();
    const persisted = await chrome.storage.local.get('custom_lists_account_local');
    assert(client.getList('Foreground synthetic fixture')[0]?.id === 42
      && persisted.custom_lists_account_local?.['Foreground synthetic fixture']?.[0]?.name === 'Synthetic local user',
    'local workspace list RPC must round-trip through the real background and native storage');
    checks.push('foreground custom-list singleton initializes and persists synthetic local membership through real background RPC/storage');

    const listeners = client as unknown as {
      runtimeListener: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
      storageListener: Parameters<typeof chrome.storage.onChanged.addListener>[0];
    };
    assert(chrome.runtime.onMessage.hasListener(listeners.runtimeListener)
      && chrome.storage.onChanged.hasListener(listeners.storageListener), 'exact client listeners must be registered in native Chrome');
    const child = container.createChildContainer();
    const astraOwners = [AstraDashboard, AstraOverlayService, AstraNavigationService, AstraUIBridge,
      AstraService, AstraDashboardStore, AstraRepositoryClient] as const;
    for (const token of astraOwners) {
      assert(child.resolve<unknown>(token) === container.resolve<unknown>(token), 'feature must borrow document-owned Astra resources');
    }
    const dashboard = container.resolve(AstraDashboard);
    const overlayService = container.resolve(AstraOverlayService);
    const bridge = container.resolve(AstraUIBridge);
    const repository = container.resolve(AstraRepositoryClient);
    const astraStore = container.resolve(AstraDashboardStore);
    const astraService = container.resolve(AstraService);
    const bus = container.resolve<EventBus>(TOKENS.EventBus);
    assert(child.resolve(TOKENS.CustomListService) === client, 'feature scope must borrow the document-owned client');
    assert(child.resolve(TOKENS.Config) === config && child.resolve(TOKENS.AuthTokenService) === auth
      && child.resolve(TOKENS.PreferencesService) === preferences && child.resolve(CacheFactory) === cacheFactory,
    'feature scope must borrow all document-owned shared clients and cache factory');
    await child.dispose(); await client.init();
    dashboard.activate();
    assert(bus.listenerCount(EVENT_TYPES.ASTRA_OPEN) === 1, 'borrowed dashboard must remain activatable after feature disposal');
    bridge.initGlobalListeners();
    const bridgeListeners = bridge as unknown as { openHandler: EventListener; clickHandler: EventListener };
    const copiedOpenHandler = bridgeListeners.openHandler;
    const probeOverlay = overlayService.create('ownership-probe');
    assert(probeOverlay.isConnected && document.body.style.overflow === 'hidden', 'borrowed overlay must remain usable');
    await repository.init();
    const dateProbeId = 42424243;
    const dateProbe = await repository.saveWork({ mediaId: dateProbeId, title: 'Synthetic local dates', type: 'anime',
      status: MediaListStatus.COMPLETED, startedAt: { year: 2026, month: null, day: 5 }, completedAt: null });
    const dateSummary = repository.getWorks().find(work => work.mediaId === dateProbeId);
    assert(dateProbe.startedAt?.year === 2026 && dateSummary?.startedAt?.day === 5 && dateSummary.completedAt === null,
      'real worker save and summary must preserve fuzzy dates and explicit Clear');
    const exported = await repository.exportJSON();
    const backup = parseAstraBackup(exported);
    assert(backup.works[String(dateProbeId)].startedAt?.month === null && await repository.importJSON(exported),
      'real worker backup must accept and preserve optional date fields');
    const reopened = await repository.getFullWork(dateProbeId);
    assert(reopened?.startedAt?.year === 2026 && reopened.startedAt.day === 5 && reopened.completedAt === null,
      'reopened work must retain fuzzy date components');
    await repository.saveWork({ mediaId: dateProbeId, startedAt: null });
    assert(repository.getWorks().find(work => work.mediaId === dateProbeId)?.startedAt === null,
      'explicit Clear must replace the saved date through actual worker RPC');
    await repository.deleteWork(dateProbeId);
    checks.push('foreground Astra date save/summary/export/import/reopen/Clear round-trips through real worker RPC and native storage');
    await auth.ensureInitialized(); await config.load();
    assert(await lifecycleCache.get('lifetime-probe') === 7, 'feature disposal must preserve the document-owned cache');
    assert(chrome.runtime.onMessage.hasListener(listeners.runtimeListener) && client.getList('Foreground synthetic fixture').length === 1,
      'feature scope disposal must leave the shared client usable');
    checks.push('actual feature child disposal preserves document-owned custom-list/cache/Astra components and their native listeners');

    cleanupSharedServices();
    await container.dispose();
    disposed = true;
    assert(!chrome.runtime.onMessage.hasListener(listeners.runtimeListener)
      && !chrome.storage.onChanged.hasListener(listeners.storageListener)
      && bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED) === 0 && Object.keys(client.getLists()).length === 0,
    `owning container disposal must release exact native listeners, shared auth subscriptions and snapshots: runtime=${chrome.runtime.onMessage.hasListener(listeners.runtimeListener)}, storage=${chrome.storage.onChanged.hasListener(listeners.storageListener)}, auth=${bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)}, lists=${Object.keys(client.getLists()).length}`);
    assert(!probeOverlay.isConnected && document.body.style.overflow !== 'hidden'
      && bus.listenerCount(EVENT_TYPES.ASTRA_OPEN) === 0
      && [EVENT_TYPES.ASTRA_DATA_UPDATED, EVENT_TYPES.PROGRESS_UPDATED, EVENT_TYPES.ASTRA_SYNC_COMPLETE]
        .every(event => bus.listenerCount(event) === 0)
      && astraStore.getState().filteredWorks.length === 0 && repository.getWorks().length === 0,
    'document disposal must release Astra overlays, subscriptions and private snapshots');
    dashboard.activate(); bridge.initGlobalListeners(); copiedOpenHandler(new Event('astra:open'));
    assert(bus.listenerCount(EVENT_TYPES.ASTRA_OPEN) === 0, 'retired dashboard and bridge must remain inert');
    assert(lifecycleCache.size() === 0, 'owning cache factory disposal must release retained private values');
    let cacheRetired = false;
    try { await lifecycleCache.get('lifetime-probe'); } catch (error) {
      cacheRetired = error instanceof Error && error.message.includes('disposed');
    }
    assert(cacheRetired, 'retired document cache must reject operations');
    assert(!chrome.runtime.onMessage.hasListener(authListeners.runtimeListener)
      && !chrome.storage.onChanged.hasListener(authListeners.storageListener) && auth.getSessionId() === undefined,
    'owning container disposal must retire public auth metadata and native listeners');
    for (const operation of [() => auth.refresh(), () => config.load(), () => config.applyPatch({ theme: { accentColor: '#abcdef' } }),
      () => repository.init(), () => astraService.init()]) {
      let rejected = false;
      try { await operation(); } catch (error) { rejected = error instanceof Error && error.message.includes('disposed'); }
      assert(rejected, 'retired shared client must reject further operations');
    }
    let retired = false;
    try { await client.createList('Retired foreground fixture'); } catch (error) {
      retired = error instanceof Error && error.message.includes('disposed');
    }
    assert(retired, 'retired singleton must reject new operations');
    const status: unknown = await chrome.runtime.sendMessage({ type: MSG.AUTH_STATUS });
    assert(!!status && typeof status === 'object' && 'authenticated' in status && status.authenticated === false,
      'real extension message API must remain usable after isolated-container disposal');
    bus.clear();
    checks.push('document container disposal releases exact auth/list/config/cache/Astra resources and keeps the real extension RPC usable');
    return checks;
  } finally {
    // Remaining shared services are isolated; closing this dedicated target completes teardown.
    if (!disposed) {
      try { if (initialized) cleanupSharedServices(); await container.dispose(); } catch { /* Dedicated target teardown completes cleanup. */ }
    }
  }
}

function cleanupSharedServices(): void {
  container.resolve<AnilistClientProxy>(TOKENS.ApiClient).destroy();
  container.resolve<NavigationService>(TOKENS.NavigationService).stop();
  container.resolve<SocialMaskingService>(TOKENS.SocialMaskingService).destroy();
  container.resolve<NativeUiSyncService>(TOKENS.NativeUiSyncService).destroy();
  container.resolve<ToastService>(TOKENS.ToastService).destroy();
  container.resolve(ThemeManager).destroy();
  container.resolve<SharedGlobalObserver>(TOKENS.SharedGlobalObserver).destroy();
  container.resolve<ErrorHandler>(TOKENS.ErrorHandler).destroy();
}
