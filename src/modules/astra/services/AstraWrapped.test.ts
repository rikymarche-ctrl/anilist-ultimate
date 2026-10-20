import { describe, expect, it } from 'vitest';
import { localDateKey, wrappedDate, wrappedPeriod } from './AstraWrapped';
import { stampAstraProgress } from '../utils/AstraProgressHistory';
import type { AstraWork } from '../AstraInterfaces';
import { MediaListStatus } from '@/api/AnilistTypes';
import { AstraRepository } from '../store/AstraRepository';
import { EventBus } from '@core/events/EventBus';
import type { IStorageService } from '@core/interfaces/IStorageService';

const time = (date: string) => new Date(`${date}T12:00:00`).getTime();
const work = (patch: Partial<AstraWork> = {}): AstraWork => ({
  id: 'w',
  mediaId: 1,
  title: 'A story',
  type: 'anime',
  status: MediaListStatus.CURRENT,
  customLists: [],
  tags: [],
  notes: '',
  updatedAt: 1,
  duration: 24,
  genres: ['Drama'],
  seasons: [{ scores: {}, episodeNotes: { 1: { text: '', timestamp: time('2026-01-02') } } }],
  ...patch,
});
/** Journal units carrying a viewing date (Seasonal Wrapped uses them as participation evidence). */
const dated = (item: AstraWork) =>
  item.seasons
    .flatMap((season) => Object.values(season.episodeNotes ?? {}))
    .filter((note) => typeof note.timestamp === 'number').length;

describe('Wrapped periods and dated journal activity', () => {
  it.each(['2026-02-29', '2026-13-01', '', '2026-01-32'])('rejects an invalid date %s', (date) => {
    expect(() => wrappedDate(date)).toThrow('valid');
  });
  it('accepts leap days and builds year and month periods up to today', () => {
    expect(localDateKey(wrappedDate('2024-02-29'))).toBe('2024-02-29');
    expect(wrappedPeriod('year', new Date('2026-10-19T12:00:00'))).toEqual({
      start: '2026-01-01',
      end: '2026-10-19',
    });
    expect(wrappedPeriod('month', new Date('2026-10-19T12:00:00'))).toEqual({
      start: '2026-10-01',
      end: '2026-10-19',
    });
  });
  it('keeps activity when progress is reduced and adds no duplicate dates on retries', () => {
    const a = work();
    const original = a.seasons[0].episodeNotes![1];
    original.score = 7;
    original.text = 'Keep';
    expect(stampAstraProgress(a, 0, 3, time('2026-02-01'))).toBe(true);
    expect(stampAstraProgress(a, 0, 3, time('2026-03-01'))).toBe(false);
    expect(stampAstraProgress(a, 3, 0)).toBe(false);
    expect(a.seasons[0].episodeNotes![1]).toEqual(original);
    expect(dated(a)).toBe(3);
  });
  it('retains dated activity through durable save, repository recreation and backup restore', async () => {
    const data = new Map<string, unknown>();
    const storage = {
      get: async (key: string) => structuredClone(data.get(key) ?? null),
      set: async (key: string, value: unknown) => {
        data.set(key, structuredClone(value));
        return true;
      },
      setMultiple: async (values: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(values)) data.set(key, structuredClone(value));
        return true;
      },
      remove: async (key: string) => {
        data.delete(key);
        return true;
      },
    } as IStorageService;
    const repository = new AstraRepository(new EventBus(), storage);
    repository.setOwner(42);
    const a = work();
    stampAstraProgress(a, 1, 4, time('2026-05-01'));
    await repository.saveWork(a);
    const reopened = new AstraRepository(new EventBus(), storage);
    reopened.setOwner(42);
    await reopened.init();
    expect(dated((await reopened.getFullWork(1))!)).toBe(4);
    const archive = await reopened.exportJSON();
    await reopened.factoryReset();
    expect(await reopened.importJSON(archive)).toBe(true);
    expect(dated((await reopened.getFullWork(1))!)).toBe(4);
  });
});
