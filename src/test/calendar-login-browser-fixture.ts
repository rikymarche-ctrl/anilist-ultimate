/** Actual foreground calendar/login composition over native, logged-out worker RPC. */
import 'reflect-metadata';
import '../styles/calendar.css';
import { setupDI } from '@/setup';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import type { AuthService } from '@core/auth/AuthService';
import type { AuthStateClient } from '@core/auth/AuthStateClient';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MSG, AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY } from '@shared/messages';
import { CalendarModule } from '@modules/calendar/CalendarModule';

let calendar: CalendarModule | undefined;
let authCalls = 0;
let completed = 0;
let failed = 0;
let publicState: AuthStateClient | undefined;
let authEvents = 0;
let runtimeAuthSignals = 0;
let storageAuthSignals = 0;
let stopAuthEvents: (() => void) | undefined;
const runtimeSignal = (message: unknown): void => {
  if (message && typeof message === 'object' && 'type' in message && message.type === MSG.LOCAL_CHANGED
    && 'authChanged' in message && message.authChanged) runtimeAuthSignals++;
};
const storageSignal = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
  if (area === 'local' && [AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY].some(key => key in changes)) storageAuthSignals++;
};

export async function prepareCalendarLoginBrowserFixture(): Promise<ReturnType<typeof calendarLoginSnapshot>> {
  history.replaceState(null, '', '/home');
  await setupDI(false);
  const state = container.resolve<AuthStateClient>(TOKENS.AuthTokenService);
  publicState = state;
  if (state.hasToken()) throw new Error('Calendar login fixture requires an anonymous profile');
  stopAuthEvents = container.resolve<IEventBus>(TOKENS.EventBus).on(EVENT_TYPES.AUTH_STATE_CHANGED, () => { authEvents++; }).unsubscribe;
  chrome.runtime.onMessage.addListener(runtimeSignal);
  chrome.storage.onChanged.addListener(storageSignal);
  // Observe the real method, forwarding every invocation without changing its outcome.
  const auth = container.resolve<AuthService>(TOKENS.AuthService);
  const login = auth.login.bind(auth);
  auth.login = async () => {
    authCalls++;
    try { await login(); } catch (error) { failed++; throw error; }
    finally { completed++; }
  };
  document.body.innerHTML = '<main><section class="list-preview-wrap"><div class="section-header"><h2>Airing</h2></div><div class="grid-wrap"><div class="media-preview-card"></div></div></section></main>';
  // Match the site's typography and dark surface so native screenshots are useful for UI review.
  document.body.style.cssText = 'width:800px;min-height:600px;margin:0;padding:20px;box-sizing:border-box;background:#0b1119;color:#edf1f5;font-family:Arial,sans-serif;font-size:14px';
  calendar = container.resolve(CalendarModule);
  await calendar.init();
  const button = document.querySelector<HTMLButtonElement>('.calendar-auth-prompt__btn');
  if (!button) throw new Error('Actual calendar module did not mount its login prompt');
  return calendarLoginSnapshot();
}

export function calendarLoginSnapshot() {
  const button = document.querySelector<HTMLButtonElement>('.calendar-auth-prompt__btn');
  const feedback = document.querySelector<HTMLElement>('.calendar-auth-prompt [role="alert"]');
  const rect = button?.getBoundingClientRect();
  return {
    authCalls, completed, failed,
    authenticated: publicState?.hasToken() ?? false,
    userId: publicState?.getUserCache()?.userId ?? null,
    publicCredentialIsNull: publicState?.getToken() === null,
    sessionPresent: !!publicState?.getSessionId(),
    authEvents, runtimeAuthSignals, storageAuthSignals,
    prompt: !!document.querySelector('.calendar-auth-prompt'),
    buttonConnected: !!button?.isConnected,
    buttonDisabled: button?.disabled ?? null,
    buttonText: button?.textContent?.trim() ?? null,
    feedback: feedback?.textContent?.trim() ?? null,
    feedbackVisible: !!feedback && !feedback.hidden,
    center: rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null,
  };
}

export async function cleanupCalendarLoginBrowserFixture(): Promise<void> {
  await calendar?.destroy();
  calendar = undefined;
  stopAuthEvents?.();
  chrome.runtime.onMessage.removeListener(runtimeSignal);
  chrome.storage.onChanged.removeListener(storageSignal);
  // The dedicated target is closed by the harness, retiring all document services.
}
