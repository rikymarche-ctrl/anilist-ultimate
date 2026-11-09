/**
 * @file AstraThemeRatings.ts
 * @description Per-song opening/ending ratings: model, validation and pure updates.
 *
 * Stored in one account-scoped key next to the Astra works (see ASTRA_KEYS.themeRatings),
 * so the Astra backup and the full extension backup both carry it. Never written to AniList notes.
 */

export type ThemeRatingKind = 'OP' | 'ED';

export interface ThemeRating {
  /** 0.1-10 with one decimal: the Astra slider scale, without the lode. */
  score: number;
  kind: ThemeRatingKind;
  title: string;
  updatedAt: number;
}

export interface ThemeMediaRatings {
  ratings: Record<string, ThemeRating>;
  /** Unranged songs already offered in the progress popup. */
  prompted?: string[];
}

/** Keyed by AniList media id. */
export type ThemeRatingArchive = Record<string, ThemeMediaRatings>;
export type ThemeRatingInput = Pick<ThemeRating, 'score' | 'kind' | 'title'>;

export const MAX_THEME_ID = 160;
export const MAX_THEME_TITLE = 300;
const MAX_SONGS_PER_MEDIA = 200;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const safeKey = (key: string) => !['__proto__', 'prototype', 'constructor'].includes(key);

export function isThemeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_THEME_ID &&
    /^[1-9]\d*:(OP|ED):\d+:[^\s]+$/.test(value)
  );
}

export function isThemeScore(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0.1 &&
    value <= 10 &&
    Math.abs(Math.round(value * 10) - value * 10) < 1e-9
  );
}

export function validateThemeRatingInput(value: unknown): asserts value is ThemeRatingInput {
  if (
    !record(value) ||
    !isThemeScore(value.score) ||
    (value.kind !== 'OP' && value.kind !== 'ED') ||
    typeof value.title !== 'string' ||
    value.title.length > MAX_THEME_TITLE
  )
    throw new Error('Invalid theme rating');
}

export function validateThemeRatingArchive(value: unknown): asserts value is ThemeRatingArchive {
  if (!record(value)) throw new Error('Invalid theme rating archive');
  for (const [mediaKey, entry] of Object.entries(value)) {
    if (
      !/^[1-9]\d{0,9}$/.test(mediaKey) ||
      Number(mediaKey) > 2147483647 ||
      !record(entry) ||
      !record(entry.ratings)
    )
      throw new Error('Invalid theme rating archive');
    const ratings = Object.entries(entry.ratings);
    if (ratings.length > MAX_SONGS_PER_MEDIA) throw new Error('Invalid theme rating archive');
    for (const [id, rating] of ratings) {
      if (!safeKey(id) || !isThemeId(id) || !id.startsWith(`${mediaKey}:`))
        throw new Error('Invalid theme rating id');
      validateThemeRatingInput(rating);
      if (!Number.isSafeInteger((rating as Record<string, unknown>).updatedAt))
        throw new Error('Invalid theme rating');
    }
    if (
      entry.prompted !== undefined &&
      (!Array.isArray(entry.prompted) ||
        entry.prompted.length > MAX_SONGS_PER_MEDIA ||
        !entry.prompted.every((id) => isThemeId(id) && id.startsWith(`${mediaKey}:`)))
    )
      throw new Error('Invalid theme prompts');
  }
}

export function emptyThemeRatings(): ThemeMediaRatings {
  return { ratings: {} };
}

/** Returns a new archive with one song set (or cleared with null). */
export function withThemeRating(
  archive: ThemeRatingArchive,
  mediaId: number,
  id: string,
  input: ThemeRatingInput | null,
  now = Date.now()
): ThemeRatingArchive {
  if (!isThemeId(id) || !id.startsWith(`${mediaId}:`)) throw new Error('Invalid theme rating id');
  if (input !== null) validateThemeRatingInput(input);
  const key = String(mediaId);
  const current = archive[key] ?? emptyThemeRatings();
  const rest = without(current.ratings, id);
  const ratings =
    input === null
      ? rest
      : {
          ...rest,
          [id]: {
            score: Math.round(input.score * 10) / 10,
            kind: input.kind,
            title: input.title,
            updatedAt: now,
          },
        };
  const next: ThemeMediaRatings = { ...current, ratings };
  const others = without(archive, key);
  return Object.keys(next.ratings).length || next.prompted?.length
    ? { ...others, [key]: next }
    : others;
}

/** Returns a new archive that remembers unranged songs offered in the popup. */
export function withThemesPrompted(
  archive: ThemeRatingArchive,
  mediaId: number,
  ids: string[]
): ThemeRatingArchive {
  if (!ids.every((id) => isThemeId(id) && id.startsWith(`${mediaId}:`)))
    throw new Error('Invalid theme prompts');
  const key = String(mediaId);
  const current = archive[key] ?? emptyThemeRatings();
  const prompted = [...new Set([...(current.prompted ?? []), ...ids])].slice(-MAX_SONGS_PER_MEDIA);
  return { ...archive, [key]: { ...current, prompted } };
}

/** Plain mean of rated songs per kind, rounded to one decimal; null when none is rated. */
export function themeAverages(
  ratings: Record<string, ThemeRating>
): Record<ThemeRatingKind, number | null> {
  const mean = (kind: ThemeRatingKind) => {
    const scores = Object.values(ratings)
      .filter((rating) => rating.kind === kind)
      .map((rating) => rating.score);
    return scores.length
      ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10
      : null;
  };
  return { OP: mean('OP'), ED: mean('ED') };
}

/** A copy of `record` without `key`. */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}
