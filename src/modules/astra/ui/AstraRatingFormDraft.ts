import type { AniListDate } from '@/api/AnilistTypes';
import type { AstraWork } from '../AstraInterfaces';
import type { AstraPendingListState, AstraRatingEntry } from '../interfaces/IAstraRatingService';
import { copyAstraDates, type AstraListDates } from '../utils/AstraDates';

export interface AstraRatingFormValues {
  progress: number;
  repeat: number;
  private: boolean;
  hidden: boolean;
  customLists: string[];
  startedAt: AniListDate | null;
  completedAt: AniListDate | null;
}

/** Display only the known prefix; the draft preserves other fuzzy components. */
export function formatRatingDate(date?: AniListDate | null): string {
  if (!date?.year) return '';
  const year = String(date.year).padStart(4, '0');
  if (!date.month) return year;
  const month = String(date.month).padStart(2, '0');
  return date.day ? `${year}-${month}-${String(date.day).padStart(2, '0')}` : `${year}-${month}`;
}

export function parseRatingDate(value: string): AniListDate | null {
  if (!value) return null;
  const match = /^(\d{4,10})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!match) throw new Error('Invalid Astra date');
  const year = Number(match[1]); const month = match[2] ? Number(match[2]) : null; const day = match[3] ? Number(match[3]) : null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || year > 2147483647 || (month !== null && (month < 1 || month > 12))
    || (day !== null && (month === null || day < 1 || day > days[month - 1]))) throw new Error('Invalid Astra date');
  return { year, month, day };
}

/** Stepper arithmetic for count fields; an emptied or non-numeric input steps from the last valid value. */
export function steppedCount(raw: string, lastValid: number, step: number): number {
  const parsed = Number.parseInt(raw, 10);
  return Math.max(0, (Number.isNaN(parsed) ? lastValid : parsed) + step);
}

/** Quick-edit fields live beyond a single DOM render and are copied for each save. */
export class AstraRatingFormDraft {
  public values: AstraRatingFormValues;

  constructor(entry: AstraRatingEntry | null, work: AstraWork, pendingDates: AstraListDates = {}, pending: AstraPendingListState = {}) {
    const dates = { ...copyAstraDates(entry ?? work), ...copyAstraDates(pendingDates), ...copyAstraDates(pending) };
    this.values = { progress: pending.progress ?? entry?.progress ?? work.progress ?? 0, repeat: pending.repeat ?? entry?.repeat ?? 0,
      private: pending.private ?? entry?.private ?? work.isPrivate ?? false,
      hidden: pending.hidden ?? entry?.hiddenFromStatusLists ?? work.isHidden ?? false,
      customLists: pending.customLists ? [...pending.customLists]
        : entry ? Object.keys(entry.customLists).filter(name => entry.customLists[name]) : [...work.customLists],
      startedAt: dates.startedAt ?? null, completedAt: dates.completedAt ?? null };
  }

  public read(root: HTMLElement): AstraRatingFormValues {
    const next = structuredClone(this.values);
    for (const [id, key] of [['astra-progress', 'progress'], ['astra-repeat', 'repeat']] as const) {
      const input = root.querySelector<HTMLInputElement>(`#${id}`);
      if (!input) continue;
      // An emptied field is an unfinished edit: keep the last valid value instead of saving 0.
      if (input.value.trim() === '') continue;
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 0 || value > 2147483647) throw new Error('Progress and repeat must be non-negative GraphQL integers');
      next[key] = value;
    }
    const privateInput = root.querySelector<HTMLInputElement>('#astra-private-cb');
    const hiddenInput = root.querySelector<HTMLInputElement>('#astra-hide-cb');
    if (privateInput) next.private = privateInput.checked;
    if (hiddenInput) next.hidden = hiddenInput.checked;
    if (root.querySelector('#astra-custom-list-panel')) {
      next.customLists = [...root.querySelectorAll<HTMLInputElement>('.astra-custom-list-cb:checked')].map(input => input.dataset.name ?? '');
    }
    for (const [id, key] of [['astra-start-date', 'startedAt'], ['astra-finish-date', 'completedAt']] as const) {
      const input = root.querySelector<HTMLInputElement>(`#${id}`);
      if (!input) continue;
      if (input.dataset.dateEdited !== 'true' && input.value === formatRatingDate(next[key])) continue;
      next[key] = parseRatingDate(input.value);
    }
    this.values = next;
    return structuredClone(next);
  }
}
