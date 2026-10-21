import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForBackground, WAKE_ATTEMPTS, WAKE_TIMEOUT_MS } from './BackgroundWake';

const transient = () => new Error('Could not establish connection. Receiving end does not exist.');

describe('waitForBackground', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves on first successful response', async () => {
    const send = vi.fn(async () => ({ success: true }));
    const sleep = vi.fn(async (_ms: number) => {});
    await expect(waitForBackground(send, sleep)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'auth:status' });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries after transient rejection and succeeds on the third attempt', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(transient())
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn(async (_ms: number) => {});
    await waitForBackground(send, sleep);
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([400, 800]);
  });

  it('rethrows the last error after WAKE_ATTEMPTS failures', async () => {
    const send = vi.fn(async () => {
      throw transient();
    });
    const sleep = vi.fn(async (_ms: number) => {});
    await expect(waitForBackground(send, sleep)).rejects.toThrow('Could not establish connection');
    expect(send).toHaveBeenCalledTimes(WAKE_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(WAKE_ATTEMPTS - 1);
  });

  it('does not retry when the extension context is invalidated', async () => {
    const send = vi.fn(async () => {
      throw new Error('Extension context invalidated.');
    });
    const sleep = vi.fn(async (_ms: number) => {});
    await expect(waitForBackground(send, sleep)).rejects.toThrow('Extension context invalidated.');
    expect(send).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('treats a synchronous throw from send as a failed attempt', async () => {
    const send = vi
      .fn()
      .mockImplementationOnce(() => {
        throw transient();
      })
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn(async (_ms: number) => {});
    await waitForBackground(send, sleep);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(400);
  });

  it('times out a hanging attempt and succeeds on the next one', async () => {
    vi.useFakeTimers();
    const send = vi
      .fn()
      .mockImplementationOnce(() => new Promise<unknown>(() => {}))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn(async (_ms: number) => {});
    const pending = waitForBackground(send, sleep);
    await vi.advanceTimersByTimeAsync(WAKE_TIMEOUT_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
