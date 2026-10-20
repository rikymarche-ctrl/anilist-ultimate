import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommentService } from './CommentService';

const api = { isAuthenticated: () => true, getContext: () => ({ sessionId: 'A', userId: 1 }) };
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CommentService transient errors', () => {
  it('does not cache a failed request as empty and retries once the failed-lookup backoff elapses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ notes: 'hello' });
    const service = new CommentService({ query } as never, api as never);
    expect(await service.getComment('Friend', 1)).toBeNull();
    expect(await service.getComment('Friend', 1)).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect((await service.getComment('Friend', 1))?.notes).toBe('hello');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('backs off each failed key independently and releases the backoff on session reset', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValue({ notes: 'other' });
    const service = new CommentService({ query } as never, api as never);
    expect(await service.getComment('Friend', 1)).toBeNull();
    expect((await service.getComment('Other', 1))?.notes).toBe('other');
    expect(await service.getComment('Friend', 1)).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    service.clear();
    expect((await service.getComment('Friend', 1))?.notes).toBe('other');
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('still caches a confirmed missing entry', async () => {
    const query = vi.fn().mockResolvedValue(null);
    const service = new CommentService({ query } as never, api as never);
    expect((await service.getComment('Friend', 1))?.notes).toBe('');
    await service.getComment('Friend', 1);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('keeps an existing comment when a forced refresh fails', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ notes: 'keep this' })
      .mockRejectedValueOnce(new Error('offline'));
    const service = new CommentService({ query } as never, api as never);
    await service.getComment('Friend', 1);
    expect(await service.getComment('Friend', 1, true)).toBeNull();
    expect((await service.getComment('Friend', 1))?.notes).toBe('keep this');
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('comment session cache and response contracts', () => {
  function fixture() {
    let sessionId = 'A';
    let authenticated = true;
    const query = vi.fn().mockResolvedValue({ notes: 'Current' });
    const client = {
      isAuthenticated: () => authenticated,
      getContext: () => ({ sessionId, userId: authenticated ? 1 : null }),
    };
    const service = new CommentService({ query } as never, client as never);
    return {
      service,
      query,
      switchAccount: () => {
        sessionId = 'B';
      },
      logout: () => {
        authenticated = false;
      },
    };
  }
  it('does not read, modify or reuse the old persistent notes cache', async () => {
    const f = fixture();
    vi.mocked(chrome.storage.local.get).mockClear();
    vi.mocked(chrome.storage.local.set).mockClear();
    await f.service.init();
    expect((await f.service.getComment('Friend', 1))?.notes).toBe('Current');
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    {},
    { notes: 3 },
    { notes: {} },
    { MediaList: {} },
    { MediaList: { MediaList: null } },
    { notes: 'A', MediaList: { notes: 'B' } },
  ])('does not turn a malformed response into confirmed missing notes: %j', async (response) => {
    const f = fixture();
    f.query.mockResolvedValueOnce(response);
    expect(await f.service.getComment('Friend', 1)).toBeNull();
    // A malformed response is a failed lookup: it is retried only after the failed-lookup backoff.
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect((await f.service.getComment('Friend', 1))?.notes).toBe('Current');
    expect(f.query).toHaveBeenCalledTimes(2);
  });
  it.each([null, { notes: null }, { notes: '' }, { MediaList: null }])(
    'still caches a confirmed empty entry: %j',
    async (response) => {
      const f = fixture();
      f.query.mockResolvedValueOnce(response);
      expect((await f.service.getComment('Friend', 1))?.notes).toBe('');
      await f.service.getComment('Friend', 1);
      expect(f.query).toHaveBeenCalledTimes(1);
    }
  );
  it('clears cached notes on a silent context change and suppresses requests after logout', async () => {
    const f = fixture();
    await f.service.getComment('Friend', 1);
    f.switchAccount();
    f.query.mockResolvedValueOnce({ notes: 'Other account' });
    expect((await f.service.getComment('Friend', 1))?.notes).toBe('Other account');
    f.logout();
    expect(await f.service.getComment('Friend', 1)).toBeNull();
    expect(f.service.hasValidComment('Friend', 1)).toBe(false);
    expect(f.query).toHaveBeenCalledTimes(2);
  });
  it.each(['account', 'clear'] as const)(
    'rejects late results after %s without repopulating the cache',
    async (mode) => {
      const f = fixture();
      let finish!: (value: unknown) => void;
      f.query.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const waiting = f.service.getComment('Friend', 1);
      await Promise.resolve();
      if (mode === 'account') f.switchAccount();
      else f.service.clear();
      finish({ notes: 'Old' });
      expect(await waiting).toBeNull();
      expect(f.service.hasValidComment('Friend', 1)).toBe(false);
      expect((await f.service.getComment('Friend', 1))?.notes).toBe('Current');
    }
  );
  it('deduplicates concurrent reads and keeps a defensive copy for each consumer', async () => {
    const f = fixture();
    let finish!: (value: unknown) => void;
    f.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const first = f.service.getComment('Friend', 1);
    const second = f.service.getComment('Friend', 1);
    await Promise.resolve();
    expect(f.query).toHaveBeenCalledTimes(1);
    finish({ notes: 'Current' });
    const [a, b] = await Promise.all([first, second]);
    a!.notes = 'Changed';
    expect(b?.notes).toBe('Current');
    expect((await f.service.getComment('Friend', 1))?.notes).toBe('Current');
  });
  it('uses finite TTLs for nonempty and empty entries, including timestamp zero', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const f = fixture();
    await f.service.getComment('Friend', 1);
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
    await f.service.getComment('Friend', 1);
    expect(f.query).toHaveBeenCalledTimes(2);
    f.query.mockResolvedValueOnce({ notes: '' });
    await f.service.getComment('Empty', 1);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await f.service.getComment('Empty', 1);
    expect(f.query).toHaveBeenCalledTimes(4);
  });
  it('bounds entry count and total cached text without truncating a returned note', async () => {
    const f = fixture();
    for (let i = 0; i < 501; i++) await f.service.getComment(`User${i}`, 1);
    await f.service.getComment('User0', 1);
    expect(f.query).toHaveBeenCalledTimes(502);
    const text = 'a'.repeat(2 * 1024 * 1024 + 1);
    f.query.mockResolvedValue({ notes: text });
    expect((await f.service.getComment('Large', 1))?.notes).toHaveLength(text.length);
    await f.service.getComment('Large', 1);
    expect(f.query).toHaveBeenCalledTimes(504);
  });
  it('uses prototype-safe usernames and refuses invalid IDs and names before the API', async () => {
    const f = fixture();
    expect((await f.service.getComment('__proto__', 1))?.notes).toBe('Current');
    expect(await f.service.getComment('', 1)).toBeNull();
    expect(await f.service.getComment('Friend', 0)).toBeNull();
    expect(await f.service.getComment('Friend', 2147483648)).toBeNull();
    expect(f.query).toHaveBeenCalledTimes(1);
  });

  it('does not retain stale cached text when a successful forced refresh exceeds the cache budget', async () => {
    const f = fixture();
    await f.service.getComment('Friend', 1);
    const text = 'a'.repeat(2 * 1024 * 1024 + 1);
    f.query.mockResolvedValue({ notes: text });
    expect((await f.service.getComment('Friend', 1, true))?.notes).toBe(text);
    expect((await f.service.getComment('Friend', 1))?.notes).toBe(text);
    expect(f.query).toHaveBeenCalledTimes(3);
  });

  it('evicts old entries when the aggregate note text exceeds the cache budget', async () => {
    const f = fixture();
    f.query.mockResolvedValue({ notes: 'x'.repeat(1100000) });
    await f.service.getComment('A', 1);
    await f.service.getComment('B', 1);
    await f.service.getComment('A', 1);
    expect(f.query).toHaveBeenCalledTimes(3);
  });
});
