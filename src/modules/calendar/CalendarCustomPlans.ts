import { DAYS_OF_WEEK } from '@core/constants';
import type { AnimeEntry } from '@core/types';
import type { CalendarCustomPlan } from '@core/types';
import { parseWebUrl } from '@core/utils/WebUrl';

const MAX_PLANS = 200;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function calendarCustomPlans(value: unknown): CalendarCustomPlan[] {
  if (!Array.isArray(value) || value.length > MAX_PLANS) throw new Error('Invalid personal calendar plans');
  const seen = new Set<number>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid personal calendar plan');
    const plan = item as Record<string, unknown>;
    const mediaId = plan.mediaId as number;
    const site = parseWebUrl(plan.siteUrl);
    const cover = plan.coverImage === '' ? null : parseWebUrl(plan.coverImage);
    if (!Number.isInteger(plan.mediaId) || (plan.mediaId as number) <= 0 || seen.has(plan.mediaId as number)
      || typeof plan.title !== 'string' || !plan.title.trim() || plan.title.length > 200
      || typeof plan.coverImage !== 'string' || plan.coverImage.length > 2048
      || typeof plan.siteUrl !== 'string' || plan.siteUrl.length > 512
      || !(DAYS_OF_WEEK as readonly unknown[]).includes(plan.dayOfWeek)
      || typeof plan.time !== 'string' || !TIME_PATTERN.test(plan.time)
      || !Number.isInteger(plan.progress) || (plan.progress as number) < 0 || (plan.progress as number) > 2147483647
      || (plan.totalEpisodes !== null && (!Number.isInteger(plan.totalEpisodes) || (plan.totalEpisodes as number) < 1))) {
      throw new Error('Invalid personal calendar plan');
    }
    if (!site || site.protocol !== 'https:' || site.username || site.password || site.hostname !== 'anilist.co'
      || !new RegExp(`^/anime/${mediaId}(?:/|$)`).test(site.pathname)
      || (plan.coverImage !== '' && (!cover || cover.protocol !== 'https:' || cover.username || cover.password
        || !['s4.anilist.co', 'img.anili.st'].includes(cover.hostname)))) {
      throw new Error('Invalid personal calendar plan URL');
    }
    seen.add(plan.mediaId as number);
    return { mediaId, title: plan.title.trim(), coverImage: cover?.href ?? '',
      siteUrl: site.href, totalEpisodes: plan.totalEpisodes as number | null,
      progress: plan.progress as number, dayOfWeek: plan.dayOfWeek as CalendarCustomPlan['dayOfWeek'], time: plan.time };
  });
}

/** Return this week's local date for the requested recurring weekday and time. */
export function plannedOccurrence(day: CalendarCustomPlan['dayOfWeek'], time: string, now = new Date()): Date {
  if (!TIME_PATTERN.test(time)) throw new Error('Invalid personal calendar time');
  const targetDay = DAYS_OF_WEEK.indexOf(day);
  if (targetDay < 0) throw new Error('Invalid personal calendar day');
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + (targetDay - date.getDay() + 7) % 7);
  const [hour, minute] = time.split(':').map(Number);
  date.setHours(hour, minute, 0, 0);
  return date;
}

export function customPlanEntry(plan: CalendarCustomPlan, listEntryId: number, progress: number, now = new Date()): AnimeEntry {
  if (!Number.isInteger(listEntryId) || listEntryId <= 0 || !Number.isInteger(progress) || progress < 0) {
    throw new Error('Invalid personal calendar progress');
  }
  const airingAt = plannedOccurrence(plan.dayOfWeek, plan.time, now);
  return {
    id: listEntryId, mediaId: plan.mediaId, title: plan.title, cleanTitle: plan.title,
    episode: progress + 1, airingAt, timeUntilAiring: Math.floor((airingAt.getTime() - now.getTime()) / 1000),
    coverImage: plan.coverImage, siteUrl: plan.siteUrl, progress, totalEpisodes: plan.totalEpisodes,
    dayOfWeek: plan.dayOfWeek, calendarKind: 'personal',
  };
}
