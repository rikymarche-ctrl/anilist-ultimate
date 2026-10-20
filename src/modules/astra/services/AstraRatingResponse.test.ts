import { describe, expect, it, vi } from 'vitest';
vi.mock('../AstraService', () => ({ AstraService: class {} }));
import { AstraRatingService } from './AstraRatingService';
import { ratingResponse } from '@/test/astra-rating-fixtures';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { AstraService } from '../AstraService';
import type { ISyncQueueService } from '@core/interfaces/ISyncQueueService';
import type { IAstraParser } from '../interfaces/IAstraParser';

function setup(response: unknown = ratingResponse()) {
  let context = { sessionId: 'one', userId: 42 };
  const api = { query: vi.fn(async (_query: string, _variables?: Record<string, unknown>): Promise<unknown> => response), ensureContext: async () => ({ ...context }),
    getContext: () => ({ ...context }), getCurrentUserId: vi.fn(async () => context.userId) };
  const service = new AstraRatingService({} as AstraService, api as unknown as IApiClient, { getSnapshot: async () => ({ revision: 'test', entries: [] }) } as unknown as ISyncQueueService, {} as IAstraParser);
  return { api, service, switchContext: (sessionId: string, userId = 42) => { context = { sessionId, userId }; } };
}

describe('Astra initial form response boundary', () => {
  it.each([
    ['media', (r: ReturnType<typeof ratingResponse>) => { r.Media.id = 2; }],
    ['viewer', (r: ReturnType<typeof ratingResponse>) => { r.Viewer.id = 43; }],
    ['entry media', (r: ReturnType<typeof ratingResponse>) => { r.Media.mediaListEntry.mediaId = 2; }],
    ['entry owner', (r: ReturnType<typeof ratingResponse>) => { r.Media.mediaListEntry.userId = 43; }],
    ['entry identity', (r: ReturnType<typeof ratingResponse>) => { r.Media.mediaListEntry.id = 0; }],
  ])('rejects unrelated %s', async (_name, change) => {
    const response = ratingResponse(); change(response);
    expect(await setup(response).service.getMediaRatingData(1)).toBeNull();
  });

  it.each([
    ['notes', undefined], ['notes', {}], ['progress', -1], ['progress', 2147483648], ['progress', '3'],
    ['repeat', 0.5], ['score', -1], ['score', 101], ['score', '5'], ['private', 'false'],
    ['hiddenFromStatusLists', undefined], ['status', 'WATCHING'], ['customLists', { Favorites: 'yes' }],
    ['customLists', ['Favorites']], ['startedAt', { year: 2026, month: 13, day: null }],
    ['completedAt', { year: 2026, month: 2, day: undefined }],
    ['startedAt', { year: 2026, month: 2, day: 30 }],
  ])('rejects malformed entry %s=%j', async (key, value) => {
    const response = ratingResponse(); Object.assign(response.Media.mediaListEntry, { [key]: value });
    expect(await setup(response).service.getMediaRatingData(1)).toBeNull();
  });

  it.each([null, {}, [], { Media: null }, { Media: ratingResponse().Media, Viewer: null }])('rejects incomplete envelope %j', async response => {
    expect(await setup(response).service.getMediaRatingData(1)).toBeNull();
  });

  it.each([0, -1, NaN, 1.5, 2147483648])('rejects media ID %s before network access', async id => {
    const { api, service } = setup();
    expect(await service.getMediaRatingData(id)).toBeNull(); expect(api.query).not.toHaveBeenCalled();
  });

  it('discards a response after relogin to the same account', async () => {
    const { api, service, switchContext } = setup();
    api.query.mockImplementationOnce(async () => { switchContext('two'); return ratingResponse(); });
    expect(await service.getMediaRatingData(1)).toBeNull();
  });

  it('accepts nullable fields, keeps zero scores and projects detached copies', async () => {
    const response = ratingResponse();
    Object.assign(response.Media, { title: null, coverImage: null, episodes: null, nextAiringEpisode: null, format: null, status: null, countryOfOrigin: null });
    Object.assign(response.Media.mediaListEntry, { notes: null, score: 0, progress: null, repeat: null, status: null,
      private: null, hiddenFromStatusLists: null, customLists: null });
    const { service } = setup(response);
    const result = await service.getMediaRatingData(1);
    expect(result?.media.title.userPreferred).toBe('Media 1');
    expect(result?.media.mediaListEntry).toMatchObject({ notes: '', score: 0, progress: 0, repeat: 0 });
    expect(result?.media.coverImage).toEqual({});
    response.Media.mediaListEntry.startedAt.year = 1999;
    response.Viewer.mediaListOptions.animeList.customLists.push('Other');
    expect(result?.media.mediaListEntry?.startedAt?.year).toBe(2026);
    expect(result?.allCustomLists).toEqual(['Favorites']);
  });

  it('selects manga lists and does not expose unselected/private response properties', async () => {
    const response = ratingResponse(); Object.assign(response.Media, { type: 'MANGA', format: 'NOVEL', chapters: 20, privateExtra: 'secret' });
    const { service, api } = setup(response);
    const result = await service.getMediaRatingData(1);
    expect(result?.allCustomLists).toEqual(['Manga']); expect(result?.media.chapters).toBe(20);
    expect(result?.media).not.toHaveProperty('privateExtra');
    expect(api.query.mock.calls[0][0]).toContain('userId');
  });

  it.each([['type', null], ['title', {}], ['episodes', '12'], ['chapters', -1],
    ['format', 'UNKNOWN'], ['status', undefined], ['coverImage', { large: 123, extraLarge: null, color: null }],
    ['nextAiringEpisode', { episode: 0 }], ['countryOfOrigin', {}]])('rejects malformed media %s', async (key, value) => {
    const response = ratingResponse(); Object.assign(response.Media, { [key]: value });
    expect(await setup(response).service.getMediaRatingData(1)).toBeNull();
  });

  it('distinguishes an absent list entry from unreadable notes', async () => {
    const response = ratingResponse(); Object.assign(response.Media, { mediaListEntry: null });
    expect((await setup(response).service.getMediaRatingData(1))?.media.mediaListEntry).toBeNull();
  });

  it.each([null, { animeList: null }, { animeList: { customLists: null } }, { animeList: { customLists: ['A', null, 'B'] } }])(
    'accepts nullable viewer list preferences %j', async options => {
      const response = ratingResponse(); Object.assign(response.Viewer, { mediaListOptions: options });
      const result = await setup(response).service.getMediaRatingData(1);
      expect(result?.allCustomLists).toEqual(options?.animeList?.customLists ? ['A', 'B'] : []);
    });

  it('rejects an unreadable custom-list name instead of presenting an empty selection', async () => {
    const response = ratingResponse(); Object.assign(response.Viewer.mediaListOptions.animeList, { customLists: ['A', {}] });
    expect(await setup(response).service.getMediaRatingData(1)).toBeNull();
  });
});
