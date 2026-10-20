import type { AstraWork, AstraSection, AstraSettings, AstraWorkSummary } from '../AstraInterfaces';
import { readAstraDate } from '../utils/AstraDates';
import { DEFAULT_SETTINGS } from '../utils/AstraConstants';
import type { WorkValidationField } from '@core/errors/OperationFailure';
import { ASTRA_SEASON_FIELDS } from '../utils/AstraSeasons';
import { validateSeasonalArchive, type SeasonalArchive } from '../services/SeasonalWrappedModel';
import { parseWebUrl } from '@core/utils/WebUrl';

export class AstraWorkValidationError extends Error {
  constructor(readonly validationField: WorkValidationField) { super('Invalid Astra work'); this.name = 'AstraWorkValidationError'; }
}

export interface AstraBackup {
  schemaVersion: 1;
  manifest: AstraWorkSummary[];
  sections: AstraSection[];
  settings: AstraSettings;
  works: Record<string, AstraWork>;
  seasonalWrapped?: SeasonalArchive;
}

/**
 * Largest accepted backup, in JSON characters. Sync admits up to 10,000 entries of roughly
 * 1.3 KB each (about 13 MB), so the limit must exceed a full export. It stays well below
 * Chrome's 64 MiB runtime message cap even after the RPC envelope escapes JSON quotes.
 */
