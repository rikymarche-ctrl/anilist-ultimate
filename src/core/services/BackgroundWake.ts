/**
 * @file BackgroundWake.ts
 * @description Retries a probe message until the MV3 service worker responds.
 *
 * The service worker may be asleep or mid-shutdown when the content script
 * starts. The first sendMessage can then reject transiently or never resolve,
 * so startup waits for a response with bounded retries and exponential backoff.
 */
import { MSG } from '@shared/messages';

export const WAKE_ATTEMPTS = 5;
export const WAKE_TIMEOUT_MS = 8000;
export const WAKE_BASE_DELAY_MS = 400;

const CONTEXT_INVALIDATED_MARKER = 'Extension context invalidated';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Background wake timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Sends a probe message until the background worker answers.
 * Resolves on the first response (any value). Rethrows immediately when the
 * extension context is invalidated, and rethrows the last error once
 * WAKE_ATTEMPTS attempts have failed.
 */
export async function waitForBackground(
  send: (message: unknown) => Promise<unknown> = (message) => chrome.runtime.sendMessage(message),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      // The Promise constructor converts a synchronous throw from send into a rejection.
      await withTimeout(
        new Promise<unknown>((resolve) => resolve(send({ type: MSG.AUTH_STATUS }))),
        WAKE_TIMEOUT_MS
      );
      return;
    } catch (error) {
      if (errorMessage(error).includes(CONTEXT_INVALIDATED_MARKER) || attempt === WAKE_ATTEMPTS) {
        throw error;
      }
      await sleep(WAKE_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
}
