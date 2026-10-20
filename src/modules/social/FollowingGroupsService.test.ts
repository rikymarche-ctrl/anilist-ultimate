import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@core/logger';
import { FOLLOWING_GROUPS_KEY, FollowingGroupsService } from './FollowingGroupsService';

const defaults = { groups: [], collapsed: [], othersCollapsed: false };
type StorageListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string
) => void;

function storage(data: Record<string, unknown> = {}) {
  vi.mocked(chrome.storage.local.get).mockImplementation(((key: string) =>
    Promise.resolve({ [key]: structuredClone(data[key]) })) as never);
  vi.mocked(chrome.storage.local.set).mockImplementation(((items: Record<string, unknown>) => {
    Object.assign(data, structuredClone(items));
    return Promise.resolve();
  }) as never);
  return data;
}

/** Captures the storage listener so tests can simulate another tab writing the key. */
function storageEvents() {
  const onChanged = {
    listener: undefined as StorageListener | undefined,
    addListener: vi.fn((listener: StorageListener) => {
      onChanged.listener = listener;
    }),
    removeListener: vi.fn(),
  };
  chrome.storage.onChanged = onChanged as unknown as typeof chrome.storage.onChanged;
  return onChanged;
}

describe('following groups persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  it('uses defaults and writes nothing when no config is stored', async () => {
    storage();
    const service = new FollowingGroupsService();
    await service.init();
    expect(service.getConfig()).toEqual(defaults);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it.each([
    { groups: 'Friends', collapsed: [], othersCollapsed: false },
    { groups: ['Friends', 'Friends'], collapsed: [], othersCollapsed: false },
    { groups: ['toString'], collapsed: [], othersCollapsed: false },
    { groups: [], collapsed: [], othersCollapsed: 'yes' },
  ])('keeps defaults in memory and writes nothing for invalid stored data %j', async (stored) => {
    const data = storage({ [FOLLOWING_GROUPS_KEY]: stored });
    const service = new FollowingGroupsService();
    await service.init();
    expect(service.getConfig()).toEqual(defaults);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(data[FOLLOWING_GROUPS_KEY]).toEqual(stored);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('enables, reorders, collapses and persists groups, handing out copies only', async () => {
    const data = storage();
    const service = new FollowingGroupsService();
    const before = service.getConfig();

    await service.setGroupEnabled('Friends', true);
    await service.setGroupEnabled('Trusted', true);
    await service.moveGroup('Trusted', -1);
    await service.setCollapsed('Trusted', true);
    await service.setCollapsed(null, true);

    expect(service.getConfig()).toEqual({
      groups: ['Trusted', 'Friends'],
      collapsed: ['Trusted'],
      othersCollapsed: true,
    });
    expect(data[FOLLOWING_GROUPS_KEY]).toEqual(service.getConfig());
    expect(before).toEqual(defaults);
    const snapshot = service.getConfig();
    snapshot.groups.push('Injected');
    expect(service.getConfig().groups).toEqual(['Trusted', 'Friends']);
  });

  it('disabling a group also clears its collapsed flag', async () => {
    storage();
    const service = new FollowingGroupsService();
    await service.setGroupEnabled('Friends', true);
    await service.setCollapsed('Friends', true);
    await service.setGroupEnabled('Friends', false);
    expect(service.getConfig()).toEqual({ groups: [], collapsed: [], othersCollapsed: false });
  });

  it('skips the write for moves at the edges, unknown names and repeated collapse states', async () => {
    storage();
    const service = new FollowingGroupsService();
    await service.setGroupEnabled('A', true);
    await service.setGroupEnabled('B', true);
    await service.moveGroup('A', -1);
    await service.moveGroup('B', 1);
    await service.moveGroup('Missing', 1);
    await service.setCollapsed('A', false);
    expect(service.getConfig().groups).toEqual(['A', 'B']);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid names and directions without writing', async () => {
    storage();
    const service = new FollowingGroupsService();
    await expect(service.setGroupEnabled('toString', true)).rejects.toThrow(
      'Invalid following group'
    );
    await expect(service.setGroupEnabled('', true)).rejects.toThrow();
    await expect(service.setCollapsed('__proto__', true)).rejects.toThrow();
    await expect(service.moveGroup('A', 2 as never)).rejects.toThrow();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('serializes concurrent writes so that no update is lost', async () => {
    const data = storage();
    const service = new FollowingGroupsService();
    await Promise.all([
      service.setGroupEnabled('A', true),
      service.setGroupEnabled('B', true),
      service.setGroupEnabled('C', true),
    ]);
    expect(service.getConfig().groups).toEqual(['A', 'B', 'C']);
    expect(data[FOLLOWING_GROUPS_KEY]).toEqual({
      groups: ['A', 'B', 'C'],
      collapsed: [],
      othersCollapsed: false,
    });
  });

  it('publishes successful writes only, and keeps the previous state when a write fails', async () => {
    storage();
    const service = new FollowingGroupsService();
    const listener = vi.fn();
    service.onChange(listener);

    await service.setGroupEnabled('A', true);
    expect(listener).toHaveBeenCalledTimes(1);

    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('Write failed'));
    await expect(service.setGroupEnabled('B', true)).rejects.toThrow('Write failed');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(service.getConfig().groups).toEqual(['A']);
  });

  it('publishes a change written by another tab and ignores its own echo', async () => {
    storage();
    const events = storageEvents();
    const service = new FollowingGroupsService();
    const listener = vi.fn();
    service.onChange(listener);

    await service.setGroupEnabled('A', true);
    events.listener!(
      {
        [FOLLOWING_GROUPS_KEY]: {
          newValue: { groups: ['A'], collapsed: [], othersCollapsed: false },
        },
      } as never,
      'local'
    );
    expect(listener).toHaveBeenCalledTimes(1);

    events.listener!(
      {
        [FOLLOWING_GROUPS_KEY]: {
          newValue: { groups: ['Other'], collapsed: [], othersCollapsed: false },
        },
      } as never,
      'local'
    );
    expect(service.getConfig().groups).toEqual(['Other']);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores invalid storage events, other areas and other keys', async () => {
    storage();
    const events = storageEvents();
    const service = new FollowingGroupsService();
    const listener = vi.fn();
    service.onChange(listener);

    events.listener!({ [FOLLOWING_GROUPS_KEY]: { newValue: { groups: 'bad' } } } as never, 'local');
    events.listener!(
      {
        [FOLLOWING_GROUPS_KEY]: {
          newValue: { groups: ['X'], collapsed: [], othersCollapsed: false },
        },
      } as never,
      'sync'
    );
    events.listener!(
      {
        other_key: { newValue: { groups: ['X'], collapsed: [], othersCollapsed: false } },
      } as never,
      'local'
    );

    expect(service.getConfig()).toEqual(defaults);
    expect(listener).not.toHaveBeenCalled();
  });

  it('retries the load after a failed read', async () => {
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('read failed'));
    const service = new FollowingGroupsService();
    await expect(service.init()).rejects.toThrow('read failed');
    storage();
    await expect(service.init()).resolves.toBeUndefined();
  });

  it('stops listening to storage events after dispose', () => {
    const events = storageEvents();
    const service = new FollowingGroupsService();
    service.dispose();
    expect(events.removeListener).toHaveBeenCalledWith(events.listener);
  });
});
