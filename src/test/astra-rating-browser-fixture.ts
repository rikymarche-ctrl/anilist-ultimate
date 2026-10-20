import { ratingInitialResponse } from '@modules/astra/services/AstraRatingResponse';
import { AstraRatingService } from '@modules/astra/services/AstraRatingService';
import type { AstraService } from '@modules/astra/AstraService';
import type { IAstraParser } from '@modules/astra/interfaces/IAstraParser';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ISyncQueueService } from '@core/interfaces/ISyncQueueService';
import { ratingResponse } from './astra-rating-fixtures';

export async function runAstraRatingBrowserFixture(): Promise<string[]> {
  const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  const checks: string[] = [];
  const raw = ratingResponse();
  Object.assign(raw.Media.mediaListEntry, { notes: null, score: 0 });
  const parsed = ratingInitialResponse(raw, 1, 42)!;
  raw.Media.mediaListEntry.startedAt.year = 1999;
  assert(parsed.media.mediaListEntry?.notes === '' && parsed.media.mediaListEntry.score === 0
    && parsed.media.mediaListEntry.startedAt?.year === 2026, 'nullable notes/zero scores and detached dates must be preserved');
  checks.push('Astra initial data projects nullable notes, zero scores and independent nested dates');
  let context = { sessionId: 'one', userId: 42 }; let response: unknown = ratingResponse();
  const api = { ensureContext: async () => ({ ...context }), getContext: () => ({ ...context }),
    query: async () => response };
  const service = new AstraRatingService({} as AstraService, api as unknown as IApiClient,
    { getSnapshot: async () => ({ revision: 'native-stable', entries: [] }) } as unknown as ISyncQueueService, {} as IAstraParser);
  response = { ...ratingResponse(), Viewer: { ...ratingResponse().Viewer, id: 43 } };
  assert(await service.getMediaRatingData(1) === null, 'a foreign viewer must not initialize the form');
  checks.push('Astra initial service rejects foreign viewer identity before exposing personal list data');
  api.query = async () => { context = { sessionId: 'two', userId: 42 }; return ratingResponse(); };
  assert(await service.getMediaRatingData(1) === null, 'same-account relogin must discard the old form response');
  checks.push('Astra initial service discards a response from the previous session of the same account');
  return checks;
}
