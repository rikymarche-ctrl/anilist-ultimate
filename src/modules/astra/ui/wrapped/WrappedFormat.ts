/**
 * @file WrappedFormat.ts
 * @description Number and local-date wording shared by the Wrapped stories and their PNG exports.
 */

import { localDateKey } from '../../services/AstraWrapped';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS_PLURAL = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];

const formatters = new Map<number, Intl.NumberFormat>();

export function formatNumber(value: number, decimals = 0): string {
  let formatter = formatters.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatters.set(decimals, formatter);
  }
  return formatter.format(value);
}

/** `YYYY-MM-DD` as local midnight (the same convention as the Wrapped calculation). */
export function parseLocalDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function formatDay(key: string, withYear = true): string {
  const date = parseLocalDate(key);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${withYear ? ` ${date.getFullYear()}` : ''}`;
}

export function formatRange(start: string, end: string): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatDay(start, !sameYear)} – ${formatDay(end)}`;
}

/**
 * Story headline: "2026", "October 2026" or a compact range for custom periods.
 * A bare year needs a whole year (ending 31 Dec) or year-to-date (ending today); a January-only
 * range is a month, not a year.
 */
export function periodTitle(
  start: string,
  end: string,
  today: string = localDateKey(new Date())
): string {
  const [startYear, startMonth, startDay] = start.split('-');
  const [endYear, endMonth] = end.split('-');
  const isWholeOrYearToDate = end === `${startYear}-12-31` || end === today;
  if (startMonth === '01' && startDay === '01' && startYear === endYear && isWholeOrYearToDate)
    return startYear;
  if (startDay === '01' && startYear === endYear && startMonth === endMonth)
    return `${MONTHS_LONG[Number(startMonth) - 1]} ${startYear}`;
  return formatRange(start, end);
}

export function periodNoun(start: string, end: string): 'year' | 'month' | 'period' {
  const title = periodTitle(start, end);
  if (/^\d{4}$/.test(title)) return 'year';
  return title.includes('–') ? 'period' : 'month';
}

/** Chart label for a `YYYY-MM` bucket. */
export function monthLabel(key: string, withYear: boolean): string {
  const [year, month] = key.split('-');
  return `${MONTHS[Number(month) - 1]}${withYear ? ` '${year.slice(2)}` : ''}`;
}

export function monthName(key: string): string {
  const [year, month] = key.split('-');
  return `${MONTHS_LONG[Number(month) - 1]} ${year}`;
}

export function weekdayPlural(day: number): string {
  return WEEKDAYS_PLURAL[day] ?? '';
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}
