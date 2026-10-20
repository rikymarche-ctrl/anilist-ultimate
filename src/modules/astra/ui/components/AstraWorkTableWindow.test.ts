import { afterEach, describe, expect, it, vi } from 'vitest';
import { AstraWorkTable } from './AstraWorkTable';
import type { AstraDashboardLayout, IDashboardState } from '../../interfaces/IDashboardState';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { AstraWorkSummary } from '../../AstraInterfaces';

const tables: AstraWorkTable[] = [];
const rowList = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.astra-grid-row, .astra-layout-card')];
const rect = (top: number, height: number) => ({ x: 0, y: top, top, bottom: top + height, left: 0, right: 900, width: 900, height, toJSON: () => ({}) });
function fixture(layout: AstraDashboardLayout = 'table', mixed = false) {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('astra-grid-body')) return rect(30 - (this.closest<HTMLElement>('.astra-table-wrap')?.scrollTop ?? 0), 1000);
    if (this.classList.contains('astra-grid-group-header')) return rect(0, 50);
    if (this.classList.contains('astra-layout-card')) return rect(0, 220);
    if (this.classList.contains('astra-grid-row')) return rect(0, layout === 'list' ? 60 : this.dataset.mediaId === '3' ? 180 : 100);
    return rect(0, 500);
  });
  const state: IDashboardState = {
    filters: { search: '', type: 'all', ratingStatus: 'all', anilistStatus: 'all', country: 'all', customLists: [], isGrouped: true },
    layout, sort: 'title-asc', showProgress: true, separateAiring: false, activeTab: 'dashboard', isLoading: false, error: null,
    stats: { totalCount: 10000, averageScore: 8, completedCount: 0, droppedCount: 0, planningCount: 0, genreDistribution: {}, statusDistribution: {} },
    filteredWorks: Array.from({ length: 10000 }, (_, index) => ({ id: `work_${index}`, mediaId: index + 1,
      title: `Work ${index}`, type: 'anime', status: mixed && index >= 4000 ? MediaListStatus.COMPLETED : MediaListStatus.CURRENT,
      updatedAt: 1, currentScore: 8, progress: 1, episodes: 12, sectionScores: { story: 8 } })),
  };
  const open = vi.fn(); const setSort = vi.fn();
  const table = new AstraWorkTable({ setSort } as never, { getSections: () => [{ id: 'story', name: 'Story', weight: 1 }] } as never, { open } as never);
  tables.push(table); table.mount(document.body, state);
  return { table, state, open, setSort, root: table.getElement() };
}
afterEach(() => { tables.splice(0).forEach(table => table.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ''; });

describe('Astra dashboard viewport window', () => {
  it.each(['table', 'list', 'grid'] as const)('bounds %s DOM and reaches distant entries in both directions', async layout => {
    const f = fixture(layout); const initial = rowList(f.root);
    expect(initial.length).toBeLessThan(40); expect(initial[0].dataset.mediaId).toBe('1');
    f.table.focusEntry(10000);
    expect(rowList(f.root).length).toBeLessThan(40);
    const last = f.root.querySelector<HTMLElement>('[data-media-id="10000"]')!;
    expect(last).not.toBeNull(); expect(document.activeElement).toBe(last);
    if (layout === 'grid') last.click(); else last.querySelector<HTMLElement>('[data-action="edit"]')!.click();
    expect(f.open).toHaveBeenCalledWith(10000);
    f.root.scrollTop = 0; f.root.dispatchEvent(new Event('scroll')); await vi.advanceTimersByTimeAsync(40);
    expect(rowList(f.root)[0].dataset.mediaId).toBe('1'); expect(last.isConnected).toBe(false);
    if (layout === 'grid') last.click(); else last.querySelector<HTMLElement>('[data-action="edit"]')!.click();
    expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.root.querySelectorAll('.astra-window-spacer')).toHaveLength(2);
  });

  it('updates visible progress in place and reads fresh offscreen data after a jump', () => {
    const f = fixture(); const first = rowList(f.root)[0];
    f.table.update({ filteredWorks: f.state.filteredWorks.map((work, index) => ({ ...work, progress: index === 0 ? 11 : index === 9999 ? 12 : 1 })) });
    expect(rowList(f.root)[0]).toBe(first); expect(first.querySelector('.astra-badge--progress')?.textContent).toBe('11 / 12');
    f.table.focusEntry(10000); expect(f.root.querySelector('[data-media-id="10000"] .astra-badge--progress')?.textContent).toBe('12 / 12');
    const top = f.root.scrollTop; const row = f.root.querySelector('[data-media-id="10000"]');
    f.table.update({ showProgress: false }); expect(f.root.scrollTop).toBe(top); expect(f.root.querySelector('[data-media-id="10000"]')).toBe(row);
  });

  it('expands a distant collapsed group for focus and keeps counts and collapse behavior', async () => {
    const f = fixture('table', true);
    f.table.focusEntry(10000); expect(f.root.querySelector('[data-media-id="10000"]')).not.toBeNull();
    f.table.focusEntry(4001);
    const header = f.root.querySelector<HTMLButtonElement>('[data-status="COMPLETED"]')!;
    expect(header.querySelector('.astra-group-badge')?.textContent).toBe('6000'); expect(header.classList.contains('collapsed')).toBe(false);
    header.focus(); header.click(); expect(f.root.querySelector('[data-media-id="4001"]')).toBeNull();
    expect(f.root.querySelector('[data-status="COMPLETED"]')?.classList.contains('collapsed')).toBe(true);
    expect(document.activeElement?.getAttribute('data-status')).toBe('COMPLETED');
    await vi.advanceTimersByTimeAsync(40);
    const liveHeader = f.root.querySelector<HTMLButtonElement>('[data-status="COMPLETED"]')!;
    liveHeader.focus(); f.root.scrollTop = Math.max(0, f.root.scrollTop - 150); f.root.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(40);
    expect(document.activeElement).toBe(liveHeader);
  });

  it('moves keyboard focus through entries beyond the mounted viewport', () => {
    const f = fixture(); f.table.focusEntry(1);
    rowList(f.root)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement?.closest('[data-media-id]')?.getAttribute('data-media-id')).toBe('10000');
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement?.closest('[data-media-id]')?.getAttribute('data-media-id')).toBe('1');
    f.table.focusEntry(3000); document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement?.closest('[data-media-id]')?.getAttribute('data-media-id')).toBe('3001');
  });

  it('continues Tab and Shift-Tab across both edges of the mounted window', () => {
    const f = fixture();
    const last = rowList(f.root).at(-1)!; const lastId = Number(last.dataset.mediaId);
    const link = last.querySelector<HTMLElement>('a')!; link.focus();
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement?.closest('[data-media-id]')?.getAttribute('data-media-id')).toBe(String(lastId + 1));
    f.table.focusEntry(5000); const first = rowList(f.root)[0]; const firstId = Number(first.dataset.mediaId);
    const title = first.querySelector<HTMLElement>('a')!; title.focus();
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement?.closest('[data-media-id]')?.getAttribute('data-media-id')).toBe(String(firstId - 1));
  });

  it('preserves the visible entry and horizontal position across sort/header reconstruction', () => {
    const f = fixture(); f.table.focusEntry(5000); f.root.scrollLeft = 123;
    f.table.update({ sort: 'title-desc' }); const root = f.table.getElement();
    expect(root.querySelector('[data-media-id="5000"]')).not.toBeNull(); expect(root.scrollLeft).toBe(123);
    f.table.update({ filteredWorks: [...f.state.filteredWorks].reverse() });
    f.table.focusEntry(1); expect(rowList(f.table.getElement()).at(-1)?.dataset.mediaId).toBe('1');
    f.table.update({ filteredWorks: f.state.filteredWorks.slice(0, 1000), filters: { ...f.state.filters, search: 'narrow' } });
    f.table.focusEntry(1000); expect(f.table.getElement().querySelector('[data-media-id="1000"]')).not.toBeNull();
    expect(f.table.getElement().querySelector('[data-media-id="10000"]')).toBeNull();
  });

  it('keeps a distant logical entry available across table/list/grid transitions', () => {
    const f = fixture(); f.table.focusEntry(5000);
    for (const layout of ['list', 'grid', 'table'] as const) {
      f.table.update({ layout }); const root = f.table.getElement();
      expect(root.querySelector('[data-media-id="5000"]')).not.toBeNull(); expect(rowList(root).length).toBeLessThan(40);
      f.table.focusEntry(10000); expect(root.querySelector('[data-media-id="10000"]')).not.toBeNull();
      f.table.focusEntry(5000);
    }
  });

  it('replaces the previous virtual anchor with the focused work after narrowing below the window threshold', () => {
    const f = fixture(); f.table.focusEntry(5000);
    f.table.update({ filteredWorks: f.state.filteredWorks.slice(0, 100), filters: { ...f.state.filters, search: 'small' } });
    const root = f.table.getElement(); const row = root.querySelector<HTMLElement>('[data-media-id="50"]')!;
    row.tabIndex = -1; row.focus(); root.scrollTop = 4700; root.scrollLeft = 123;
    f.table.update({ filteredWorks: f.state.filteredWorks, filters: { ...f.state.filters, search: '' } });
    expect(f.table.getElement().querySelector('[data-media-id="50"]')).not.toBeNull();
    expect(f.table.getElement().querySelector('[data-media-id="5000"]')).toBeNull();
    expect(f.table.getElement().scrollLeft).toBe(123);
  });

  it('captures the current visible work in a short list when no work has keyboard focus', () => {
    const f = fixture(); f.table.focusEntry(5000);
    f.table.update({ filteredWorks: f.state.filteredWorks.slice(0, 100), filters: { ...f.state.filters, search: 'small' } });
    const measured = vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation()!;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('astra-grid-row')) {
        const scroll = this.closest<HTMLElement>('.astra-table-wrap')?.scrollTop ?? 0;
        return rect(80 + (Number(this.dataset.mediaId) - 1) * 100 - scroll, 100);
      }
      if (this.classList.contains('astra-grid-group-header')) return rect(30 - (this.closest<HTMLElement>('.astra-table-wrap')?.scrollTop ?? 0), 50);
      return measured.call(this);
    });
    const root = f.table.getElement(); root.scrollTop = 4700; root.scrollLeft = 123;
    f.table.update({ filteredWorks: f.state.filteredWorks, filters: { ...f.state.filters, search: '' } });
    expect(f.table.getElement().querySelector('[data-media-id="50"]')).not.toBeNull();
    expect(f.table.getElement().querySelector('[data-media-id="5000"]')).toBeNull();
    expect(f.table.getElement().scrollLeft).toBe(123);
  });

  it('disconnects resize observation and cancels queued viewport/focus work at unmount', async () => {
    const disconnect = vi.fn(); const callbacks: ResizeObserverCallback[] = [];
    class Observer { constructor(callback: ResizeObserverCallback) { callbacks.push(callback); } observe() {} unobserve() {} disconnect = disconnect; }
    vi.stubGlobal('ResizeObserver', Observer);
    const f = fixture(); f.table.focusEntry(9000); const oldRoot = f.root;
    oldRoot.dispatchEvent(new Event('scroll')); f.table.unmount();
    expect(disconnect).toHaveBeenCalled(); callbacks[0]([], {} as ResizeObserver); await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0); expect(oldRoot.isConnected).toBe(false);
    f.table.mount(document.body); expect(f.table.getElement().querySelector('[data-media-id="9000"]')).not.toBeNull();
  });

  it('rejects an already-delivered old viewport frame after remount', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callbacks.push(callback); return callbacks.length; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const f = fixture(); const oldRoot = f.root;
    oldRoot.scrollTop = 500000; oldRoot.dispatchEvent(new Event('scroll'));
    const stale = callbacks[0]; f.table.unmount(); f.table.mount(document.body);
    const root = f.table.getElement(); const before = rowList(root);
    stale(performance.now()); expect(rowList(root)).toEqual(before); expect(oldRoot.isConnected).toBe(false);
    root.scrollTop = 0; root.dispatchEvent(new Event('scroll'));
    callbacks.at(-1)!(performance.now()); expect(rowList(root)[0].dataset.mediaId).toBe('1');
  });
});

