import { injectable, inject } from 'tsyringe';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { STORAGE_PREFIX } from '@core/constants';
import type { IEventBus } from '@core/interfaces/IEventBus';
import { TOKENS } from '@core/di/tokens';
import type { AuthStateClient } from '@core/auth/AuthStateClient';
import type { ISyncQueueService, QueuedMutation, SyncQueueSnapshot } from '@core/interfaces/ISyncQueueService';
import { syncProgressResult } from './SyncResponse';
import { syncQueueSnapshot } from './SyncQueueSnapshot';
import { MSG } from '@shared/messages';
import { isExtensionPageContext } from '@core/utils/ExtensionPage';
import type { AstraProgressResult } from '@/modules/astra/interfaces/IAstraRatingService';
import { BackgroundOperationError } from '@core/errors/OperationFailure';

/** Tab/popup facade. Only the background worker writes/processes the durable queue. */
@injectable()
export class SyncQueueClient implements ISyncQueueService {
  private disposed = false;
  private messageListener?: (message: unknown, sender: chrome.runtime.MessageSender) => void;
  private storageListener?: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
  constructor(@inject(TOKENS.AuthTokenService) private auth?: AuthStateClient,
    @inject(TOKENS.EventBus) private eventBus?: IEventBus) {
    if (!eventBus) return;
    this.messageListener = (message, sender) => {
      if (!this.disposed && sender.id === chrome.runtime.id && message && typeof message === 'object'
        && 'type' in message && message.type === MSG.LOCAL_CHANGED
        && 'syncQueueChanged' in message && message.syncQueueChanged === true) {
        this.eventBus?.emit(EVENT_TYPES.SYNC_QUEUE_CHANGED, undefined);
      }
    };
    this.storageListener = (changes, area) => {
      if (!this.disposed && area === 'local' && isExtensionPageContext()
        && `${STORAGE_PREFIX}sync_queue_v1` in changes) this.eventBus?.emit(EVENT_TYPES.SYNC_QUEUE_CHANGED, undefined);
    };
    chrome.runtime.onMessage.addListener(this.messageListener);
    chrome.storage.onChanged?.addListener(this.storageListener);
  }
  public dispose(): void {
    this.disposed = true;
    if (this.messageListener) chrome.runtime.onMessage.removeListener(this.messageListener);
    if (this.storageListener) chrome.storage.onChanged?.removeListener(this.storageListener);
    this.messageListener = undefined; this.storageListener = undefined;
  }
  private async request<T>(type: string, data: Record<string, unknown> = {}): Promise<T> {
    const session = this.auth?.getSessionId();
    await this.auth?.ensureInitialized();
    if (session && session !== this.auth?.getSessionId()) throw new Error('Sync account changed');
    if (data.sessionId && data.sessionId !== this.auth?.getSessionId()) throw new Error('Sync account changed');
    const sessionId = this.auth?.getSessionId();
    const response = await chrome.runtime.sendMessage({ type, sessionId, ...data });
    if (sessionId !== this.auth?.getSessionId()) throw new Error('Sync account changed');
    if (!response || response.success !== true) throw new BackgroundOperationError(response?.error || 'Background queue unavailable', response?.failureCode);
    return response.data as T;
  }

  async enqueue(type: QueuedMutation['type'], payload: unknown, expectedSession?: string): Promise<void> {
    await this.request(MSG.SYNC_ENQUEUE, { mutationType: type, payload: structuredClone(payload), ...(expectedSession ? { sessionId: expectedSession } : {}) });
  }
  async process(): Promise<void> { await this.request(MSG.SYNC_PROCESS); }
  async updateProgress(mediaId: number, progress?: number, expectedSession?: string): Promise<AstraProgressResult> {
    const response = await this.request<unknown>(MSG.SYNC_PROGRESS, { mediaId, progress, ...(expectedSession ? { sessionId: expectedSession } : {}) });
    return syncProgressResult(response, mediaId, this.auth?.getUserCache?.()?.userId);
  }
  async appendNote(mediaId: number, episode: number, notes: string, expectedSession?: string): Promise<void> {
    await this.request(MSG.SYNC_NOTE, { mediaId, episode, notes, ...(expectedSession ? { sessionId: expectedSession } : {}) });
  }
  async recovery(operation: 'export' | 'retry' | 'notes', ids?: string[], expectedSession?: string): Promise<QueuedMutation[]> {
    return this.request(MSG.SYNC_RECOVERY, { operation, ids, ...(expectedSession ? { sessionId: expectedSession } : {}) });
  }
  async getSnapshot(): Promise<SyncQueueSnapshot> { return syncQueueSnapshot(await this.request(MSG.SYNC_SNAPSHOT)); }
  async getQueue(): Promise<QueuedMutation[]> { return this.request(MSG.SYNC_GET); }
  async clear(): Promise<void> { await this.request(MSG.SYNC_CLEAR); }
}
