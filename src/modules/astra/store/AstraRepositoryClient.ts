import { MSG } from '@shared/messages';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { AstraSection, AstraSettings, AstraWork } from '../AstraInterfaces';
import { AstraConflictError, AstraRepository } from './AstraRepository';
import { type AstraSnapshot } from './AstraPersistence';
import type { AstraCommand } from './AstraRepositoryProtocol';
import { logger } from '@core/logger';
import type { AuthStateClient } from '@core/auth/AuthStateClient';
import { DEFAULT_SECTIONS, DEFAULT_SETTINGS } from '../utils/AstraConstants';
import { needsLocalStorageBridge } from '@core/storage/LocalStorageBridge';
import { inject, injectable, type Disposable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import { BackgroundOperationError } from '@core/errors/OperationFailure';
import type { SeasonalChoices } from '../services/SeasonalWrappedModel';

/** Read-side snapshot for a tab. All persistence goes to the background writer. */
@injectable()
export class AstraRepositoryClient extends AstraRepository implements Disposable {
  private ready: Promise<void> | null = null;
  private refreshing: Promise<void> | null = null;
  private dirty = false;
  private disposed = false;
  private epoch = 0;
  private unsubscribers: Array<() => void> = [];

  constructor(@inject(TOKENS.EventBus) eventBus: IEventBus, @inject(TOKENS.LocalStorage) storage: IStorageService,
    @inject(TOKENS.AuthTokenService) private auth: AuthStateClient) {
    super(eventBus, storage);
    const changed = () => {
      if (this.disposed) return;
      this.dirty = true;
      if (this.ready) void this.refresh().catch(error => { if (!this.disposed) logger.error('[AstraRepositoryClient] Refresh failed', error); });
    };
    {
      const revisionKey = (key: string) => /astra_account_(?:[1-9]\d*|local)_au_astra_revision$/.test(key);
      if (needsLocalStorageBridge()) {
        const events = chrome.runtime.onMessage;
        const listener = (message: unknown) => {
          if (this.disposed || !message || typeof message !== 'object') return;
          const signal = message as Record<string, unknown>;
          if (signal.type === MSG.LOCAL_CHANGED && Array.isArray(signal.keys) && signal.keys.every(key => typeof key === 'string') && signal.keys.some(revisionKey)) changed();
        };
        events.addListener(listener); this.unsubscribers.push(() => events.removeListener(listener));
      } else {
        const events = chrome.storage.onChanged;
        const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
          if (!this.disposed && area === 'local' && Object.keys(changes).some(revisionKey)) changed();
        };
        events.addListener(listener); this.unsubscribers.push(() => events.removeListener(listener));
      }
      this.unsubscribers.push(eventBus.on(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
        if (this.disposed) return;
        this.epoch++;
        this.applySnapshot({ summaries: [], sections: structuredClone(DEFAULT_SECTIONS), settings: { ...DEFAULT_SETTINGS }, revision: 0 });
        this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { timestamp: new Date() });
        if (!this.disposed && this.ready) { this.ready = null; void this.init().catch(error => { if (!this.disposed) logger.error('[AstraRepositoryClient] Account refresh failed', error); }); }
      }).unsubscribe);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.epoch++;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.ready = null; this.refreshing = null; this.dirty = false;
    this.applySnapshot({ summaries: [], sections: structuredClone(DEFAULT_SECTIONS), settings: { ...DEFAULT_SETTINGS }, revision: 0 });
  }
  private assertActive(): void { if (this.disposed) throw new Error('Astra repository client disposed'); }
  private assertCurrent(epoch: number, session: string | undefined): void {
    this.assertActive();
    if (epoch !== this.epoch || session !== this.auth.getSessionId()) throw new Error('Astra account changed');
  }
  override init(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Astra repository client disposed'));
    if (!this.ready) {
      const pending = this.refresh().catch(error => { if (this.ready === pending) this.ready = null; throw error; });
      this.ready = pending;
    }
    return this.ready;
  }
  private refresh(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Astra repository client disposed'));
    this.dirty = true;
    if (this.refreshing) return this.refreshing;
    const pending = (async () => {
      do {
        this.dirty = false;
        const session = this.auth.getSessionId();
        const epoch = this.epoch;
        let snapshot: AstraSnapshot;
        try { snapshot = await this.request<AstraSnapshot>('getSnapshot'); }
        catch (error) {
          this.assertActive();
          if (epoch !== this.epoch || session !== this.auth.getSessionId()) { this.dirty = true; continue; }
          throw error;
        }
        this.assertCurrent(epoch, session);
        if (snapshot.ownerId !== this.snapshot.ownerId || snapshot.revision >= this.snapshot.revision) {
          this.applySnapshot(snapshot);
          this.eventBus.emit(EVENT_TYPES.ASTRA_DATA_UPDATED, { timestamp: new Date() });
        }
        this.assertActive();
      } while (this.dirty);
    })().finally(() => { if (this.refreshing === pending) this.refreshing = null; });
    this.refreshing = pending;
    return pending;
  }
  private async request<T>(command: AstraCommand, args: unknown[] = []): Promise<T> {
    this.assertActive();
    const epoch = this.epoch;
    const openingSession = this.auth.getSessionId();
    try { await this.auth.ensureInitialized(); }
    catch (error) { this.assertActive(); throw error; }
    this.assertActive();
    if (epoch !== this.epoch) throw new Error('Astra account changed');
    const sessionId = this.auth.getSessionId();
    if (!sessionId) throw new Error('Astra account session unavailable');
    if (openingSession !== undefined && openingSession !== sessionId) throw new Error('Astra account changed');
    let response;
    try { response = await chrome.runtime.sendMessage({ type: MSG.ASTRA_COMMAND, command, args, sessionId }); }
    catch (error) { this.assertCurrent(epoch, sessionId); throw error; }
    this.assertCurrent(epoch, sessionId);
    if (!response || response.success !== true) {
      if (response?.code === 'ACCOUNT_CHANGED') {
        try { await this.auth.refresh(); } catch (error) { this.assertActive(); throw error; }
      }
      this.assertActive();
      if (response?.code === 'ASTRA_CONFLICT') throw new AstraConflictError();
      throw new BackgroundOperationError('Astra background operation failed', response?.failureCode, response?.validationField);
    }
    return response.data as T;
  }
  private async mutate<T>(command: AstraCommand, args: unknown[] = []): Promise<T> {
    const epoch = this.epoch; const session = this.auth.getSessionId();
    const result = await this.request<T>(command, args);
    this.assertCurrent(epoch, session);
    // Refresh errors must not turn a committed write into a reported failure.
    await this.refresh().catch(error => { if (!this.disposed) logger.error('[AstraRepositoryClient] Committed state refresh failed', error); });
    this.assertCurrent(epoch, session);
    return result;
  }
  override async getSnapshot(): Promise<AstraSnapshot> {
    const epoch = this.epoch; const session = this.auth.getSessionId();
    await this.refresh(); this.assertCurrent(epoch, session); return structuredClone(this.snapshot);
  }
  override getFullWork(id: number): Promise<AstraWork | undefined> { return this.request('getFullWork', [id]); }
  override async saveWork(work: Partial<AstraWork> & { mediaId: number }): Promise<AstraWork> { this.assertActive(); return this.mutate('saveWork', [structuredClone(work)]); }
  override async saveWorks(works: (Partial<AstraWork> & { mediaId: number })[]): Promise<AstraWork[]> { this.assertActive(); return this.mutate('saveWorks', [structuredClone(works)]); }
  override deleteWork(id: number): Promise<void> { return this.mutate('deleteWork', [id]); }
  override persist(): Promise<void> { return this.mutate('persist'); }
  override updateSettings(settings: Partial<AstraSettings>): Promise<void> { return this.mutate('updateSettings', [settings]); }
  override updateSections(sections: AstraSection[]): Promise<void> { return this.mutate('updateSections', [sections]); }
  override addSection(name: string): Promise<void> { return this.mutate('addSection', [name]); }
  override removeSection(id: string): Promise<void> { return this.mutate('removeSection', [id]); }
  override updateSectionWeight(id: string, weight: number): Promise<void> { return this.mutate('updateSectionWeight', [id, weight]); }
  override updateSectionName(id: string, name: string): Promise<void> { return this.mutate('updateSectionName', [id, name]); }
  override addSubSection(id: string, name: string): Promise<void> { return this.mutate('addSubSection', [id, name]); }
  override removeSubSection(id: string, subId: string): Promise<void> { return this.mutate('removeSubSection', [id, subId]); }
  override updateSubSectionWeight(id: string, subId: string, weight: number): Promise<void> { return this.mutate('updateSubSectionWeight', [id, subId, weight]); }
  override updateSubSectionName(id: string, subId: string, name: string): Promise<void> { return this.mutate('updateSubSectionName', [id, subId, name]); }
  override factoryReset(): Promise<void> { return this.mutate('factoryReset'); }
  override exportJSON(): Promise<string> { return this.request('exportJSON'); }
  override importJSON(json: string): Promise<boolean> { return this.mutate('importJSON', [json]); }
  override saveSeasonalChoices(key: string, choices: SeasonalChoices): Promise<SeasonalChoices> { return this.mutate('saveSeasonalChoices', [key, structuredClone(choices)]); }
}