describe('Astra dashboard resilience to bad covers, previews and keyboard focus', () => {
  const withFirstCover = (cover: string) => (work: AstraWorkSummary, index: number) => (index === 0 ? { ...work, cover } : work);

  it('renders a non-web table cover without src and keeps the row action working', () => {
    const f = fixture();
    f.table.update({ filteredWorks: f.state.filteredWorks.map(withFirstCover('javascript:alert(1)')) });
    const row = f.root.querySelector<HTMLElement>('[data-media-id="1"]')!;
    expect(row.querySelector('img')!.hasAttribute('src')).toBe(false);
    row.querySelector<HTMLElement>('.astra-col-title')!.click();
    expect(f.open).toHaveBeenCalledWith(1);
  });

  it('renders a non-web grid cover without src and keeps the card action working', () => {
    const f = fixture('grid');
    f.table.update({ filteredWorks: f.state.filteredWorks.map(withFirstCover('javascript:alert(1)')) });
    const card = f.root.querySelector<HTMLElement>('.astra-layout-card[data-media-id="1"]')!;
    expect(card.querySelector('img')!.hasAttribute('src')).toBe(false);
    card.click();
    expect(f.open).toHaveBeenCalledWith(1);
  });

  it('closes an open cover preview when the table unmounts', () => {
    const f = fixture();
    f.table.update({ filteredWorks: f.state.filteredWorks.map(withFirstCover('https://img.example/one.jpg')) });
    f.root.querySelector<HTMLElement>('[data-media-id="1"] .astra-col-cover')!.click();
    expect(document.querySelector('.astra-cover-full-overlay')).not.toBeNull();
    f.table.unmount();
    expect(document.querySelector('.astra-cover-full-overlay')).toBeNull();
    expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))).not.toThrow();
  });

  it('does not hijack arrow keys from a focused group header with a remembered row', () => {
    const f = fixture();
    const firstLink = f.root.querySelector<HTMLElement>('[data-media-id="1"] a')!;
    firstLink.focus();
    firstLink.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement?.closest('[data-media-id]')?.getAttribute('data-media-id')).toBe('2');
    const header = f.root.querySelector<HTMLButtonElement>('.astra-grid-group-header')!;
    header.focus();
    header.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(header);
  });
});
