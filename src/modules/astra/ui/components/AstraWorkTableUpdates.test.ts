import { afterEach, describe, expect, it, vi } from 'vitest';
import { AstraWorkTable } from './AstraWorkTable';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { AstraSection, AstraWorkSummary } from '../../AstraInterfaces';
import type { AstraDashboardLayout, IDashboardState } from '../../interfaces/IDashboardState';

const tables: AstraWorkTable[] = [];
const rows = (root: HTMLElement) => root.querySelectorAll<HTMLElement>('.astra-grid-row, .astra-layout-card');
function setup(layout: AstraDashboardLayout = 'table', size = 150) {
  vi.useFakeTimers();
  let sections: AstraSection[] = [{ id: 'story', name: 'Story', weight: 1 }];
  const open = vi.fn();
  const state: IDashboardState = {
    filters: { search: '', type: 'all', ratingStatus: 'all', anilistStatus: 'all', country: 'all', customLists: [], isGrouped: true },
    sort: 'title-asc', layout, showProgress: false, separateAiring: false, activeTab: 'dashboard', isLoading: false, error: null,
    stats: { totalCount: size, averageScore: 8, completedCount: 0, droppedCount: 0, planningCount: 0, genreDistribution: {}, statusDistribution: {} },
    filteredWorks: Array.from({ length: size }, (_, index) => ({ id: `work_${index}`, mediaId: index + 1, title: `Work ${index}`,
      type: 'anime', status: MediaListStatus.CURRENT, cover: 'https://example.com/cover.png', updatedAt: 1,
      currentScore: 8, sectionScores: { story: 8 }, progress: 1, episodes: 12 })),
  };
  const table = new AstraWorkTable({ setSort: vi.fn() } as never, { getSections: () => sections } as never, { open } as never);
  tables.push(table); table.mount(document.body, state);
  const internals = table as unknown as { renderTimer: number | null; renderProcessId: number;
    pendingGroups: Array<{ works: AstraWorkSummary[] }>; renderVisibleRows(): void };
  return { table, state, open, internals, replaceSections: (next: AstraSection[]) => { sections = next; } };
}
afterEach(() => { for (const table of tables.splice(0)) table.unmount(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('Astra dashboard updates without unnecessary row reconstruction', () => {
  it.each(['table', 'list', 'grid'] as const)('keeps %s rows, callbacks and pending chunks on display-only updates', layout => {
    const f = setup('table'); if (f.state.layout !== layout) { f.table.update({ layout }); }
    const root = f.table.getElement(); const first = rows(root)[0]; const timer = f.internals.renderTimer;
    const process = f.internals.renderProcessId; const rebuild = vi.spyOn(f.internals, 'renderVisibleRows');
    f.table.update({ showProgress: true, activeTab: 'settings', isLoading: true, error: 'Synthetic state',
      stats: { ...f.state.stats, averageScore: 9 }, filters: { ...f.state.filters } });
    expect(f.table.getElement()).toBe(root); expect(rows(root)[0]).toBe(first); expect(rebuild).not.toHaveBeenCalled();
    expect(f.internals.renderTimer).toBe(timer); expect(f.internals.renderProcessId).toBe(process);
    first.querySelector<HTMLElement>('[data-action="edit"]')?.click(); if (layout === 'grid') first.click();
    expect(f.open).toHaveBeenCalledOnce(); expect(f.open).toHaveBeenCalledWith(1);
  });

  it.each(['table', 'list', 'grid'] as const)('updates settled %s progress in place and preserves existing actions', async layout => {
    const f = setup(layout); await vi.advanceTimersByTimeAsync(350);
    const root = f.table.getElement(); const first = rows(root)[0]; const last = rows(root)[149];
    const changed = f.state.filteredWorks.map((work, index) => index === 0 ? { ...work, progress: 11 } : index === 149 ? { ...work, progress: 12 } : { ...work });
    const rebuild = vi.spyOn(f.internals, 'renderVisibleRows'); f.table.update({ filteredWorks: changed });
    expect(rebuild).not.toHaveBeenCalled(); expect(rows(root)).toHaveLength(150); expect(rows(root)[0]).toBe(first); expect(rows(root)[149]).toBe(last);
    expect(first.querySelector('.astra-badge--progress, .astra-layout-card-meta')?.textContent?.trim()).toBe(layout === 'grid' ? '11/12' : '11 / 12');
    expect(last.querySelector('.astra-badge--progress, .astra-layout-card-meta')?.textContent?.trim()).toBe(layout === 'grid' ? '12/12' : '12 / 12');
    if (layout !== 'grid') { expect(first.style.getPropertyValue('--progress-val')).toBe('92'); expect(last.style.getPropertyValue('--progress-val')).toBe('100'); }
    expect(f.internals.pendingGroups[0].works[0]).toBe(changed[0]); expect(f.internals.pendingGroups[0].works[149]).toBe(changed[149]);
    if (layout === 'grid') first.click(); else first.querySelector<HTMLElement>('[data-action="edit"]')!.click();
    expect(f.open).toHaveBeenCalledOnce();
  });

  it.each(['table', 'list', 'grid'] as const)('uses current references for pending %s chunks and preserves collapsed groups', async layout => {
    // Fifty visible works, one pending work, and one initially collapsed work.
    const f = setup(layout, 52); const completed = { ...f.state.filteredWorks[51], status: MediaListStatus.COMPLETED };
    const mixed = [...f.state.filteredWorks.slice(0, 51), completed]; f.table.update({ filteredWorks: mixed });
    const root = f.table.getElement(); const first = rows(root)[0]; const header = root.querySelector<HTMLElement>('.astra-grid-group-header.collapsed')!;
    const changed = mixed.map((work, index) => index === 50 ? { ...work, progress: 10 } : index === 51 ? { ...work, progress: 12 } : { ...work });
    f.table.update({ filteredWorks: changed }); expect(rows(root)[0]).toBe(first); expect(header.classList.contains('collapsed')).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(root.querySelector('[data-media-id="51"] .astra-badge--progress, [data-media-id="51"] .astra-layout-card-meta')?.textContent?.trim()).toBe(layout === 'grid' ? '10/12' : '10 / 12');
    expect(root.querySelector('[data-media-id="52"]')).toBeNull(); header.click();
    expect(root.querySelector('[data-media-id="52"] .astra-badge--progress, [data-media-id="52"] .astra-layout-card-meta')?.textContent?.trim()).toBe(layout === 'grid' ? '12/12' : '12 / 12');
  });

  it.each(['table', 'list'] as const)('keeps %s progress formatting at zero, unknown and capped totals', layout => {
    const f = setup(layout, 3);
    const works = f.state.filteredWorks.map((work, index) => ({ ...work, episodes: index === 1 ? undefined : index === 2 ? 10000 : 12 }));
    f.table.update({ filteredWorks: works }); const before = [...rows(f.table.getElement())];
    const changed = works.map((work, index) => ({ ...work, progress: index === 0 ? 24 : 1, updatedAt: 2 }));
    f.table.update({ filteredWorks: changed }); const current = [...rows(f.table.getElement())];
    expect(current).toEqual(before);
    expect(current.map(row => row.style.getPropertyValue('--progress-val'))).toEqual(['100', '5', '5']);
    expect(current[1].querySelector('.astra-badge--progress')?.textContent).toBe('1 / ?');
    f.table.update({ filteredWorks: changed.map(work => ({ ...work, progress: 0 })) });
    expect([...rows(f.table.getElement())].map(row => row.style.getPropertyValue('--progress-val'))).toEqual(['0', '0', '0']);
  });

  it('reconstructs rows for metadata, order, type, score and status changes', () => {
    const changes: Partial<AstraWorkSummary>[] = [{ title: 'Changed' }, { type: 'manga', chapters: 24 }, { currentScore: 9 },
      { sectionScores: { story: 9 } }, { episodes: 24 }, { status: MediaListStatus.COMPLETED }];
    for (const change of changes) {
      const f = setup('table', 2); const oldRow = rows(f.table.getElement())[0];
      f.table.update({ filteredWorks: f.state.filteredWorks.map((work, index) => index === 0 ? { ...work, ...change } : work) });
      expect(oldRow.isConnected).toBe(false); oldRow.querySelector<HTMLElement>('[data-action="edit"]')!.click(); expect(f.open).not.toHaveBeenCalled(); f.table.unmount();
    }
    const f = setup('table', 2); const oldRow = rows(f.table.getElement())[0]; f.table.update({ filteredWorks: [...f.state.filteredWorks].reverse() });
    expect(rows(f.table.getElement())[0].dataset.mediaId).toBe('2'); expect(oldRow.isConnected).toBe(false);
  });

  it('updates structural headers, filters and section configuration instead of treating them as display-only', () => {
    const f = setup('table', 2); const initialRoot = f.table.getElement(); f.table.update({ sort: 'title-desc' });
    expect(f.table.getElement().querySelector('[data-sort-key="title"] .astra-sort-arrow')?.textContent).toBe('▼');
    expect(f.table.getElement()).not.toBe(initialRoot);
    const previous = rows(f.table.getElement())[0]; f.table.update({ filters: { ...f.state.filters, isGrouped: false } }); expect(previous.isConnected).toBe(false);
    f.replaceSections([{ id: 'new', name: 'New section', weight: 2 }]); f.table.update({ showProgress: true });
    expect(f.table.getElement().querySelector('[data-sort-key="section-new"]')?.textContent).toContain('New section');
    expect(f.table.getElement().querySelector('[data-sort-key="section-story"]')).toBeNull();
  });

  it('keeps lifecycle guards after progress updates and renders latest data on remount', () => {
    const f = setup('table', 2); const current = rows(f.table.getElement())[0]; const control = current.querySelector<HTMLElement>('[data-action="edit"]')!;
    const changed = f.state.filteredWorks.map((work, index) => index === 0 ? { ...work, progress: 11 } : work); f.table.update({ filteredWorks: changed });
    control.remove(); control.click(); expect(f.open).not.toHaveBeenCalled();
    const beforeUnmount = rows(f.table.getElement())[1].querySelector<HTMLElement>('[data-action="edit"]')!;
    f.table.unmount(); f.table.mount(document.body); beforeUnmount.click(); expect(f.open).not.toHaveBeenCalled();
    expect(rows(f.table.getElement())[0].querySelector('.astra-badge--progress')?.textContent?.trim()).toBe('11 / 12');
    const detachedRoot = f.table.getElement(); const detachedControl = rows(detachedRoot)[0].querySelector<HTMLElement>('[data-action="edit"]')!;
    detachedRoot.remove(); detachedControl.click(); expect(f.open).not.toHaveBeenCalled();
  });
});
