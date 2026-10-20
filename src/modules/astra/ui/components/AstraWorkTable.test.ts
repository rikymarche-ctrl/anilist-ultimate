import { afterEach, describe, expect, it, vi } from 'vitest';
import { AstraWorkTable } from './AstraWorkTable';
import { sectionColumnWidth } from './AstraTableColumns';
import type { IDashboardState } from '../../interfaces/IDashboardState';
import { MediaListStatus } from '@/api/AnilistTypes';

const tables: AstraWorkTable[] = [];
function fixture(open: (mediaId: number) => void = () => {}) {
  const table = new AstraWorkTable(
    {} as never,
    { getSections: () => [] } as never,
    { open } as never
  );
  tables.push(table);
  return table;
}
const stats: IDashboardState['stats'] = {
  totalCount: 1,
  averageScore: 0,
  completedCount: 0,
  droppedCount: 0,
  planningCount: 0,
  genreDistribution: {},
  statusDistribution: {},
};
afterEach(() => {
  for (const table of tables.splice(0)) table.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function populatedState(size = 160): Partial<IDashboardState> {
  return {
    layout: 'table',
    stats: { ...stats, totalCount: size },
    filteredWorks: Array.from({ length: size }, (_, index) => ({
      id: `work_${index}`,
      mediaId: index + 1,
      title: `Work ${index}`,
      type: 'anime',
      status: MediaListStatus.CURRENT,
      cover: 'https://example.com/cover.png',
      updatedAt: 1,
      currentScore: null,
      progress: 1,
      episodes: 12,
    })),
  };
}

describe('Astra work table render lifetime', () => {
  const rows = (root: HTMLElement) =>
    root.querySelectorAll('.astra-grid-row, .astra-layout-card').length;

  it('stops a pending render timeout when unmounted', async () => {
    vi.useFakeTimers();
    const table = fixture();
    table.mount(document.body, populatedState());
    const oldRoot = table.getElement();
    expect(rows(oldRoot)).toBe(50);
    table.unmount();
    await vi.advanceTimersByTimeAsync(500);
    expect(rows(oldRoot)).toBe(50);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a queued frame and rejects a delivered old callback after remount', async () => {
    vi.useFakeTimers();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const table = fixture();
    table.mount(document.body, populatedState());
    const oldRoot = table.getElement();
    await vi.advanceTimersByTimeAsync(75);
    const [oldId, staleFrame] = [...frames][0];
    expect(frames.size).toBe(1);
    table.unmount();
    expect(cancel).toHaveBeenCalledWith(oldId);
    expect(frames.size).toBe(0);
    table.mount(document.body, populatedState(170));
    const newRoot = table.getElement();
    staleFrame(performance.now());
    expect(rows(oldRoot)).toBe(50);
    expect(rows(newRoot)).toBe(50);
    await vi.advanceTimersByTimeAsync(75);
    const liveFrame = [...frames.values()][0];
    expect(liveFrame).toBeDefined();
    liveFrame(performance.now());
    expect(rows(newRoot)).toBe(100);
    expect(rows(oldRoot)).toBe(50);
  });

  it('rejects old queued frames after a data update and lets the replacement finish', async () => {
    vi.useFakeTimers();
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const table = fixture();
    table.mount(document.body, populatedState());
    await vi.advanceTimersByTimeAsync(75);
    const stale = callbacks[0];
    table.update(populatedState(120));
    const root = table.getElement();
    stale(performance.now());
    expect(rows(root)).toBe(50);
    await vi.advanceTimersByTimeAsync(75);
    callbacks[1](performance.now());
    expect(rows(root)).toBe(100);
    await vi.advanceTimersByTimeAsync(75);
    callbacks[2](performance.now());
    expect(rows(root)).toBe(120);
  });

  it('accepts updated data while unmounted without scheduling detached work and renders it on remount', async () => {
    vi.useFakeTimers();
    const table = fixture();
    table.mount(document.body, populatedState());
    table.unmount();
    table.update(populatedState(90));
    const detachedRoot = table.getElement();
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.getTimerCount()).toBe(0);
    expect(rows(detachedRoot)).toBe(0);
    table.mount(document.body);
    expect(rows(table.getElement())).toBe(50);
    await vi.advanceTimersByTimeAsync(200);
    expect(rows(table.getElement())).toBe(90);
    expect(rows(detachedRoot)).toBe(0);
  });

  it('contains removed controls and old rows after data replacement, unmount and remount', () => {
    vi.useFakeTimers();
    const open = vi.fn();
    const table = fixture(open);
    table.mount(document.body, populatedState());
    const removed = table.getElement().querySelector<HTMLElement>('[data-action="edit"]')!;
    removed.remove();
    removed.click();
    expect(open).not.toHaveBeenCalled();
    const oldControl = table.getElement().querySelector<HTMLElement>('[data-action="edit"]')!;
    table.update(populatedState(90));
    oldControl.click();
    expect(open).not.toHaveBeenCalled();
    const beforeUnmount = table.getElement().querySelector<HTMLElement>('[data-action="edit"]')!;
    table.unmount();
    beforeUnmount.click();
    expect(open).not.toHaveBeenCalled();
    table.mount(document.body);
    beforeUnmount.click();
    oldControl.click();
    expect(open).not.toHaveBeenCalled();
    table.getElement().querySelector<HTMLElement>('[data-action="edit"]')!.click();
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(1);
  });

  it('removes component-owned body and header listeners on unmount', () => {
    vi.useFakeTimers();
    const table = fixture();
    table.mount(document.body, populatedState());
    const root = table.getElement();
    const body = root.querySelector<HTMLElement>('.astra-grid-body')!;
    const header = root.querySelector<HTMLElement>('.astra-grid-header')!;
    const bodyRemove = vi.spyOn(body, 'removeEventListener');
    const headerRemove = vi.spyOn(header, 'removeEventListener');
    table.unmount();
    expect(bodyRemove).toHaveBeenCalledTimes(3);
    expect(headerRemove).toHaveBeenCalledOnce();
  });
});

describe('Astra work table partial initialization', () => {
  it('accepts an initial layout update before dashboard data arrives', () => {
    const table = fixture();
    table.mount(document.body);
    expect(() => table.update({ layout: 'list' })).not.toThrow();
    expect(document.querySelector('.astra-empty-state')).toBeNull();
    table.update({ filteredWorks: [], stats });
    expect(document.querySelector('.astra-empty-state')?.textContent).toContain('No works found');
  });
  it('waits for stats when filtered data arrives separately and then preserves the empty result view', () => {
    const table = fixture();
    table.mount(document.body);
    expect(() => table.update({ filteredWorks: [] })).not.toThrow();
    expect(document.querySelector('.astra-empty-state')).toBeNull();
    table.update({ stats });
    const view = document.querySelector('.astra-empty-state');
    table.update({ sort: 'title-desc' });
    expect(document.querySelector('.astra-empty-state')).toBe(view);
  });
});

describe('Astra dashboard grid cover preview', () => {
  it('opens the full-size cover without a pill or Quick Edit action', () => {
    const edit = vi.fn();
    const table = fixture(edit);
    const data = populatedState(1);
    data.layout = 'grid';
    table.mount(document.body, data);

    const card = table.getElement().querySelector<HTMLElement>('.astra-layout-card')!;
    const cover = card.querySelector<HTMLImageElement>('.astra-layout-card-cover')!;
    const coverWrap = card.querySelector<HTMLElement>('.astra-layout-card-cover-wrap')!;

    expect(coverWrap.querySelector('.au-pill-wrapper')).toBeNull();
    coverWrap.click();
    const overlay = document.querySelector<HTMLElement>('.astra-cover-full-overlay');
    const preview = overlay?.querySelector<HTMLImageElement>('.astra-cover-full-img');
    expect(preview?.src).toBe(cover.src);
    expect(preview?.alt).toBe('Work 0');
    expect(edit).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.astra-cover-full-overlay')).toBeNull();
    card.click();
    expect(edit).toHaveBeenCalledExactlyOnceWith(1);
  });
});

describe('Astra dashboard table cover preview', () => {
  it('opens the full-size cover without triggering row Quick Edit', () => {
    const edit = vi.fn();
    const table = fixture(edit);
    table.mount(document.body, populatedState(1));

    const row = table.getElement().querySelector<HTMLElement>('.astra-grid-row')!;
    const cover = row.querySelector<HTMLImageElement>('.astra-table-cover')!;
    row.querySelector<HTMLElement>('.astra-col-cover')!.click();

    const overlay = document.querySelector<HTMLElement>('.astra-cover-full-overlay');
    const preview = overlay?.querySelector<HTMLImageElement>('.astra-cover-full-img');
    expect(preview?.src).toBe(cover.src);
    expect(preview?.alt).toBe('Work 0');
    expect(edit).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.astra-cover-full-overlay')).toBeNull();
  });
});

describe('Astra dashboard row activation', () => {
  it.each(['table', 'list'] as const)(
    'opens Quick Edit from anywhere on a %s row, without an Actions column',
    (layout) => {
      const edit = vi.fn();
      const table = fixture(edit);
      table.mount(document.body, { ...populatedState(1), layout });
      const root = table.getElement();

      expect(root.querySelector('.astra-col-actions')).toBeNull();
      root.querySelector<HTMLElement>('.astra-grid-row .astra-col-score')!.click();
      expect(edit).toHaveBeenCalledExactlyOnceWith(1);
    }
  );

  it('keeps the title as an AniList link that a modified click follows natively', () => {
    const edit = vi.fn();
    const table = fixture(edit);
    table.mount(document.body, populatedState(1));
    const title = table.getElement().querySelector<HTMLAnchorElement>('a.astra-table-title')!;

    expect(title.href).toBe('https://anilist.co/anime/1');
    expect(title.target).toBe('_blank');
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    title.dispatchEvent(modified);
    expect(edit).not.toHaveBeenCalled();
    expect(modified.defaultPrevented).toBe(false);

    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    title.dispatchEvent(plain);
    expect(edit).toHaveBeenCalledExactlyOnceWith(1);
    expect(plain.defaultPrevented).toBe(true);
  });
});

describe('Astra dashboard section columns', () => {
  const sections = [
    { id: 'story', name: 'Story', weight: 1 },
    { id: 'consistency', name: 'Consistency', weight: 1 },
  ];
  function sectionFixture(list = sections) {
    const table = new AstraWorkTable(
      {} as never,
      { getSections: () => list } as never,
      { open: () => {} } as never
    );
    tables.push(table);
    return table;
  }

  it.each(['table', 'list'] as const)(
    'sizes each section track from its label in the %s layout',
    (layout) => {
      const table = sectionFixture();
      table.mount(document.body, { ...populatedState(1), layout });

      const grid = table.getElement().querySelector<HTMLElement>('.astra-grid')!;
      expect(grid.style.getPropertyValue('--astra-dynamic-cols').trim()).toBe(
        `${sectionColumnWidth('Story')}px ${sectionColumnWidth('Consistency')}px`
      );
    }
  );

  it('declares no section tracks when there are no sections', () => {
    const table = sectionFixture([]);
    table.mount(document.body, populatedState(1));

    const grid = table.getElement().querySelector<HTMLElement>('.astra-grid')!;
    expect(grid.style.getPropertyValue('--astra-dynamic-cols')).toBe('');
  });
});
