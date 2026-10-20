import { describe, expect, it, vi } from 'vitest';
import { SeasonalWrappedService } from './SeasonalWrappedService';
import { seasonalEntry, seasonalResponse } from '@/test/seasonal-wrapped-fixtures';
import { DEFAULT_SECTIONS, DEFAULT_SETTINGS } from '../utils/AstraConstants';
import { emptySeasonalChoices } from './SeasonalWrappedModel';
import { seasonalCollection } from './SeasonalWrappedResponse';
import { validateApiRequest } from '@/api/ApiBoundary';
import { SEASONAL_WRAPPED_QUERY } from '@/api/queries/seasonal-wrapped';

function fixture() {
  let sessionId = 'one';
  let userId = 42;
  const astra = {
    exportJSON: vi.fn(async () =>
      JSON.stringify({
        schemaVersion: 1,
        manifest: [],
        works: {},
        sections: DEFAULT_SECTIONS,
        settings: DEFAULT_SETTINGS,
      })
    ),
    saveSeasonalChoices: vi.fn(
      async (_key: string, choices: ReturnType<typeof emptySeasonalChoices>) => ({
        ...choices,
        updatedAt: choices.updatedAt + 1,
      })
    ),
  };
  const api = {
    ensureContext: async () => ({ sessionId, userId }),
    getContext: () => ({ sessionId, userId }),
    getCurrentUserId: async () => userId,
    isAuthenticated: () => true,
    query: vi.fn(async () => seasonalResponse()),
  };
  return {
    astra,
    api,
    service: new SeasonalWrappedService(astra as never, api as never),
    switchAccount: (owner = 43) => {
      userId = owner;
      sessionId = 'two';
    },
  };
}