export const MAX_ASTRA_BACKUP_CHARACTERS = 32 * 1024 * 1024;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const score = (value: unknown) => value === null || (finite(value) && value >= 0 && value <= 10);
const criterionScore = (value: unknown) => value === null || (finite(value) && value >= 0 && value <= 11);
const strings = (value: unknown) => Array.isArray(value) && value.every(text);
const positiveId = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 2147483647;
const optional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value);
const status = (value: unknown) => ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'].includes(value as string);
const safeKey = (key: string) => !['__proto__', 'prototype', 'constructor'].includes(key);
/** Covers are rendered as image URLs: accept an empty value or an absolute http(s) URL only. */
const isWebCover = (value: unknown): boolean => value === '' || (text(value) && /^https?:\/\//i.test(value.trim()) && parseWebUrl(value) !== null);

function safeTree(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (Array.isArray(value)) return value.every(entry => safeTree(entry, depth + 1));
  if (!record(value)) return true;
  return Object.entries(value).every(([key, entry]) => safeKey(key) && safeTree(entry, depth + 1));
}

function validSection(value: unknown): boolean {
  return record(value) && text(value.id) && value.id.length > 0 && safeKey(value.id)
    && text(value.name) && finite(value.weight) && value.weight >= 0;
}

function uniqueIds(values: unknown[]): boolean {
  return values.every(record) && new Set(values.map(value => (value as Record<string, unknown>).id)).size === values.length;
}

function seasonIssue(value: unknown): WorkValidationField | undefined {
  if (!record(value)) return 'SEASONS';
  if (!Object.keys(value).every(key => (ASTRA_SEASON_FIELDS as readonly string[]).includes(key))) return 'SEASON_FIELDS';
  if (!record(value.scores) || !Object.values(value.scores).every(criterionScore)) return 'SCORES';
  if (!optional(value.skip, strings)) return 'SKIP';
  if (!optional(value.notes, text)) return 'SEASON_NOTES';
  if (!optional(value.isSeriesFinale, v => typeof v === 'boolean')) return 'FINALE';
  if (value.episodeNotes !== undefined) {
    if (!record(value.episodeNotes)) return 'JOURNAL';
    if (!Object.entries(value.episodeNotes).every(([unit, note]) => /^\d+$/.test(unit) && record(note)
      && text(note.text) && optional(note.score, score)
      && optional(note.timestamp, v => finite(v) && v >= 0))) return 'JOURNAL';
  }
  return undefined;
}

function validDates(value: Record<string, unknown>): boolean {
  try {
    for (const field of ['startedAt', 'completedAt']) if (value[field] !== undefined) readAstraDate(value[field]);
    return true;
  } catch { return false; }
}

function workIssue(value: unknown): WorkValidationField | undefined {
  if (!record(value) || !positiveId(value.mediaId) || !text(value.id)) return 'IDENTITY';
  if (!text(value.title)) return 'TITLE';
  if (!['anime', 'manga', 'novel'].includes(value.type as string)) return 'TYPE';
  if (!status(value.status)) return 'STATUS';
  if (!finite(value.updatedAt) || value.updatedAt < 0) return 'UPDATED_AT';
  if (!text(value.notes)) return 'NOTES';
  if (!validDates(value)) return 'DATES';
  if (!Array.isArray(value.seasons)) return 'SEASONS';
  for (const season of value.seasons) { const issue = seasonIssue(season); if (issue) return issue; }
  for (const [key, field] of [['tags', 'TAGS'], ['genres', 'GENRES'], ['customLists', 'LISTS']] as const) if (!optional(value[key], strings)) return field;
  for (const [key, field] of [['progress', 'PROGRESS'], ['episodes', 'EPISODES'], ['chapters', 'CHAPTERS'], ['duration', 'DURATION']] as const) {
    if (!optional(value[key], v => Number.isSafeInteger(v) && (v as number) >= 0)) return field;
  }
  for (const [key, field] of [['isPrivate', 'PRIVATE'], ['isHidden', 'HIDDEN']] as const) if (!optional(value[key], v => typeof v === 'boolean')) return field;
  if (!optional(value.cover, text)) return 'COVER';
  if (!optional(value.country, text)) return 'COUNTRY';
  return undefined;
}

/** Validate the current backup format before any writes. */
export function parseAstraBackup(json: string): AstraBackup {
  if (json.length > MAX_ASTRA_BACKUP_CHARACTERS) throw new Error('Astra backup exceeds the import limit');
  const data: unknown = JSON.parse(json);
  if (!record(data) || !safeTree(data) || data.schemaVersion !== 1
    || !Array.isArray(data.manifest) || !Array.isArray(data.sections)
    || !record(data.settings) || !record(data.works)) throw new Error('Invalid Astra backup');
  if (!data.sections.every(value => validSection(value) && record(value)
    && optional(value.subSections, subs => Array.isArray(subs) && subs.every(validSection) && uniqueIds(subs)))
    || !uniqueIds(data.sections)) throw new Error('Invalid Astra sections');
  const settings = { ...DEFAULT_SETTINGS, ...data.settings };
  if (!['enableSeriesFinale', 'autoSync', 'appendAstraToComment'].every(key => typeof settings[key as keyof typeof settings] === 'boolean')
    || !finite(settings.finaleWeightMultiplier) || settings.finaleWeightMultiplier < 0) throw new Error('Invalid Astra settings');
  const ids = new Set<number>();
  for (const summary of data.manifest) {
    if (!record(summary) || !positiveId(summary.mediaId) || !validDates(summary) || ids.has(summary.mediaId as number)) throw new Error('Invalid Astra manifest');
    ids.add(summary.mediaId as number);
  }
  for (const [key, work] of Object.entries(data.works)) {
    const issue = workIssue(work);
    if (issue) throw new AstraWorkValidationError(issue);
    if (!record(work) || key !== String(work.mediaId) || !ids.has(work.mediaId as number)) throw new AstraWorkValidationError('IDENTITY');
    // A non-web cover (for example data:) would break table rendering; keep the work and drop only the cover.
    if (work.cover !== undefined && !isWebCover(work.cover)) work.cover = '';
  }
  if (Object.keys(data.works).length !== ids.size) throw new Error('Backup contains missing works');
  if (data.seasonalWrapped !== undefined) validateSeasonalArchive(data.seasonalWrapped);
  return data as unknown as AstraBackup;
}
