/** Local calendar period, inclusive, as `YYYY-MM-DD` keys. */
export interface WrappedPeriod { start: string; end: string }

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Local midnight, with strict validation (including leap days). */
export function wrappedDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose valid start and end dates.');
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime()) || localDateKey(date) !== value) throw new Error('Choose valid start and end dates.');
  return date;
}

export function wrappedPeriod(kind: 'year' | 'month', now = new Date()): WrappedPeriod {
  return { start: localDateKey(new Date(now.getFullYear(), kind === 'year' ? 0 : now.getMonth(), 1)), end: localDateKey(now) };
}
