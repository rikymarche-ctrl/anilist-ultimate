import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomListHost } from './CustomListHost';

function fixture() {
  const data: Record<string, unknown> = {};
  let owner: number | null = 1;
  let session = 'one';
  vi.mocked(chrome.storage.local.get).mockImplementation(((key: string) =>
    Promise.resolve({ [key]: structuredClone(data[key]) })) as never);
  vi.mocked(chrome.storage.local.set).mockImplementation(((items: Record<string, unknown>) => {
    Object.assign(data, structuredClone(items));
    return Promise.resolve();
  }) as never);
  const auth = {
    ensureInitialized: async () => {},
    hasToken: () => owner !== null,
    getUserCache: () => (owner ? { userId: owner } : null),
    getSessionId: () => session,
  };
  return {
    host: new CustomListHost(auth as never),
    data,
    switchAccount: () => {
      owner = 2;
      session = 'two';
    },
  };
}
describe('custom lists single writer and account isolation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('preserves concurrent membership updates from separate clients', async () => {
    const { host } = fixture();
    await Promise.all(
      Array.from({ length: 20 }, (_, id) =>
        host.dispatch(
          'toggle',
          { name: 'Friends', user: { id: id + 1, name: 'User', avatar: '' }, active: true },
          'one'
        )
      )
    );
    expect((await host.dispatch('get', undefined, 'one')).Friends).toHaveLength(20);
  });
  it('does not expose another account or guess the owner of original local lists', async () => {
    const { host, data, switchAccount } = fixture();
    data.au_custom_user_lists = { Legacy: [{ id: 7, name: 'Friend', avatar: '' }] };
    expect(await host.dispatch('get', undefined, 'one')).toEqual({ 'Best Friends': [] });
    await host.dispatch('create', { name: 'Only A' }, 'one');
    switchAccount();
    expect(await host.dispatch('get', undefined, 'two')).toEqual({ 'Best Friends': [] });
    await expect(host.dispatch('create', { name: 'Stale' }, 'one')).rejects.toThrow(
      'account changed'
    );
  });
  it.each(['legacy', 'claim'])(
    'rejects removed %s commands and preserves original lists',
    async (operation) => {
      const { host, data } = fixture();
      const original = { Old: [{ id: 7, name: 'Friend', avatar: '' }] };
      data.au_custom_user_lists = original;
      await expect(host.dispatch(operation, undefined, 'one')).rejects.toThrow(
        'Unknown lists command'
      );
      expect(data.au_custom_user_lists).toEqual(original);
    }
  );
  it('rejects Object.prototype member names as list commands without persisting them', async () => {
    const { host, data } = fixture();
    await expect(host.dispatch('create', { name: 'toString' }, 'one')).rejects.toThrow(
      'Invalid list command'
    );
    await expect(
      host.dispatch(
        'toggle',
        { name: 'valueOf', user: { id: 1, name: 'User', avatar: '' }, active: true },
        'one'
      )
    ).rejects.toThrow('Invalid membership command');
    expect(data.custom_lists_account_1).toEqual({ 'Best Friends': [] });
  });
  it('rejects invalid membership inputs before persisting membership', async () => {
    const { host, data } = fixture();
    await expect(
      host.dispatch('toggle', { name: '__proto__', user: { id: -1 }, active: true }, 'one')
    ).rejects.toThrow('Invalid');
    expect(data.custom_lists_account_1).toEqual({ 'Best Friends': [] });
  });
});
