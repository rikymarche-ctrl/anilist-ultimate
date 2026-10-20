import { DEFAULT_CALENDAR_PREFERENCES } from '@core/constants';
import type { CalendarPreferences } from '@core/types';

const options: Partial<Record<keyof CalendarPreferences, readonly string[]>> = {
  startDay: ['today', '0', '1', '2', '3', '4', '5', '6'],
  layoutMode: ['standard', 'compact', 'extended'],
  timeFormat: ['release', 'countdown'],
  titleAlignment: ['left', 'center'],
  columnJustify: ['top', 'center'],
};

/** One field contract for persisted preferences and new edits. */
export function calendarPreferenceChange(key: string | null, value: unknown): Partial<CalendarPreferences> | null {
  if (!key || !Object.prototype.hasOwnProperty.call(DEFAULT_CALENDAR_PREFERENCES, key)) return null;
  const field = key as keyof CalendarPreferences;
  const model = DEFAULT_CALENDAR_PREFERENCES[field];
  const valid = typeof model === 'boolean' ? typeof value === 'boolean'
    : field === 'maxCardsPerDay' ? typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      : typeof value === 'string' && options[field]?.includes(value);
  return valid ? { [field]: value } as Partial<CalendarPreferences> : null;
}

/** Stored data is recovered field by field; edits must satisfy the entire contract. */
export function calendarPreferencePatch(value: unknown, stored = false): Partial<CalendarPreferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (stored) return {};
    throw new Error('Invalid calendar preferences');
  }
  const patch: Partial<CalendarPreferences> = {};
  for (const [key, entry] of Object.entries(value)) {
    const change = calendarPreferenceChange(key, entry);
    if (change) Object.assign(patch, change);
    else if (!stored) throw new Error('Invalid calendar preference field');
  }
  return patch;
}
