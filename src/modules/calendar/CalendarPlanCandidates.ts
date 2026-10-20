import type { IApiClient, ApiContext } from '@core/interfaces/IApiClient';
import type { CalendarCustomPlan } from '@core/types';
import { MediaListStatus } from '@/api/AnilistTypes';
import { SEARCH_CALENDAR_ANIME_QUERY, USER_ANIME_LIST_QUERY } from '@/api/queries/calendar';
import { captureApiContext, assertApiContext } from '@/api/ApiContext';
import { isRecord } from '@/api/GraphQLResponse';
import { parseWebUrl } from '@core/utils/WebUrl';
import { calendarCollection } from './CalendarResponse';
import { isCalendarId } from './CalendarEntries';

export interface CalendarPlanCandidate extends CalendarCustomPlan {
  searchText: string;
  status: string;
  unavailable: 'airing' | 'list' | 'completed' | null;
  description: string;
}

const ACTIVE_STATUSES = [MediaListStatus.CURRENT, MediaListStatus.REPEATING];
const LIST_STATUSES = [...ACTIVE_STATUSES, MediaListStatus.PLANNING, MediaListStatus.COMPLETED, MediaListStatus.DROPPED, MediaListStatus.PAUSED];
export function normalizePlanSearch(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase().trim();
}

/** Project provider data before it reaches the DOM or persistent plans. */
export function calendarPlanCandidate(value: unknown, owner: number): CalendarPlanCandidate | null {
  if (!isRecord(value) || !isCalendarId(value.id) || value.type !== 'ANIME' || !isRecord(value.title)) return null;
  const titles = [value.title.english, value.title.romaji, value.title.native]
    .filter((title): title is string => typeof title === 'string' && !!title.trim()).map(title => title.trim());
  if (!titles.length) return null;
  const site = parseWebUrl(value.siteUrl);
  if (!site || site.protocol !== 'https:' || site.hostname !== 'anilist.co' || site.username || site.password
    || !new RegExp(`^/anime/${value.id}(?:/|$)`).test(site.pathname)) return null;
  const cover = isRecord(value.coverImage) ? parseWebUrl(value.coverImage.large) || parseWebUrl(value.coverImage.medium) : null;
  const coverImage = cover && cover.protocol === 'https:' && !cover.username && !cover.password
    && ['s4.anilist.co', 'img.anili.st'].includes(cover.hostname) && cover.href.length <= 2048 ? cover.href : '';
  if (site.href.length > 512 || (value.episodes !== null && !isCalendarId(value.episodes))) return null;
  const entry = value.mediaListEntry;
  if (entry !== null && (!isRecord(entry) || !isCalendarId(entry.id) || entry.userId !== owner || entry.mediaId !== value.id
    || !LIST_STATUSES.includes(entry.status as MediaListStatus)
    || !Number.isInteger(entry.progress) || (entry.progress as number) < 0 || (entry.progress as number) > 2147483647)) return null;
  if (value.nextAiringEpisode !== null && (!isRecord(value.nextAiringEpisode)
    || !Number.isInteger(value.nextAiringEpisode.airingAt) || (value.nextAiringEpisode.airingAt as number) < 0)) return null;
  const progress = isRecord(entry) ? entry.progress as number : 0;
  const status = isRecord(entry) ? entry.status as string : 'NOT_IN_LIST';
  const totalEpisodes = value.episodes as number | null;
  const unavailable = value.nextAiringEpisode !== null ? 'airing'
    : !ACTIVE_STATUSES.includes(status as MediaListStatus) ? 'list'
    : totalEpisodes !== null && progress >= totalEpisodes ? 'completed' : null;
  const description = [typeof value.seasonYear === 'number' ? String(value.seasonYear) : '',
    typeof value.format === 'string' ? value.format.replace(/_/g, ' ') : '',
    totalEpisodes ? `${totalEpisodes} episodes` : ''].filter(Boolean).join(' · ');
  return { mediaId: value.id, title: titles[0].slice(0, 200), searchText: normalizePlanSearch(titles.join(' ')),
    coverImage, siteUrl: site.href, totalEpisodes, progress, status, unavailable, description,
    dayOfWeek: 'Monday', time: '20:00' };
}

