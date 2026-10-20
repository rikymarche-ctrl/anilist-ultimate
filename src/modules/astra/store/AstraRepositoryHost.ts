import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { IStorageService } from '@core/interfaces/IStorageService';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { AuthTokenService } from '@core/auth/AuthTokenService';
import { ScopedStorage } from '@core/storage/ScopedStorage';
import { AstraRepository } from './AstraRepository';
import { dispatchAstraCommand } from './AstraRepositoryProtocol';
/** Background account host with isolated account and local workspaces. */
@injectable()
export class AstraRepositoryHost {
  private repositories = new Map<number | null, Promise<AstraRepository>>();
  constructor(
    @inject(TOKENS.EventBus) private bus: IEventBus,
    @inject(TOKENS.LocalStorage) private storage: IStorageService,
    @inject(TOKENS.AuthTokenService) private auth: AuthTokenService,
  ) {}

  async initialize(): Promise<void> {
    await this.auth.ensureInitialized();
  }

  async dispatch(command: unknown, args: unknown, sessionId: unknown): Promise<unknown> {
    await this.auth.ensureInitialized();
    if (typeof sessionId !== 'string' || !sessionId || sessionId !== this.auth.getSessionId()) throw new Error('Astra account changed');
    const ownerId = this.currentOwner();
    const repo = await this.getRepository(ownerId);
    if (sessionId !== this.auth.getSessionId()) throw new Error('Astra account changed');
    const result = await dispatchAstraCommand(repo, command, args);
    if (sessionId !== this.auth.getSessionId()) throw new Error('Astra account changed');
    if (command === 'getSnapshot') return { ...result as object, ownerId, sessionId };
    return result;
  }

  /** Only the trusted settings recovery route can invoke explicit association. */
  async recovery(operation: unknown, sessionId: unknown): Promise<string | boolean> {
    await this.auth.ensureInitialized();
    const owner = this.currentOwner();
    const assertCurrent = () => {
      if (!owner || typeof sessionId !== 'string' || sessionId !== this.auth.getSessionId()) throw new Error('Astra account changed');
    };
    assertCurrent();
    if (!['exportLocal', 'claimLocal'].includes(operation as string)) throw new Error('Invalid Astra recovery command');
    const source = await this.getRepository(null);
    const backup = await source.exportJSON();
    assertCurrent();
    if (operation === 'exportLocal') return backup;
    const target = await this.getRepository(owner);
    const snapshot = await target.getSnapshot();
    assertCurrent();
    if (snapshot.summaries.length) throw new Error('Current account archive is not empty. Export both archives and resolve before importing.');
    // The revision/empty precondition is checked inside the repository's writer lock.
    if (!(await target.importJSON(backup, snapshot.revision))) throw new Error('Astra recovery interrupted or archive changed; originals preserved');
    assertCurrent();
    return true;
  }

  private currentOwner(): number | null {
    if (!this.auth.hasToken()) return null;
    const id = this.auth.getUserCache()?.userId ?? null;
    if (id !== null && (!Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid Astra account owner');
    return id;
  }

  private getRepository(ownerId: number | null): Promise<AstraRepository> {
    let ready = this.repositories.get(ownerId);
    if (!ready) {
      ready = this.open(ownerId).catch(error => { this.repositories.delete(ownerId); throw error; });
      this.repositories.set(ownerId, ready);
    }
    return ready;
  }
  private async open(ownerId: number | null): Promise<AstraRepository> {
    const scoped = new ScopedStorage(this.storage, `astra_account_${ownerId ?? 'local'}_`);
    const repo = new AstraRepository(this.bus, scoped);
    repo.setOwner(ownerId);
    await repo.init();
    return repo;
  }
}
