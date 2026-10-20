/** Centralized OAuth credential storage with validated, account-bound snapshots. */
import { injectable, inject, type Disposable } from 'tsyringe';
import type { ILogger } from '@core/interfaces/ILogger';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY, type UserCache } from '@shared/messages';
import { parseAuthSessionId, parseAuthUserCache } from './AuthMetadata';
import { isRecord } from '@/api/GraphQLResponse';

const AUTH_KEYS = [AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY];
function hasKey(value: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }
interface AuthSnapshot { token: string | null; user: UserCache | null; session: string; }
class AuthStorageValidationError extends Error {
  constructor() { super('Invalid authentication storage snapshot'); this.name = 'AuthStorageValidationError'; }
}
function parseToken(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid authentication credential');
  return value;
}

@injectable()
export class AuthTokenService implements Disposable {
  private cachedToken: string | null = null;
  private cachedUserCache: UserCache | null = null;
  private initialized = false;
  private initializationStarted = false;
  private initPromise: Promise<void> | null = null;
  private sessionId = '';
  private storageVersion = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private disposed = false;
  /** A token-only event cannot reuse metadata belonging to its predecessor. */
  private unboundToken: string | null = null;
  private unboundSession: string | null = null;
  private readonly storageListener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
    if (this.disposed || areaName !== 'local' || !AUTH_KEYS.some(key => hasKey(changes, key))) return;
    this.storageVersion++;
    // The owner establishes local-storage restrictions before starting auth.
    // Eager construction only installs the listener and tracks freshness.
    if (!this.initializationStarted) return;
    try {
      if (hasKey(changes, AUTH_STORAGE_KEY)) parseToken(changes[AUTH_STORAGE_KEY].newValue);
      if (hasKey(changes, AUTH_USER_CACHE_KEY)) parseAuthUserCache(changes[AUTH_USER_CACHE_KEY].newValue);
      if (hasKey(changes, AUTH_SESSION_KEY)) parseAuthSessionId(changes[AUTH_SESSION_KEY].newValue);
      const hasToken = hasKey(changes, AUTH_STORAGE_KEY);
      const hasOwner = hasKey(changes, AUTH_USER_CACHE_KEY);
      const hasSession = hasKey(changes, AUTH_SESSION_KEY);
      const nextToken = hasToken ? parseToken(changes[AUTH_STORAGE_KEY].newValue) : this.cachedToken;
      const nextOwner = hasOwner ? parseAuthUserCache(changes[AUTH_USER_CACHE_KEY].newValue) : this.cachedUserCache;
      const nextSession = hasSession ? parseAuthSessionId(changes[AUTH_SESSION_KEY].newValue) : undefined;
      const changedIdentity = (hasToken && nextToken !== this.cachedToken)
        || (hasOwner && nextOwner?.userId !== this.cachedUserCache?.userId);
      const needsSessionBoundary = this.unboundSession !== null
        ? nextSession === undefined || nextSession === this.unboundSession
        : changedIdentity && this.sessionId !== '' && (nextSession === undefined || nextSession === this.sessionId);
      if ((hasToken && !hasOwner && !hasSession) || needsSessionBoundary) {
        if (this.unboundSession === null) this.unboundSession = this.sessionId;
        this.unboundToken = nextToken;
        this.cachedToken = this.unboundToken;
        this.cachedUserCache = null;
        this.sessionId = crypto.randomUUID();
        this.initialized = true;
        this.publish();
        return;
      }
      if (hasOwner || hasSession) { this.unboundToken = null; this.unboundSession = null; }
      if (hasToken && hasOwner && hasSession) {
        const session = parseAuthSessionId(changes[AUTH_SESSION_KEY].newValue);
        if (session !== undefined) {
          this.apply({ token: parseToken(changes[AUTH_STORAGE_KEY].newValue), user: parseAuthUserCache(changes[AUTH_USER_CACHE_KEY].newValue), session });
          this.publish(); return;
        }
      }
      // Partial native changes do not disclose an owner until their coherent
      // persisted snapshot has been read and its version rechecked.
      this.invalidate();
      void this.initialize().catch(() => undefined);
    } catch {
      this.invalidate();
      this.logger.error('[AuthTokenService] Invalid authentication storage update');
    }
  };

  constructor(
    @inject(TOKENS.Logger) private logger: ILogger,
    @inject(TOKENS.EventBus) private eventBus: IEventBus,
    @inject(TOKENS.LocalStorage) private storage: IStorageService
  ) { chrome.storage.onChanged.addListener(this.storageListener); }

  private assertActive(): void { if (this.disposed) throw new Error('Authentication service disposed'); }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.writes.then(() => { this.assertActive(); return operation(); });
    this.writes = pending.catch(() => undefined); return pending;
  }
  private apply(state: AuthSnapshot): void {
    this.assertActive();
    this.cachedToken = state.token;
    this.cachedUserCache = state.token && state.token !== this.unboundToken ? state.user : null;
    this.sessionId = state.session; this.initialized = true;
  }
  private publish(): void {
    if (this.disposed) return;
    this.eventBus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: this.cachedToken !== null && this.cachedUserCache !== null,
      userId: this.cachedUserCache?.userId, timestamp: new Date(),
    });
  }
  private invalidate(): void {
    this.cachedToken = null; this.cachedUserCache = null; this.sessionId = '';
    this.initialized = false; this.publish();
  }
  private async readSnapshot(): Promise<AuthSnapshot & { version: number }> {
    for (;;) {
      this.assertActive(); const version = this.storageVersion;
      let raw: unknown;
      try { raw = await this.storage.getMultiple(AUTH_KEYS); }
      catch (error) {
        this.assertActive();
        // Failed reads have the same freshness requirement as successful ones.
        if (version !== this.storageVersion) continue;
        throw error;
      }
      this.assertActive(); if (version !== this.storageVersion) continue;
      if (!isRecord(raw)) throw new AuthStorageValidationError();
      let token: string | null; let user: UserCache | null; let session: string | undefined;
      try {
        token = parseToken(raw[AUTH_STORAGE_KEY]);
        user = parseAuthUserCache(raw[AUTH_USER_CACHE_KEY]);
        session = parseAuthSessionId(raw[AUTH_SESSION_KEY]);
      } catch { throw new AuthStorageValidationError(); }
      if (session === undefined) {
        session = crypto.randomUUID();
        let saved: boolean;
        try { saved = await this.storage.set(AUTH_SESSION_KEY, session); }
        catch (error) { this.assertActive(); if (version !== this.storageVersion) continue; throw error; }
        this.assertActive(); if (version !== this.storageVersion) continue;
        if (!saved) throw new Error('Authentication session persistence failed');
      }
      return { token, user, session, version };
    }
  }
  private async readAndApplySnapshot(): Promise<void> {
    for (;;) {
      const state = await this.readSnapshot(); this.assertActive();
      // An event can arrive in the microtask after the storage read returns.
      if (state.version !== this.storageVersion) continue;
      this.apply(state); return;
    }
  }

  async initialize(): Promise<void> {
    this.assertActive();
    this.initializationStarted = true;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        await this.readAndApplySnapshot();
        if (this.cachedToken) this.publish();
      } catch (error) {
        if (!this.disposed) { this.invalidate(); this.logger.error('[AuthTokenService] Initialization failed'); }
        throw error;
      }
    })().finally(() => { this.initPromise = null; });
    return this.initPromise;
  }
  async ensureInitialized(): Promise<void> {
    this.assertActive();
    if (!this.initialized) {
      try { await this.initialize(); }
      catch (error) {
        // Invalid persisted metadata is an unauthenticated state. A fresh OAuth
        // flow may replace it explicitly; I/O failures must still propagate.
        if (!(error instanceof AuthStorageValidationError)) throw error;
      }
    }
  }
  async refresh(): Promise<void> { await this.initialize(); }
  getToken(): string | null { return this.cachedToken; }
  hasToken(): boolean { return this.cachedToken !== null; }
  getSessionId(): string { return this.sessionId; }
  getUserCache(): UserCache | null { return this.cachedUserCache ? { ...this.cachedUserCache } : null; }

  async setToken(token: string, userCache?: UserCache, isCurrent: () => boolean = () => true): Promise<void> {
    // Capture caller-owned data before initialization or an earlier queued write.
    const capturedToken = parseToken(token);
    if (capturedToken === null) throw new Error('Empty authentication token');
    const capturedUser = parseAuthUserCache(userCache);
    await this.ensureInitialized();
    return this.serialize(async () => {
      if (!isCurrent()) throw new Error('Authentication operation superseded');
      const version = ++this.storageVersion;
      const session = capturedToken === this.cachedToken && capturedUser !== null
        && capturedUser.userId === this.cachedUserCache?.userId ? this.sessionId : crypto.randomUUID();
      const saved = await this.storage.setMultiple({ [AUTH_STORAGE_KEY]: capturedToken,
        [AUTH_USER_CACHE_KEY]: capturedUser ? { ...capturedUser } : null, [AUTH_SESSION_KEY]: session });
      this.assertActive();
      if (!saved) throw new Error('Authentication storage write failed');
      try {
        // Native updates delivered while awaiting persistence take precedence.
        if (version === this.storageVersion) {
          this.unboundToken = null; this.unboundSession = null;
          this.apply({ token: capturedToken, user: capturedUser, session });
        }
        else await this.readAndApplySnapshot();
        this.publish();
      } catch (error) { if (!this.disposed) this.invalidate(); throw error; }
    });
  }

  async clearToken(isCurrent: () => boolean = () => true): Promise<void> {
    await this.ensureInitialized();
    return this.serialize(async () => {
      if (!isCurrent()) throw new Error('Authentication operation superseded');
      const version = ++this.storageVersion;
      const session = crypto.randomUUID();
      // One storage operation prevents a trailing cleanup from deleting the
      // metadata of an account committed after this logout. Chrome storage has
      // no cross-writer compare-and-swap; the last committed snapshot wins.
      const saved = await this.storage.setMultiple({ [AUTH_STORAGE_KEY]: null,
        [AUTH_USER_CACHE_KEY]: null, [AUTH_SESSION_KEY]: session });
      this.assertActive();
      if (!saved) throw new Error('Authentication logout storage write failed');
      try {
        if (version === this.storageVersion) {
          this.unboundToken = null; this.unboundSession = null;
          this.apply({ token: null, user: null, session });
        } else await this.readAndApplySnapshot();
        this.publish();
      } catch (error) { if (!this.disposed) this.invalidate(); throw error; }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.storageVersion++;
    chrome.storage.onChanged.removeListener(this.storageListener);
    this.cachedToken = null; this.cachedUserCache = null; this.sessionId = ''; this.initialized = false;
  }
}
