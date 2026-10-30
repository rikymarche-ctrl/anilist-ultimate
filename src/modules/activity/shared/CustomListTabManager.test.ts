import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomListTabManager } from './CustomListTabManager';
import { logger } from '@core/logger';
describe('custom list menu safety and lifecycle', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });
  it('renders arbitrary list names as text rather than executable HTML', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    const name = '"><img src=x onerror=alert(1)>';
    const service = { whenReady: async () => undefined, getLists: () => ({ [name]: [] }) };
    const manager = new CustomListTabManager(logger, service as never);
    expect(await manager.inject()).toBe(true);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelectorAll('.au-custom-list-item')[1].textContent).toBe(name);
    expect(document.querySelectorAll('.au-custom-list-item')[1].getAttribute('data-list')).toBe(
      name
    );
    const remove = vi.spyOn(document, 'removeEventListener');
    manager.destroy();
    expect(remove).toHaveBeenCalledWith('click', expect.any(Function));
  });
  it('does not inject after destruction while the list service is loading', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    let resolve!: () => void;
    const manager = new CustomListTabManager(logger, {
      whenReady: () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
      getLists: () => ({ Friends: [] }),
    } as never);
    const pending = manager.inject();
    manager.destroy();
    resolve();
    expect(await pending).toBe(false);
    expect(document.querySelector('.au-custom-list-btn')).toBeNull();
  });
});

describe('custom list tab re-injection and empty-state memory', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('replaces a stale body menu and its document listeners when AniList rebuilds the toggle', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    const service = { whenReady: async () => undefined, getLists: () => ({ Friends: [] }) };
    const manager = new CustomListTabManager(logger, service as never);
    expect(await manager.inject()).toBe(true);
    document.querySelector('.feed-type-toggle')!.outerHTML = '<div class="feed-type-toggle"></div>';
    const remove = vi.spyOn(document, 'removeEventListener');
    expect(await manager.inject()).toBe(true);
    expect(document.querySelectorAll('.au-custom-list-menu')).toHaveLength(1);
    expect(document.querySelectorAll('.au-custom-list-btn')).toHaveLength(1);
    expect(remove).toHaveBeenCalledWith('click', expect.any(Function));
    manager.destroy();
    expect(document.querySelector('.au-custom-list-menu')).toBeNull();
  });

  it('does not repeat the background list lookup while this page has no lists, and checks again after navigation', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    const init = vi.fn(async () => undefined);
    const service = { whenReady: init, getLists: vi.fn(() => ({})) };
    const manager = new CustomListTabManager(logger, service as never);
    expect(await manager.inject()).toBe(false);
    expect(await manager.inject()).toBe(false);
    expect(init).toHaveBeenCalledTimes(1);
    manager.destroy();
    expect(await manager.inject()).toBe(false);
    expect(init).toHaveBeenCalledTimes(2);
  });

  it('injects as soon as local lists appear without waiting for navigation', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    let lists: Record<string, unknown[]> = {};
    const init = vi.fn(async () => undefined);
    const manager = new CustomListTabManager(logger, { whenReady: init, getLists: () => lists } as never);
    expect(await manager.inject()).toBe(false);
    lists = { Friends: [] };
    expect(await manager.inject()).toBe(true);
    expect(document.querySelector('.au-custom-list-btn')).not.toBeNull();
    expect(init).toHaveBeenCalledTimes(2);
  });
});

describe('custom list selection persistence across reloads', () => {
  const KEY = 'test-persist-key';
  afterEach(() => {
    document.body.replaceChildren();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('restores the stored selection on inject when the list exists', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    sessionStorage.setItem(KEY, 'Friends');
    const onListChange = vi.fn();
    const manager = new CustomListTabManager(logger, {
      whenReady: async () => undefined,
      getLists: () => ({ Friends: [], Family: [] }),
    } as never);
    manager.configure({ persistKey: KEY, onListChange });
    expect(await manager.inject()).toBe(true);
    expect(onListChange).toHaveBeenCalledWith('Friends');
    expect(manager.getCurrentList()).toBe('Friends');
  });

  it('removes a stale stored name and selects nothing', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    sessionStorage.setItem(KEY, 'Deleted list');
    const onListChange = vi.fn();
    const manager = new CustomListTabManager(logger, {
      whenReady: async () => undefined,
      getLists: () => ({ Friends: [] }),
    } as never);
    manager.configure({ persistKey: KEY, onListChange });
    expect(await manager.inject()).toBe(true);
    expect(onListChange).not.toHaveBeenCalled();
    expect(manager.getCurrentList()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('persists setList selections and clears storage on setList(null)', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    const manager = new CustomListTabManager(logger, {
      whenReady: async () => undefined,
      getLists: () => ({ Friends: [] }),
    } as never);
    manager.configure({ persistKey: KEY });
    expect(await manager.inject()).toBe(true);
    manager.setList('Friends');
    expect(sessionStorage.getItem(KEY)).toBe('Friends');
    manager.setList(null);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('writes nothing to sessionStorage without persistKey', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    const setItem = vi.spyOn(sessionStorage, 'setItem');
    const removeItem = vi.spyOn(sessionStorage, 'removeItem');
    const manager = new CustomListTabManager(logger, {
      whenReady: async () => undefined,
      getLists: () => ({ Friends: [] }),
    } as never);
    expect(await manager.inject()).toBe(true);
    manager.setList('Friends');
    manager.setList(null);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('does not break inject or setList when sessionStorage throws', async () => {
    document.body.innerHTML = '<div class="feed-type-toggle"></div>';
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const manager = new CustomListTabManager(logger, {
      whenReady: async () => undefined,
      getLists: () => ({ Friends: [] }),
    } as never);
    manager.configure({ persistKey: KEY });
    expect(await manager.inject()).toBe(true);
    expect(() => manager.setList('Friends')).not.toThrow();
    expect(manager.getCurrentList()).toBe('Friends');
    expect(() => manager.setList(null)).not.toThrow();
  });
});
