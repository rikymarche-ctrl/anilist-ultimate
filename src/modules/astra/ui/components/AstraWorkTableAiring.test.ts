import { afterEach, describe, expect, it, vi } from 'vitest';
import { AstraWorkTable } from './AstraWorkTable';
import type { IDashboardState } from '../../interfaces/IDashboardState';
import { MediaListStatus } from '@/api/AnilistTypes';

const tables: AstraWorkTable[] = [];

afterEach(() => {
  for (const table of tables.splice(0)) table.unmount();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function work(mediaId: number, type: 'anime' | 'manga', status: MediaListStatus) {
  return { id: `work-${mediaId}`, mediaId, title: `Work ${mediaId}`, type, status, updatedAt: 1, currentScore: null };
}

function state(separateAiring: boolean, layout: 'table' | 'grid' = 'table'): Partial<IDashboardState> {
  const filteredWorks = [
    work(1, 'anime', MediaListStatus.CURRENT),
    work(2, 'anime', MediaListStatus.CURRENT),
    work(3, 'manga', MediaListStatus.CURRENT),
    work(4, 'anime', MediaListStatus.REPEATING),
    work(5, 'anime', MediaListStatus.PLANNING),
  ];
  return {
    filters: { search: '', type: 'all', ratingStatus: 'all', anilistStatus: 'all', country: 'all', customLists: [], isGrouped: true },
    sort: 'title-asc', layout, showProgress: false, separateAiring, activeTab: 'dashboard',
    isLoading: false, error: null, filteredWorks,
    stats: { totalCount: filteredWorks.length, averageScore: 0, completedCount: 0, droppedCount: 0, planningCount: 0, genreDistribution: {}, statusDistribution: {} },
  };
}

describe('Astra work table airing section', () => {
  it('moves only currently airing anime from Watching into the first group', async () => {
    const calendar = { fetchAiringSchedule: vi.fn(async () => [1, 3, 4, 5].map(mediaId => ({ mediaId }))) };
    const api = { getCurrentUserId: vi.fn(async () => 7) };
    const store = { ready: vi.fn(async () => {}), getState: () => ({ separateAiring: true }) };
    const table = new AstraWorkTable(store as never, { getSections: () => [] } as never, { open: vi.fn() } as never,
      calendar as never, api as never);
    tables.push(table);
    await table.prepareAiringData();
    expect(calendar.fetchAiringSchedule).toHaveBeenCalledExactlyOnceWith(7);
    table.mount(document.body, state(true));
    await vi.waitFor(() => expect(table.getElement().querySelector('[data-status="AIRING"]')).not.toBeNull());

    const headers = [...table.getElement().querySelectorAll<HTMLElement>('.astra-grid-group-header')];
    expect(headers.map(header => header.dataset.status)).toEqual(['AIRING', MediaListStatus.WATCHING,
      MediaListStatus.READING, MediaListStatus.REWATCHING, MediaListStatus.PLAN_TO_WATCH]);
    expect(table.getElement().querySelector('[data-status="AIRING"]')?.textContent).toContain('Airing');
    expect(table.getElement().querySelector('[data-status="AIRING"] + [data-media-id="1"]')).not.toBeNull();
    expect(table.getElement().querySelector('[data-status="WATCHING"] + [data-media-id="2"]')).not.toBeNull();
    expect(table.getElement().querySelector('[data-status="AIRING"] + [data-media-id="1"] .au-pill-wrapper')).toBeNull();
    expect(table.getElement().querySelector('[data-status="WATCHING"] + [data-media-id="2"] .au-pill-wrapper')).toBeNull();
    expect(calendar.fetchAiringSchedule).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('keeps action pills off Airing covers in grid view', async () => {
    const calendar = { fetchAiringSchedule: vi.fn(async () => [{ mediaId: 1 }]) };
    const table = new AstraWorkTable({ ready: async () => {}, getState: () => ({ separateAiring: true }) } as never,
      { getSections: () => [] } as never, { open: vi.fn() } as never, calendar as never,
      { getCurrentUserId: async () => 7 } as never);
    tables.push(table);
    await table.prepareAiringData();
    table.mount(document.body, state(true, 'grid'));
    await vi.waitFor(() => expect(table.getElement().querySelector('.astra-layout-card-cover-wrap')).not.toBeNull());
    expect(table.getElement().querySelector('.astra-layout-card-cover-wrap .au-pill-wrapper')).toBeNull();
  });

  it('joins an existing preload and reuses fresh Airing data without another lookup', async () => {
    let finish!: (entries: Array<{ mediaId: number }>) => void;
    const calendar = { fetchAiringSchedule: vi.fn(() => new Promise<Array<{ mediaId: number }>>(resolve => { finish = resolve; })) };
    const api = { getCurrentUserId: vi.fn(async () => 7) };
    const table = new AstraWorkTable({ ready: async () => {}, getState: () => ({ separateAiring: true }) } as never,
      { getSections: () => [] } as never, { open: vi.fn() } as never, calendar as never, api as never);
    tables.push(table);
    const preload = table.prepareAiringData();
    const openWait = table.prepareAiringData();
    await vi.waitFor(() => expect(calendar.fetchAiringSchedule).toHaveBeenCalledOnce());
    finish([{ mediaId: 1 }]);
    await Promise.all([preload, openWait]);
    await table.prepareAiringData();
    expect(calendar.fetchAiringSchedule).toHaveBeenCalledOnce();
    // The first schedule load verifies the account both before and after the API read;
    // the next dashboard preparation uses the verified warm snapshot without another call.
    expect(api.getCurrentUserId).toHaveBeenCalledTimes(2);
  });

  it('does not query the calendar or add an Airing group while the preference is off', async () => {
    const calendar = { fetchAiringSchedule: vi.fn(async () => []) };
    const store = { ready: vi.fn(async () => {}), getState: () => ({ separateAiring: false }) };
    const table = new AstraWorkTable(store as never, { getSections: () => [] } as never, { open: vi.fn() } as never,
      calendar as never, { getCurrentUserId: vi.fn(async () => 7) } as never);
    tables.push(table);
    await table.prepareAiringData();
    table.mount(document.body, state(false));

    expect(table.getElement().querySelector('[data-status="AIRING"]')).toBeNull();
    expect(calendar.fetchAiringSchedule).not.toHaveBeenCalled();
  });
});
