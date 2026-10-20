import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomListService, validateCustomLists } from './CustomListService';

function storage(data: Record<string, unknown> = {}) {
  vi.mocked(chrome.storage.local.get).mockImplementation(((key: string) =>
    Promise.resolve({ [key]: structuredClone(data[key]) })) as never);
  vi.mocked(chrome.storage.local.set).mockImplementation(((items: Record<string, unknown>) => {
    Object.assign(data, structuredClone(items));
    return Promise.resolve();
  }) as never);
  vi.mocked(chrome.storage.local.remove).mockImplementation(((key: string) => {
    delete data[key];
    return Promise.resolve();
  }) as never);
  return data;
}
describe('custom list persistence', () => {
  beforeEach(() => vi.clearAllMocks());
  it('does not turn a read failure into empty/default lists', async () => {
    storage();
    vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Storage read failed'));
    await expect(new CustomListService().init()).rejects.toThrow('read failed');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
  it('retains the only legacy copy when replacement persistence fails', async () => {
    const data = storage({ au_best_friends: [{ id: 1, name: 'One' }] });
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('Write failed'));
    await expect(new CustomListService().init()).rejects.toThrow('Write failed');
    expect(data.au_best_friends).toBeDefined();
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
  });
  it('serializes concurrent membership edits and returns defensive copies', async () => {
    storage();
    const service = new CustomListService();
    await Promise.all(
      Array.from({ length: 20 }, (_, id) =>
        service.toggleUserInList('Friends', { id: id + 1, name: 'Friend', avatar: '' }, true)
      )
    );
    expect(service.getList('Friends')).toHaveLength(20);
    service.getLists().Friends.length = 0;
    expect(service.getList('Friends')).toHaveLength(20);
  });
  it('publishes no membership change after a failed write', async () => {
    storage({ custom_lists_account_local: { Friends: [] } });
    const service = new CustomListService();
    await service.init();
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('Write failed'));
    await expect(
      service.toggleUserInList('Friends', { id: 1, name: 'Friend', avatar: '' }, true)
    ).rejects.toThrow();
    expect(service.getList('Friends')).toHaveLength(0);
  });
  it('rejects dangerous names and corrupted stored lists without replacing data', async () => {
    storage({ custom_lists_account_local: JSON.parse('{"__proto__":[]}') });
    const service = new CustomListService();
    await expect(service.init()).rejects.toThrow('original data preserved');
    await expect(service.createList('constructor')).rejects.toThrow('Invalid');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('treats Object.prototype member names as absent and never accepts them as list names', async () => {
    const data = storage({ custom_lists_account_local: { Friends: [] } });
    const service = new CustomListService();
    await service.init();
    for (const name of [
      'toString',
      'valueOf',
      'hasOwnProperty',
      'constructor',
      '__proto__',
      'prototype',
    ]) {
      expect(service.getList(name)).toEqual([]);
      expect(service.isUserInList(name, 1)).toBe(false);
      await expect(service.createList(name)).rejects.toThrow('Invalid list name');
    }
    expect(() => validateCustomLists({ toString: [] })).toThrow('original data preserved');
    expect(data.custom_lists_account_local).toEqual({ Friends: [] });
  });
  it('opens a fresh local list workspace without reading, transferring or deleting old lists', async () => {
    const originals = {
      au_best_friends: [{ id: 1, name: 'Old friend' }],
      au_custom_user_lists: { Old: [{ id: 2, name: 'Old list', avatar: '' }] },
    };
    const data = storage(structuredClone(originals));
    const service = new CustomListService();
    await service.init();
    expect(service.getLists()).toEqual({ 'Best Friends': [] });
    expect(chrome.storage.local.get).toHaveBeenCalledExactlyOnceWith('custom_lists_account_local');
    expect(data.au_best_friends).toEqual(originals.au_best_friends);
    expect(data.au_custom_user_lists).toEqual(originals.au_custom_user_lists);
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
  });
});
