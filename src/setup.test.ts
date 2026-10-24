import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDI } from './setup';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import type { ErrorHandler } from '@core/errors/ErrorHandler';
import { AuthTokenService } from '@core/auth/AuthTokenService';
import { AUTH_SESSION_KEY, AUTH_USER_CACHE_KEY, AUTH_STORAGE_KEY } from '@shared/messages';
import type { AuthService } from '@core/auth/AuthService';
import { CustomListClient } from './modules/social/CustomListClient';
import { ConfigClient } from '@core/config/ConfigClient';
import { AuthStateClient } from '@core/auth/AuthStateClient';
import { PreferencesService } from '@core/services/PreferencesService';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { CacheFactory } from '@core/cache/CacheFactory';
import { AstraRepositoryClient } from './modules/astra/store/AstraRepositoryClient';
import { AstraRepository } from './modules/astra/store/AstraRepository';
import { AstraRepositoryHost } from './modules/astra/store/AstraRepositoryHost';
import type { AstraWork } from './modules/astra/AstraInterfaces';

describe('MV3 composition root', () => {
  beforeEach(() => {
    container.reset();
    chrome.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() } as never;
    const durable: Record<string, unknown> = {};
    chrome.storage.local.get = vi.fn(async (requested: string | string[] | null) => {
      const keys =
        requested === null
          ? Object.keys(durable)
          : typeof requested === 'string'
            ? [requested]
            : requested;
      return Object.fromEntries(
        keys.filter((key) => key in durable).map((key) => [key, durable[key]])
      );
    }) as unknown as typeof chrome.storage.local.get;
    chrome.storage.local.set = vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(durable, values);
    }) as typeof chrome.storage.local.set;
    chrome.storage.sync.get = vi.fn(async () => ({})) as typeof chrome.storage.sync.get;
  });
  afterEach(() => {
    if (container.isRegistered(TOKENS.ErrorHandler))
      container.resolve<ErrorHandler>(TOKENS.ErrorHandler).destroy();
    container.reset();
    vi.restoreAllMocks();
  });

  it('checks automatic Notes permission against the current account settings and the latest durable work', async () => {
    await setupDI(true);
    const auth = container.resolve<AuthTokenService>(TOKENS.AuthTokenService);
    await auth.setToken('synthetic-test-token', { userId: 42, userName: 'Synthetic' });
    const host = container.resolve(AstraRepositoryHost);
    const policy = container.resolve<
      (mediaId: number, updatedAt: number, sessionId: string) => Promise<boolean>
    >(TOKENS.AstraNotesSyncPolicy);
    const session = auth.getSessionId();
    try {
      const saved = (await host.dispatch(
        'saveWork',
        [{ mediaId: 7, notes: 'Review' }],
        session
      )) as AstraWork;
      expect(await policy(7, saved.updatedAt, session)).toBe(false);
      await host.dispatch('updateSettings', [{ appendAstraToComment: true }], session);
      expect(await policy(7, saved.updatedAt, session)).toBe(true);
      const next = (await host.dispatch(
        'saveWork',
        [{ ...saved, notes: 'Newer review' }],
        session
      )) as AstraWork;
      expect(await policy(7, saved.updatedAt, session)).toBe(false);
      expect(await policy(7, next.updatedAt, session)).toBe(true);
      await host.dispatch('updateSettings', [{ appendAstraToComment: false }], session);
      expect(await policy(7, next.updatedAt, session)).toBe(false);
      await host.dispatch('updateSettings', [{ detailedScoring: false }], session);
      const snapshot = (await host.dispatch('getSnapshot', [], session)) as {
        settings: { detailedScoring?: boolean };
      };
      expect(snapshot.settings.detailedScoring).toBe(false);
      await auth.setToken('other-synthetic-token', { userId: 43, userName: 'Other synthetic' });
      await expect(policy(7, next.updatedAt, session)).rejects.toThrow('account changed');
    } finally {
      auth.dispose();
    }
  });

  it('installs global listeners synchronously while durable reads wait for access restriction', async () => {
    const listeners = vi.spyOn(self, 'addEventListener');
    let allowStorage!: () => void;
    const barrier = new Promise<void>((resolve) => {
      allowStorage = resolve;
    });
    const initialized = setupDI(true, barrier);

    expect(listeners).toHaveBeenCalledWith('error', expect.any(Function));
    expect(listeners).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
    expect(chrome.storage.sync.get).not.toHaveBeenCalled();

    allowStorage();
    await initialized;
    expect(chrome.storage.local.get).toHaveBeenCalled();
    expect(chrome.storage.sync.get).toHaveBeenCalled();
    const auth = container.resolve<AuthTokenService>(TOKENS.AuthTokenService);
    expect(auth.getSessionId()).toEqual(expect.any(String));
    expect(auth.getSessionId().length).toBeGreaterThan(0);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [AUTH_SESSION_KEY]: auth.getSessionId(),
    });
    expect(auth.hasToken()).toBe(false);
  });

  it('refuses to read account data when the storage restriction fails', async () => {
    let rejectStorage!: (error: Error) => void;
    const barrier = new Promise<void>((_, reject) => {
      rejectStorage = reject;
    });
    const initialized = setupDI(true, barrier);
    rejectStorage(new Error('Access-level failure'));
    await expect(initialized).rejects.toThrow('Access-level failure');
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(chrome.storage.sync.get).not.toHaveBeenCalled();
  });

  it.each(['full', 'partial'] as const)(
    'defers %s native auth changes until the storage restriction is ready',
    async (mode) => {
      let release!: () => void;
      const initialized = setupDI(
        true,
        new Promise<void>((resolve) => {
          release = resolve;
        })
      );
      const auth = container.resolve<AuthTokenService>(TOKENS.AuthTokenService);
      const emit = vi.spyOn(container.resolve<EventBus>(TOKENS.EventBus), 'emit');
      const values: Record<string, unknown> =
        mode === 'full'
          ? {
              [AUTH_STORAGE_KEY]: 'gate-token',
              [AUTH_USER_CACHE_KEY]: { userId: 7, userName: 'Gate owner' },
              [AUTH_SESSION_KEY]: 'gate-session',
            }
          : { [AUTH_USER_CACHE_KEY]: { userId: 7, userName: 'Gate owner' } };
      const listener = (
        auth as unknown as {
          storageListener: Parameters<typeof chrome.storage.onChanged.addListener>[0];
        }
      ).storageListener;
      try {
        await chrome.storage.local.set(values);
        listener(
          Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])),
          'local'
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
        expect(auth.hasToken()).toBe(false);
        expect(auth.getUserCache()).toBeNull();
        expect(emit).not.toHaveBeenCalledWith(EVENT_TYPES.AUTH_STATE_CHANGED, expect.anything());
        release();
        await initialized;
        expect(auth.getUserCache()).toEqual(
          mode === 'full' ? { userId: 7, userName: 'Gate owner' } : null
        );
      } finally {
        release();
        await initialized.catch(() => undefined);
        auth.dispose();
      }
    }
  );

  it.each([
    [AUTH_USER_CACHE_KEY, { userId: '7', userName: {} }],
    [AUTH_SESSION_KEY, 17],
  ])(
    'starts the background anonymously when persisted %s is corrupt, preserving its input',
    async (key, malformed) => {
      await chrome.storage.local.set({ [key as string]: malformed });
      await setupDI(true);
      const auth = container.resolve<AuthTokenService>(TOKENS.AuthTokenService);
      const status = await container.resolve<AuthService>(TOKENS.AuthService).getStatus();
      expect(status).toEqual({ authenticated: false });
      expect(auth.hasToken()).toBe(false);
      expect(auth.getUserCache()).toBeNull();
      expect((await chrome.storage.local.get(key as string))[key as string]).toEqual(malformed);
      auth.dispose();
    }
  );

  it('constructs the background auth singleton in its owner before a feature borrows it', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const initialized = setupDI(true, barrier);
    const disposing = vi.spyOn(AuthTokenService.prototype, 'dispose');
    const child = container.createChildContainer();
    const auth = child.resolve<AuthTokenService>(TOKENS.AuthTokenService);
    try {
      await child.dispose();
      expect(disposing).not.toHaveBeenCalled();
      expect(container.resolve(TOKENS.AuthTokenService)).toBe(auth);
      release();
      await initialized;
      await auth.ensureInitialized();
      expect(auth.getSessionId()).not.toBe('');
    } finally {
      release();
      await initialized.catch(() => undefined);
      auth.dispose();
    }
  });

  it('owns the shared cache factory before the first feature borrows it', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const initialized = setupDI(true, barrier);
    const feature = container.createChildContainer();
    const factory = feature.resolve(CacheFactory);
    const cache = factory.create<string, number>({
      namespace: 'ownership_probe',
      persistent: false,
    });
    try {
      await cache.set('active', 7);
      await feature.dispose();
      expect(container.resolve(CacheFactory)).toBe(factory);
      expect(await cache.get('active')).toBe(7);
      release();
      await initialized;
      factory.dispose();
      expect(cache.size()).toBe(0);
      await expect(cache.get('active')).rejects.toThrow('disposed');
    } finally {
      release();
      await initialized.catch(() => undefined);
      factory.dispose();
      container.resolve<AuthTokenService>(TOKENS.AuthTokenService).dispose();
    }
  });

  it('owns the custom-list singleton and releases its exact listeners when its container is disposed', async () => {
    const scope = container.createChildContainer();
    const bus = new EventBus();
    scope.registerInstance(TOKENS.EventBus, bus);
    scope.registerInstance(TOKENS.AuthTokenService, {
      getSessionId: () => 'synthetic',
      ensureInitialized: async () => {},
    });
    // As in setupDI, construct in the document owner before a feature scope borrows it.
    scope.registerSingleton(TOKENS.CustomListService, CustomListClient);
    const client = scope.resolve<CustomListClient>(TOKENS.CustomListService);
    const runtimeCalls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
    const runtimeListener = runtimeCalls[runtimeCalls.length - 1][0];
    const storageCalls = vi.mocked(chrome.storage.onChanged.addListener).mock.calls;
    const storageListener = storageCalls[storageCalls.length - 1][0];
    expect(scope.resolve(TOKENS.CustomListService)).toBe(client);
    expect(bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(1);
    const featureScope = scope.createChildContainer();
    expect(featureScope.resolve(TOKENS.CustomListService)).toBe(client);
    await featureScope.dispose();
    expect(bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(1);
    expect(chrome.runtime.onMessage.removeListener).not.toHaveBeenCalledWith(runtimeListener);
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({
      success: true,
      data: { Friends: [] },
    } as never);
    await client.init();
    expect(client.getLists()).toEqual({ Friends: [] });
    await scope.dispose();
    expect(bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0);
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(runtimeListener);
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(storageListener);
    await expect(client.init()).rejects.toThrow('disposed');
    expect(client.getLists()).toEqual({});
  });

  it('constructs the foreground custom-list client in its document owner before a feature scope can resolve it', async () => {
    let rejectStorage!: (error: Error) => void;
    const barrier = new Promise<void>((_, reject) => {
      rejectStorage = reject;
    });
    void barrier.catch(() => undefined);
    const initialized = setupDI(false, barrier);
    const startupFailure = expect(initialized).rejects.toThrow('Synthetic foreground barrier');
    const retiring = vi.spyOn(CustomListClient.prototype, 'dispose');
    const retiringConfig = vi.spyOn(ConfigClient.prototype, 'dispose');
    const retiringAuth = vi.spyOn(AuthStateClient.prototype, 'dispose');
    const retiringPreferences = vi.spyOn(PreferencesService.prototype, 'dispose');
    const retiringRepository = vi.spyOn(AstraRepositoryClient.prototype, 'dispose');
    const featureScope = container.createChildContainer();
    let client: CustomListClient | undefined;
    try {
      // A feature is deliberately the first caller after setup's synchronous registrations.
      client = featureScope.resolve<CustomListClient>(TOKENS.CustomListService);
      const config = featureScope.resolve<ConfigClient>(TOKENS.Config);
      const auth = featureScope.resolve<AuthStateClient>(TOKENS.AuthTokenService);
      const preferences = featureScope.resolve<PreferencesService>(TOKENS.PreferencesService);
      const repository = featureScope.resolve(AstraRepositoryClient);
      await featureScope.dispose();
      expect(retiring).not.toHaveBeenCalled();
      expect(retiringConfig).not.toHaveBeenCalled();
      expect(retiringAuth).not.toHaveBeenCalled();
      expect(retiringPreferences).not.toHaveBeenCalled();
      expect(retiringRepository).not.toHaveBeenCalled();
      expect(container.resolve(AstraRepository)).toBe(repository);
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
      expect(container.resolve(TOKENS.Config)).toBe(config);
      expect(container.resolve(TOKENS.AuthTokenService)).toBe(auth);
      expect(container.resolve(TOKENS.PreferencesService)).toBe(preferences);
      config.dispose();
      auth.dispose();
      preferences.dispose();
      repository.dispose();
      expect(container.resolve(TOKENS.CustomListService)).toBe(client);
    } finally {
      client?.dispose();
      rejectStorage(new Error('Synthetic foreground barrier'));
      await startupFailure;
    }
  });
});