/** Short-lived reads belong to one panel and one authenticated account session. */
export class CalendarPlanCandidates {
  private context: ApiContext | undefined;
  private initialized = false;
  private lists: Promise<CalendarPlanCandidate[]> | null = null;
  private searches = new Map<string, { at: number; results: CalendarPlanCandidate[] }>();

  constructor(private api: IApiClient, private owner: number) {}

  public async assertCurrent(): Promise<void> {
    const captured = await captureApiContext(this.api);
    if (!this.initialized) {
      this.context = captured ? { ...captured } : undefined;
      this.initialized = true;
    }
    assertApiContext(this.api, this.context, this.owner);
    if (!this.api.isAuthenticated()) throw new Error('Calendar account changed');
  }

  public async fromLists(refresh = false): Promise<CalendarPlanCandidate[]> {
    await this.assertCurrent();
    if (refresh) this.lists = null;
    if (!this.lists) {
      const request = this.loadLists();
      this.lists = request;
      void request.catch(() => { if (this.lists === request) this.lists = null; });
    }
    const results = await this.lists;
    await this.assertCurrent();
    return results.map(item => ({ ...item }));
  }

  private async loadLists(): Promise<CalendarPlanCandidate[]> {
    const unique = new Map<number, CalendarPlanCandidate>();
    for (let chunk = 1; chunk <= 100; chunk++) {
      await this.assertCurrent();
      const response: unknown = await this.api.query(USER_ANIME_LIST_QUERY, {
        userId: this.owner, type: 'ANIME', chunk, perChunk: 500, statuses: ACTIVE_STATUSES,
      }, true);
      await this.assertCurrent();
      const page = calendarCollection(response, this.owner);
      const pageIds = new Set(page.entries.map(entry => entry.mediaId));
      if (pageIds.size > 500) throw new Error('Invalid calendar list size');
      const added = [...pageIds].some(id => !unique.has(id));
      for (const entry of page.entries) {
        const candidate = entry.media && calendarPlanCandidate({ ...entry.media,
          mediaListEntry: { id: entry.id, mediaId: entry.mediaId, userId: this.owner,
            status: entry.status, progress: entry.progress } }, this.owner);
        if (!candidate) continue;
        const previous = unique.get(candidate.mediaId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(candidate)) throw new Error('Conflicting calendar list entries');
        unique.set(candidate.mediaId, candidate);
      }
      if (!page.hasNextChunk) return [...unique.values()].sort((a, b) =>
        Number(!!a.unavailable) - Number(!!b.unavailable) || a.title.localeCompare(b.title));
      if (!added) break;
    }
    throw new Error('Incomplete calendar lists. Try again.');
  }

  public async search(title: string, refresh = false): Promise<CalendarPlanCandidate[]> {
    const search = title.trim();
    if (search.length < 2 || search.length > 100) throw new Error('Enter between 2 and 100 characters.');
    await this.assertCurrent();
    const key = normalizePlanSearch(search);
    const cached = this.searches.get(key);
    if (!refresh && cached && Date.now() - cached.at < 60_000) return cached.results.map(item => ({ ...item }));
    const response: unknown = await this.api.query(SEARCH_CALENDAR_ANIME_QUERY, { search }, true);
    await this.assertCurrent();
    if (!isRecord(response) || !isRecord(response.Page) || !Array.isArray(response.Page.media)
      || response.Page.media.length > 10) throw new Error('AniList returned an invalid search response.');
    const results = response.Page.media.map(item => calendarPlanCandidate(item, this.owner))
      .filter((item): item is CalendarPlanCandidate => item !== null);
    const unique = [...new Map(results.map(item => [item.mediaId, item])).values()];
    if (this.searches.size >= 20) this.searches.delete(this.searches.keys().next().value!);
    this.searches.set(key, { at: Date.now(), results: unique });
    return unique.map(item => ({ ...item }));
  }
}
