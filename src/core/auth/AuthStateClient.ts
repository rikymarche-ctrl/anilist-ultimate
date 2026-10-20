import { inject, injectable, type Disposable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { MSG, AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY, type AuthStatusResponse } from '@shared/messages';
import { parseAuthStatus } from './AuthMetadata';

/** Public authentication metadata; this service never reads or receives a token. */
@injectable()
export class AuthStateClient implements Disposable {
  private status: AuthStatusResponse = { authenticated: false };
  private ready: Promise<void> | null = null;
  private latestRefresh: Promise<void> | null = null;
  private refreshVersion = 0;
  private disposed = false;
  private readonly runtimeEvents = chrome.runtime.onMessage;
  private readonly storageEvents = chrome.storage.onChanged;
  private readonly runtimeListener = (message: unknown): void => {
    if (this.disposed || !message || typeof message !== 'object') return;
    const signal = message as Record<string, unknown>;
    if (signal.type === MSG.LOCAL_CHANGED && signal.authChanged) {
      void this.refresh().catch(() => undefined);
    }
  };
  private readonly storageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (!this.disposed && area === 'local' && [AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY].some(key => key in changes)
      && typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
      void this.refresh().catch(() => undefined);
    }
  };
  constructor(@inject(TOKENS.EventBus) private eventBus: IEventBus) {
    this.runtimeEvents.addListener(this.runtimeListener);
    // Extension pages have native storage notifications; content scripts receive
    // only the sanitized signal broadcast by the background.
    this.storageEvents.addListener(this.storageListener);
  }
  private assertActive(): void { if (this.disposed) throw new Error('Authentication state client disposed'); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.refreshVersion++;
    this.status = { authenticated: false };
    this.ready = null;
    this.latestRefresh = null;
    this.runtimeEvents.removeListener(this.runtimeListener);
    this.storageEvents.removeListener(this.storageListener);
  }
  initialize(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Authentication state client disposed'));
    if (!this.ready) {
      const pending = this.refresh().catch(error => {
        if (!this.disposed && this.ready === pending) this.ready = null;
        throw error;
      });
      this.ready = pending;
    }
    return this.ready;
  }
  ensureInitialized(): Promise<void> { return this.initialize(); }
  private invalidate(): void {
    if (this.disposed) return;
    this.status = { authenticated: false };
    this.ready = null;
    this.refreshVersion++;
    this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
  }
  refresh(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Authentication state client disposed'));
    const version = ++this.refreshVersion;
    const pending = this.readStatus(version);
    this.latestRefresh = pending;
    return pending;
  }
  /** A superseded read cannot confirm a command while its replacement is pending. */
  private async awaitLatestRefresh(): Promise<void> {
    for (;;) {
      this.assertActive();
      const latest = this.latestRefresh;
      try { await latest; }
      catch (error) {
        this.assertActive();
        if (latest === this.latestRefresh) throw error;
        continue;
      }
      this.assertActive();
      if (latest === this.latestRefresh) return;
    }
  }
  private async readStatus(version: number): Promise<void> {
    const previous = this.status;
    let response: AuthStatusResponse;
    try {
      // Normalize synchronous extension-context errors before invalidation can
      // reenter initialization, so refresh()/initialize() first own their promises.
      let request: Promise<unknown>;
      try { request = chrome.runtime.sendMessage({ type: MSG.AUTH_STATUS }); }
      catch (error) { request = Promise.reject(error); }
      const raw: unknown = await request;
      this.assertActive();
      if (version !== this.refreshVersion) return this.awaitLatestRefresh();
      response = parseAuthStatus(raw);
    } catch (error) {
      this.assertActive();
      if (version !== this.refreshVersion) return this.awaitLatestRefresh();
      // A failed current refresh cannot leave an earlier owner/session usable.
      // Listener callers only contain the rejection; invalidation happens once.
      this.invalidate();
      throw error;
    }
    this.status = response;
    if (previous.sessionId !== this.status.sessionId || previous.authenticated !== this.status.authenticated || previous.userId !== this.status.userId) {
      this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: this.status.authenticated, userId: this.status.userId, timestamp: new Date() });
    }
    if (version !== this.refreshVersion) await this.awaitLatestRefresh();
  }
  hasToken(): boolean { return this.status.authenticated; }
  getToken(): null { return null; }
  getSessionId(): string | undefined { return this.status.sessionId; }
  getUserCache(): { userId: number; userName: string } | null {
    return this.status.authenticated && this.status.userId ? { userId: this.status.userId, userName: this.status.userName ?? '' } : null;
  }
}