describe('Seasonal Wrapped collection transport', () => {
  it('passes the production API boundary and requests all start seasons to retain leftovers', () => {
    expect(
      validateApiRequest({
        method: 'query',
        query: SEASONAL_WRAPPED_QUERY,
        variables: { userId: 42, chunk: 1, perChunk: 500 },
      }).method
    ).toBe('query');
    expect(SEASONAL_WRAPPED_QUERY).toContain('endDate');
    expect(SEASONAL_WRAPPED_QUERY).not.toContain('season: $');
    expect(SEASONAL_WRAPPED_QUERY).not.toMatch(/\bnotes\b/);
    expect(SEASONAL_WRAPPED_QUERY).toContain('coverImage { extraLarge large color }');
  });
  it('reads the extraLarge cover first, falls back to large and keeps only http(s) URLs', () => {
    const cover = (coverImage: unknown) => {
      const raw = seasonalResponse();
      raw.MediaListCollection.lists[0].entries[0].media.coverImage = coverImage as never;
      return seasonalCollection(raw, 42).entries[0].cover;
    };
    expect(
      cover({
        extraLarge: 'https://s4.anilist.co/xl.jpg',
        large: 'https://s4.anilist.co/c.jpg',
        color: null,
      })
    ).toBe('https://s4.anilist.co/xl.jpg');
    expect(cover({ extraLarge: null, large: 'https://s4.anilist.co/c.jpg', color: null })).toBe(
      'https://s4.anilist.co/c.jpg'
    );
    expect(cover({ large: 'https://s4.anilist.co/c.jpg' })).toBe('https://s4.anilist.co/c.jpg');
    expect(cover({ extraLarge: 'javascript:alert(1)', large: null })).toBeNull();
    expect(cover(null)).toBeNull();
    expect(() => cover({ extraLarge: 7, large: null })).toThrow('Invalid');
  });
  it('loads every chunk, deduplicates custom lists and reads the archive only after a complete list', async () => {
    const f = fixture();
    const title = seasonalEntry();
    f.api.query
      .mockResolvedValueOnce(seasonalResponse([title, title], true))
      .mockResolvedValueOnce(seasonalResponse([seasonalEntry({ mediaId: 2 })]));
    const data = await f.service.load(() => true);
    expect(data.entries).toHaveLength(2);
    expect(f.api.query).toHaveBeenCalledTimes(2);
    expect(f.api.query.mock.calls[1]).toMatchObject([
      SEASONAL_WRAPPED_QUERY,
      { chunk: 2, userId: 42, perChunk: 500 },
      true,
    ]);
    expect(f.astra.exportJSON).toHaveBeenCalledOnce();
  });
  it('rejects conflicting duplicates, failed reads and empty nonfinal pages without publishing partial data', async () => {
    const f = fixture();
    f.api.query.mockResolvedValueOnce(seasonalResponse([], true));
    await expect(f.service.load(() => true)).rejects.toThrow('complete');
    expect(f.astra.exportJSON).not.toHaveBeenCalled();
    f.api.query.mockRejectedValueOnce(new Error('Offline'));
    await expect(f.service.load(() => true)).rejects.toThrow('Offline');
    const raw = seasonalResponse([seasonalEntry(), seasonalEntry({ title: 'Conflict' })]);
    expect(() => seasonalCollection(raw, 42)).toThrow('response');
  });
  it('rejects data bound to a different owner/media and missing schema fields', () => {
    const wrongOwner = seasonalResponse();
    wrongOwner.MediaListCollection.lists[0].entries[0].userId = 43;
    expect(() => seasonalCollection(wrongOwner, 42)).toThrow();
    const wrongMedia = seasonalResponse();
    wrongMedia.MediaListCollection.lists[0].entries[0].media.id = 9;
    expect(() => seasonalCollection(wrongMedia, 42)).toThrow();
    const missing = seasonalResponse();
    delete (
      missing.MediaListCollection.lists[0].entries[0].media as Partial<
        (typeof missing.MediaListCollection.lists)[0]['entries'][0]['media']
      >
    ).endDate;
    expect(() => seasonalCollection(missing, 42)).toThrow();
  });
  it('retires a closed view after an in-flight page without scheduling later reads', async () => {
    const f = fixture();
    let active = true;
    f.api.query.mockImplementationOnce(async () => {
      active = false;
      return seasonalResponse([seasonalEntry()], true);
    });
    await expect(f.service.load(() => active)).rejects.toThrow('closed');
    expect(f.api.query).toHaveBeenCalledOnce();
    expect(f.astra.exportJSON).not.toHaveBeenCalled();
  });
  it('rejects account changes during loading and before a manual choice is written', async () => {
    const f = fixture();
    const data = await f.service.load(() => true);
    f.switchAccount();
    await expect(
      f.service.saveChoices(data, { year: 2026, season: 'SPRING' }, emptySeasonalChoices())
    ).rejects.toThrow('account changed');
    expect(f.astra.saveSeasonalChoices).not.toHaveBeenCalled();
    const g = fixture();
    g.api.query.mockImplementationOnce(async () => {
      g.switchAccount();
      return seasonalResponse();
    });
    await expect(g.service.load(() => true)).rejects.toThrow('account changed');
    expect(g.astra.exportJSON).not.toHaveBeenCalled();
  });
  it('retires a new login session for the same user and preserves locally saved picks across periods', async () => {
    const f = fixture();
    const data = await f.service.load(() => true);
    const spring = { year: 2026, season: 'SPRING' } as const;
    const choices = { ...emptySeasonalChoices(), awards: { favorite: 1 }, confirmedMediaIds: [1] };
    await f.service.saveChoices(data, spring, choices);
    expect(f.service.getChoices(data, spring)).toMatchObject({
      awards: { favorite: 1 },
      updatedAt: 1,
    });
    expect(f.service.getChoices(data, { year: 2026, season: 'SUMMER' }).awards).toEqual({});
    f.switchAccount(42);
    await expect(f.service.saveChoices(data, spring, choices)).rejects.toThrow('account changed');
  });
});
