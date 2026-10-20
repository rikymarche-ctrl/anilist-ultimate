import { inject, injectable, type Disposable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { AuthStateClient } from '@core/auth/AuthStateClient';
import type { EventSubscription, IEventBus } from '@core/interfaces/IEventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { logger } from '@core/logger';
import { MSG } from '@shared/messages';
import {
  CustomListService,
  validateCustomLists,
  type CustomListUser,
  type CustomLists,
} from './CustomListService';

/** Lists are validated JSON-shaped data, so a serialized comparison detects real membership changes. */
const sameLists = (left: CustomLists, right: CustomLists): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/** Synchronous defensive getters over a refreshed snapshot; all edits use RPC. */
@injectable()
export class CustomListClient extends CustomListService implements Disposable {
  private version = 0;
  private appliedVersion = 0;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly authSubscription: EventSubscription;
  private readonly runtimeEvents = chrome.runtime.onMessage;
  private readonly storageEvents = chrome.storage.onChanged;
  private readonly runtimeListener = (message: unknown): void => {
    if (this.disposed || !message || typeof message !== 'object') return;
    const signal = message as Record<string, unknown>;
    if (
      signal.type === MSG.LOCAL_CHANGED &&
      Array.isArray(signal.keys) &&
      signal.keys.some((key) => typeof key === 'string' && this.isListKey(key))
    )
      this.refresh();
  };
  private readonly storageListener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ): void => {
    if (
      !this.disposed &&
      area === 'local' &&
      Object.keys(changes).some((key) => this.isListKey(key))
    )
      this.refresh();
  };
  constructor(
    @inject(TOKENS.AuthTokenService) private auth: AuthStateClient,
    @inject(TOKENS.EventBus) bus: IEventBus
  ) {
    super();
    this.authSubscription = bus.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      if (this.disposed) return;
      this.version++;
      this.replaceLists({});
      this.refresh();
    });
    this.runtimeEvents.addListener(this.runtimeListener);
    this.storageEvents?.addListener(this.storageListener);
  }
  private isListKey(key: string): boolean {
    return key.includes('custom_lists_account_');
  }
  private refresh(): void {
    if (!this.disposed) void this.init().catch(() => undefined);
  }
  private assertActive(): void {
    if (this.disposed) throw new Error('Custom lists client disposed');
  }

  /** Subscribe to snapshot changes; the listener runs only when the lists actually differ. Returns the unsubscribe. */
  public onChange(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Retire view resources; RPC writes already accepted by the background remain owned there. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.version++;
    this.lists = {};
    this.listeners.clear();
    this.authSubscription.unsubscribe();
    this.runtimeEvents.removeListener(this.runtimeListener);
    this.storageEvents?.removeListener(this.storageListener);
  }
  private replaceLists(next: CustomLists): void {
    if (sameLists(this.lists, next)) return;
    this.lists = next;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        logger.error('[CustomListClient] Change listener failed', error);
      }
    }
  }
  private async request(operation: string, value?: unknown): Promise<void> {
    this.assertActive();
    const initial = this.auth.getSessionId();
    await this.auth.ensureInitialized();
    this.assertActive();
    if (initial && initial !== this.auth.getSessionId()) throw new Error('Lists account changed');
    const sessionId = this.auth.getSessionId();
    // Versions follow dispatch order; the background processes requests in arrival order, so a higher version is never older.
    const version = ++this.version;
    const response: unknown = await chrome.runtime.sendMessage({
      type: MSG.CUSTOM_LISTS,
      operation,
      value: structuredClone(value),
      sessionId,
    });
    this.assertActive();
    if (sessionId !== this.auth.getSessionId()) throw new Error('Lists account changed');
    if (
      !response ||
      typeof response !== 'object' ||
      !('success' in response) ||
      response.success !== true ||
      !('data' in response)
    )
      throw new Error('Custom lists operation failed');
    validateCustomLists(response.data);
    // A signal refresh dispatched after this write must not hide the write's acknowledgement; only older snapshots are stale.
    if (version > this.appliedVersion) {
      this.appliedVersion = version;
      this.replaceLists(structuredClone(response.data));
    }
  }
  override init(): Promise<void> {
    return this.request('get');
  }
  override toggleUserInList(name: string, user: CustomListUser, active: boolean): Promise<void> {
    return this.request('toggle', { name, user, active });
  }
  override createList(name: string): Promise<void> {
    return this.request('create', { name });
  }
  override deleteList(name: string): Promise<void> {
    return this.request('delete', { name });
  }
}
