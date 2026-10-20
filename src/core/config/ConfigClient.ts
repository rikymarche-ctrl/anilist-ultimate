import type { IEventBus } from '@core/interfaces/IEventBus';
import type { IStorageService } from '@core/interfaces/IStorageService';
import { ConfigManager } from './ConfigManager';
import type { AppConfig } from './types';
import { configDifference } from './ConfigProtocol';
import { MSG } from '@shared/messages';
import { logger } from '@core/logger';
import { inject, injectable, type Disposable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';

/** Background owns config updates; tab snapshots receive native sync signals. */
@injectable()
export class ConfigClient extends ConfigManager implements Disposable {
  private requests: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly unsubscribeStorage: () => void;
  constructor(@inject(TOKENS.Storage) storage: IStorageService, @inject(TOKENS.EventBus) bus: IEventBus) {
    super(storage, bus);
    this.unsubscribeStorage = storage.onChange('anilist_ultimate_config', () => {
      if (!this.disposed) void this.load().catch(error => { if (!this.disposed) logger.error('[ConfigClient] Refresh failed', error); });
    });
  }
  protected override canPublish(): boolean { return !this.disposed; }
  private assertActive(): void { if (this.disposed) throw new Error('Configuration client disposed'); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeStorage();
    this.clearChangeListeners();
  }
  private request(operation: string, value?: unknown): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Configuration client disposed'));
    const detached = value === undefined ? undefined : structuredClone(value);
    const pending = this.requests.then(async () => {
      this.assertActive();
      let response: unknown;
      try { response = await chrome.runtime.sendMessage({ type: MSG.CONFIG_COMMAND, operation, value: detached }); }
      catch (error) { this.assertActive(); throw error; }
      this.assertActive();
      if (!response || typeof response !== 'object' || !('success' in response) || response.success !== true || !('data' in response)) throw new Error('Background configuration operation failed');
      this.applyConfigSnapshot(response.data as AppConfig);
      this.assertActive();
    });
    this.requests = pending.catch(() => undefined);
    return pending;
  }
  override load(): Promise<void> { return this.request('get'); }
  override save(): Promise<void> { return this.request('get'); } // Mutations are already durable.
  override set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): Promise<void> {
    return this.request('patch', { [key]: configDifference(this.get(key), value) });
  }
  override setFeature(feature: keyof AppConfig['features'], enabled: boolean): Promise<void> { return this.request('feature', { feature, enabled }); }
  override reset(): Promise<void> { return this.request('reset'); }
  override applyPatch(patch: Partial<AppConfig>): Promise<void> { return this.request('patch', patch); }
}
