import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import type { AstraService } from '../AstraService';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { SEASONAL_WRAPPED_QUERY } from '@/api/queries/seasonal-wrapped';
import { seasonalCollection } from './SeasonalWrappedResponse';
import { parseAstraBackup, type AstraBackup } from '../store/AstraBackup';
import type { SeasonalChoices, SeasonalEntry, SeasonalPeriod } from './SeasonalWrappedModel';
import { emptySeasonalChoices, latestReleasedSeason, seasonKey } from './SeasonalWrappedModel';

export interface SeasonalData { entries: SeasonalEntry[]; backup: AstraBackup; ownerId: number; loadedAt: number; context?: ApiContext }
@injectable()
export class SeasonalWrappedService {
  constructor(@inject(TOKENS.AstraService) private astra: AstraService, @inject(TOKENS.ApiClient) private api: IApiClient) {}

  /** Return the newest released season the account has not opened yet. */
  async getPendingRelease(now = new Date()): Promise<SeasonalPeriod | null> {
    const context = await captureApiContext(this.api);
    const owner = context?.userId ?? await this.api.getCurrentUserId();
    if (!owner || !this.api.isAuthenticated()) return null;
    assertApiContext(this.api, context, owner);
    const backup = parseAstraBackup(await this.astra.exportJSON());
    assertApiContext(this.api, context, owner);
    for (const work of Object.values(backup.works)) if (work.ownerId !== undefined && work.ownerId !== owner) throw new Error('Astra account changed');
    const period = latestReleasedSeason(now);
    return backup.seasonalWrapped?.[seasonKey(period)]?.releaseSeenAt ? null : period;
  }

  async load(isCurrent: () => boolean): Promise<SeasonalData> {
    const context = await captureApiContext(this.api);
    const owner = context?.userId ?? await this.api.getCurrentUserId();
    const check = () => { assertApiContext(this.api, context); if (!isCurrent()) throw new Error('Seasonal Wrapped closed'); };
    check();
    if (!owner || !this.api.isAuthenticated()) throw new Error('Sign in to AniList to open Seasonal Wrapped.');
    const entries = new Map<number, SeasonalEntry>();
    for (let chunk = 1; chunk <= 40; chunk++) {
      check();
      const response = await this.api.query<unknown>(SEASONAL_WRAPPED_QUERY, { userId: owner, chunk, perChunk: 500 }, true);
      check();
      const page = seasonalCollection(response, owner);
      for (const entry of page.entries) {
        const previous = entries.get(entry.mediaId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw new Error('Your list changed while loading. Please refresh.');
        entries.set(entry.mediaId, entry);
      }
      if (entries.size > 10000 || (page.hasNextChunk && (page.entries.length === 0 || chunk === 40))) throw new Error('Could not load the complete anime list.');
      if (!page.hasNextChunk) break;
    }
    check();
    const backup = parseAstraBackup(await this.astra.exportJSON());
    check();
    for (const work of Object.values(backup.works)) if (work.ownerId !== undefined && work.ownerId !== owner) throw new Error('Astra account changed');
    return { entries: [...entries.values()], backup, ownerId: owner, loadedAt: Date.now(), context };
  }

  getChoices(data: SeasonalData, period: SeasonalPeriod): SeasonalChoices {
    return structuredClone(data.backup.seasonalWrapped?.[seasonKey(period)] ?? emptySeasonalChoices());
  }

  async saveChoices(data: SeasonalData, period: SeasonalPeriod, choices: SeasonalChoices, isCurrent = () => true): Promise<SeasonalChoices> {
    const context = await captureApiContext(this.api);
    if (!isCurrent()) throw new Error('Seasonal Wrapped closed');
    assertApiContext(this.api, data.context, data.ownerId);
    assertApiContext(this.api, context, data.ownerId);
    if (!isCurrent()) throw new Error('Seasonal Wrapped closed');
    const saved = await this.astra.saveSeasonalChoices(seasonKey(period), choices);
    assertApiContext(this.api, context, data.ownerId);
    data.backup.seasonalWrapped ??= {};
    data.backup.seasonalWrapped[seasonKey(period)] = saved;
    return structuredClone(saved);
  }
}
