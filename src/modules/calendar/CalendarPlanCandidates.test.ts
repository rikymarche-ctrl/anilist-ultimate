import { describe, expect, it, vi } from 'vitest';
import { CalendarPlanCandidates, calendarPlanCandidate } from './CalendarPlanCandidates';
import { SEARCH_CALENDAR_ANIME_QUERY } from '@/api/queries/calendar';
import { calendarCollection, calendarListEntry } from '@/test/calendar-fixtures';

export function planMedia(id = 1, title = 'Cyberpunk: Edgerunners') {
  const entry = calendarListEntry(id);
  return { ...entry.media, title: { english: title, romaji: 'Saibāpanku', native: 'サイバーパンク' },
    status: 'FINISHED', episodes: 12, nextAiringEpisode: null, format: 'ONA', seasonYear: 2022,
    mediaListEntry: { id: entry.id, mediaId: id, userId: 1, status: 'CURRENT', progress: 2 } };
}
function fixture() {
  let context = { userId: 1, sessionId: 'one' };
  const api = { ensureContext: vi.fn(async () => ({ ...context })), getContext: () => context,
    isAuthenticated: () => true, query: vi.fn(async (): Promise<unknown> => ({ Page: { media: [planMedia()] } })) };
  const provider = new CalendarPlanCandidates(api as never, 1);
  return { provider, api, changeAccount: () => { context = { userId: 2, sessionId: 'two' }; } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }

describe('personal calendar provider', () => {
  it('uses the authenticated mediaListEntry without the unsupported userId argument', async () => {
    const f = fixture(); const result = await f.provider.search('Cyberp');
    expect(f.api.query).toHaveBeenCalledWith(SEARCH_CALENDAR_ANIME_QUERY, { search: 'Cyberp' }, true);
    expect(SEARCH_CALENDAR_ANIME_QUERY).not.toMatch(/mediaListEntry\s*\(/);
    expect(SEARCH_CALENDAR_ANIME_QUERY).not.toContain('$userId');
    expect(result[0]).toMatchObject({ title: 'Cyberpunk: Edgerunners', progress: 2, unavailable: null });
  });
  it('classifies non-list, airing and finished progress without inventing list membership', () => {
    expect(calendarPlanCandidate({ ...planMedia(), mediaListEntry: null }, 1)?.unavailable).toBe('list');
    expect(calendarPlanCandidate({ ...planMedia(), nextAiringEpisode: { airingAt: 1791489600 } }, 1)?.unavailable).toBe('airing');
    expect(calendarPlanCandidate({ ...planMedia(), mediaListEntry: { ...planMedia().mediaListEntry, progress: 12 } }, 1)?.unavailable).toBe('completed');
  });
  it.each([
    { type: 'MANGA' }, { id: 2147483648 }, { siteUrl: 'https://anilist.co.evil/anime/1' },
    { siteUrl: 'javascript:alert(1)' }, { siteUrl: 'https://anilist.co/anime/2' }, { title: {} },
    { mediaListEntry: { ...planMedia().mediaListEntry, userId: 2 } },
    { mediaListEntry: { ...planMedia().mediaListEntry, mediaId: 2 } },
    { mediaListEntry: { ...planMedia().mediaListEntry, progress: -1 } },
    { mediaListEntry: { ...planMedia().mediaListEntry, status: 'WATCHING' } },
    { episodes: -1 }, { nextAiringEpisode: {} },
  ])('rejects malformed, unsafe or foreign candidates: %j', patch => {
    expect(calendarPlanCandidate({ ...planMedia(), ...patch }, 1)).toBeNull();
  });
  it('drops an untrusted cover and indexes all title variants', () => {
    const candidate = calendarPlanCandidate(planMedia(), 1)!;
    expect(candidate.coverImage).toBe('');
    expect(candidate.searchText).toContain('saibapanku');
    expect(candidate.searchText).toContain('サイバーパンク');
  });
  it('caches bounded searches only within the panel and returns independent copies', async () => {
    const f = fixture(); const first = await f.provider.search('Cyberp'); first[0].title = 'mutated';
    expect((await f.provider.search('cyberp'))[0].title).toBe('Cyberpunk: Edgerunners');
    expect(f.api.query).toHaveBeenCalledTimes(1);
    f.changeAccount(); await expect(f.provider.search('cyberp')).rejects.toThrow('account changed');
  });
  it('rejects results arriving after an account switch', async () => {
    const f = fixture(); const pending = deferred<unknown>(); f.api.query.mockReturnValue(pending.promise);
    const request = f.provider.search('Cyberp'); await vi.waitFor(() => expect(f.api.query).toHaveBeenCalled());
    f.changeAccount(); pending.resolve({ Page: { media: [planMedia()] } });
    await expect(request).rejects.toThrow('account changed');
  });
  it.each([{}, { Page: null }, { Page: { media: null } }])('rejects an incomplete search envelope: %j', async response => {
    const f = fixture(); f.api.query.mockResolvedValue(response); await expect(f.provider.search('Cyberp')).rejects.toThrow('invalid search');
  });
  it('loads every list chunk, deduplicates custom groups, shares concurrent reads and returns copies', async () => {
    const f = fixture(); const first = calendarListEntry(); first.media.nextAiringEpisode = null as never;
    const second = calendarListEntry(2); second.media.nextAiringEpisode = null as never;
    f.api.query.mockResolvedValueOnce(calendarCollection([first, first], true)).mockResolvedValueOnce(calendarCollection([second]));
    const [a, b] = await Promise.all([f.provider.fromLists(), f.provider.fromLists()]);
    expect(a.map(item => item.mediaId)).toEqual([1, 2]); expect(f.api.query).toHaveBeenCalledTimes(2);
    expect(f.api.query.mock.calls[0]).toBeDefined(); a[0].title = 'changed'; expect(b[0].title).toBe('Anime 1');
  });
  it('refuses a repeating page and retries a failed list download', async () => {
    const f = fixture(); f.api.query.mockResolvedValue(calendarCollection([calendarListEntry()], true));
    await expect(f.provider.fromLists()).rejects.toThrow('Incomplete');
    f.api.query.mockResolvedValue(calendarCollection([]));
    expect(await f.provider.fromLists()).toEqual([]);
  });
  it('rejects a list returned for a different owner', async () => {
    const f = fixture(); f.api.query.mockResolvedValue({ MediaListCollection: { ...calendarCollection().MediaListCollection, user: { id: 2 } } });
    await expect(f.provider.fromLists()).rejects.toThrow('calendar');
  });
});
