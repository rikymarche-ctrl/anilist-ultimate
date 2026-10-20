import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setupDI: vi.fn<(isBackground?: boolean, storageReady?: Promise<void>) => Promise<void>>(),
  createBackgroundMessageHandler: vi.fn<(...args: unknown[]) => unknown>(),
  container: { resolve: vi.fn<(token: unknown) => unknown>() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), success: vi.fn() },
}));

vi.mock('./setup', () => ({ setupDI: mocks.setupDI }));
vi.mock('@core/di/container', () => ({ container: mocks.container }));
vi.mock('@core/logger', () => ({ logger: mocks.logger }));
vi.mock('@core/services/BackgroundRouter', () => ({
  createBackgroundMessageHandler: mocks.createBackgroundMessageHandler,
}));
vi.mock('@core/storage/LocalStorageBridge', () => ({ broadcastLocalStorageChanges: vi.fn() }));
vi.mock('@/modules/astra/store/AstraRepositoryHost', () => ({ AstraRepositoryHost: class {} }));
vi.mock('@/modules/social/CustomListHost', () => ({ CustomListHost: class {} }));
vi.mock('@/modules/notifications/FriendAlertsHost', () => ({ FriendAlertsHost: class {} }));
vi.mock('@/modules/notifications/FriendAlerts', () => ({ FRIEND_ALERTS_ALARM: 'friend_alerts' }));

/** Let pending promise chains (alarm registration, readiness rejection bookkeeping) settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function installChromeStubs(): void {
  Object.assign(chrome, {
    identity: { getRedirectURL: vi.fn(() => 'https://example.test/redirect') },
    alarms: {
      create: vi.fn(async () => undefined),
      get: vi.fn(async () => undefined),
      onAlarm: { addListener: vi.fn() },
    },
  });
  Object.assign(chrome.storage, { onChanged: { addListener: vi.fn() } });
  Object.assign(chrome.storage.local, { setAccessLevel: vi.fn(async () => undefined) });
}

/** Loads a fresh worker module (module-level side effects run once per load). */
async function loadWorker(): Promise<void> {
  vi.resetModules();
  await import('./background');
  await settle();
}

/** The router receives the readiness thenable as its first argument. */
function routerReady(): PromiseLike<void> {
  const [ready] = mocks.createBackgroundMessageHandler.mock.calls[0] as [PromiseLike<void>];
  return ready;
}

function alarmListener(): (alarm: { name: string }) => void {
  const listeners = vi.mocked(chrome.alarms.onAlarm.addListener).mock.calls;
  return listeners[0][0] as (alarm: { name: string }) => void;
}

describe('background alarm registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installChromeStubs();
    mocks.setupDI.mockReset().mockResolvedValue(undefined);
  });

  it('keeps an existing alarm schedule when its period is unchanged', async () => {
    vi.mocked(chrome.alarms.get).mockImplementation(
      async (name: string) => ({ name, periodInMinutes: 5, scheduledTime: 0 }) as never
    );
    await loadWorker();
    expect(chrome.alarms.get).toHaveBeenCalledWith('sync_queue_process');
    expect(chrome.alarms.get).toHaveBeenCalledWith('friend_alerts');
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  it('creates a missing alarm with the five-minute cadence and a one-minute first delay', async () => {
    await loadWorker();
    expect(chrome.alarms.create).toHaveBeenCalledWith('sync_queue_process', {
      periodInMinutes: 5,
      delayInMinutes: 1,
    });
    expect(chrome.alarms.create).toHaveBeenCalledWith('friend_alerts', {
      periodInMinutes: 5,
      delayInMinutes: 1,
    });
  });

  it('re-schedules an alarm whose period changed', async () => {
    vi.mocked(chrome.alarms.get).mockImplementation(
      async (name: string) => ({ name, periodInMinutes: 1, scheduledTime: 0 }) as never
    );
    await loadWorker();
    expect(chrome.alarms.create).toHaveBeenCalledWith('sync_queue_process', {
      periodInMinutes: 5,
      delayInMinutes: 1,
    });
  });

  it('logs an alarm registration failure without failing worker readiness', async () => {
    vi.mocked(chrome.alarms.get).mockRejectedValue(new Error('alarms unavailable'));
    await loadWorker();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      '[Background] Alarm registration failed',
      expect.any(Error)
    );
    await expect(Promise.resolve(routerReady()).then(() => 'ready')).resolves.toBe('ready');
  });
});

describe('background readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installChromeStubs();
    mocks.setupDI.mockReset().mockResolvedValue(undefined);
    mocks.container.resolve.mockReset();
  });

  it('retries a failed DI setup on the next message instead of staying rejected', async () => {
    mocks.setupDI.mockRejectedValueOnce(new Error('transient storage failure'));
    await loadWorker();
    expect(mocks.setupDI).toHaveBeenCalledTimes(1);
    await expect(Promise.resolve(routerReady()).then(() => 'served')).resolves.toBe('served');
    expect(mocks.setupDI).toHaveBeenCalledTimes(2);
  });

  it('shares one attempt in flight among concurrent messages', async () => {
    let finishSetup!: () => void;
    mocks.setupDI.mockReset().mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSetup = resolve;
        })
    );
    await loadWorker();
    const first = Promise.resolve(routerReady()).then(() => 'first');
    const second = Promise.resolve(routerReady()).then(() => 'second');
    expect(mocks.setupDI).toHaveBeenCalledTimes(1);
    finishSetup();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(mocks.setupDI).toHaveBeenCalledTimes(1);
  });

  it('starts a new attempt from a sync alarm after a failed attempt', async () => {
    mocks.setupDI.mockRejectedValueOnce(new Error('transient storage failure'));
    const process = vi.fn(async () => undefined);
    mocks.container.resolve.mockReturnValue({ process, poll: vi.fn(async () => undefined) });
    await loadWorker();
    alarmListener()({ name: 'sync_queue_process' });
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));
    expect(mocks.setupDI).toHaveBeenCalledTimes(2);
  });
});
