import type { IStorageService } from '@core/interfaces/IStorageService';
import type { AstraSection, AstraSettings, AstraWorkSummary } from '../AstraInterfaces';

export const ASTRA_KEYS = {
  manifest: 'au_astra_manifest', sections: 'au_astra_sections', settings: 'au_astra_settings',
  revision: 'au_astra_revision', journal: 'au_astra_pending_commit', workPrefix: 'au_astra_work_',
  seasonal: 'au_astra_seasonal_wrapped',
} as const;

export interface AstraSnapshot {
  ownerId?: number | null;
  sessionId?: string;
  summaries: AstraWorkSummary[];
  sections: AstraSection[];
  settings: AstraSettings;
  revision: number;
}
interface PendingCommit {
  version: 1;
  writes: Record<string, unknown>;
  removals: string[];
}

/** A durable redo journal. Only the background repository is allowed to write. */
export class AstraPersistence {
  constructor(private storage: IStorageService) {}

  async recover(): Promise<boolean> {
    const pending = await this.storage.get<PendingCommit>(ASTRA_KEYS.journal);
    if (!pending) return false;
    if (pending.version !== 1 || !pending.writes || typeof pending.writes !== 'object'
      || Array.isArray(pending.writes) || !Array.isArray(pending.removals)
      || !Object.keys(pending.writes).every(key => this.allowedKey(key))
      || !pending.removals.every(key => typeof key === 'string' && /^au_astra_work_[1-9]\d*$/.test(key))
      || !Number.isSafeInteger(pending.writes[ASTRA_KEYS.revision])
      || !Array.isArray(pending.writes[ASTRA_KEYS.manifest])) {
      throw new Error('Invalid Astra recovery journal; original data preserved');
    }
    await this.apply(pending);
    return true;
  }

  async commit(snapshot: AstraSnapshot, works: Record<string, unknown> = {}, removals: string[] = []): Promise<void> {
    const pending: PendingCommit = {
      version: 1, removals,
      writes: {
        ...works,
        [ASTRA_KEYS.manifest]: snapshot.summaries,
        [ASTRA_KEYS.sections]: snapshot.sections,
        [ASTRA_KEYS.settings]: snapshot.settings,
        [ASTRA_KEYS.revision]: snapshot.revision,
      },
    };
    if (!(await this.storage.set(ASTRA_KEYS.journal, pending))) throw new Error('Astra storage journal write failed');
    // A failed apply leaves the intent durable. Recovery finishes this same
    // operation before a later read/write; it never starts a competing commit.
    await this.apply(pending);
  }

  private async apply(pending: PendingCommit): Promise<void> {
    if (!(await this.storage.setMultiple(pending.writes))) throw new Error('Astra storage commit pending recovery');
    for (const key of pending.removals) {
      if (!(await this.storage.remove(key))) throw new Error('Astra storage removal pending recovery');
    }
    if (!(await this.storage.remove(ASTRA_KEYS.journal))) throw new Error('Astra storage finalization pending recovery');
  }

  private allowedKey(key: string): boolean {
    return [ASTRA_KEYS.manifest, ASTRA_KEYS.sections, ASTRA_KEYS.settings, ASTRA_KEYS.revision, ASTRA_KEYS.seasonal].includes(key as never)
      || /^au_astra_work_[1-9]\d*$/.test(key);
  }
}
