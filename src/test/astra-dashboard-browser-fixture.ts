/** Native production WorkTable scaling over synthetic summaries and adapters. */
import 'reflect-metadata';
import '@/styles/astra.css';
import { AstraWorkTable } from '@modules/astra/ui/components/AstraWorkTable';
import type { AstraDashboardStore } from '@modules/astra/store/AstraDashboardStore';
import type { AstraService } from '@modules/astra/AstraService';
import type { AstraRatingModal } from '@modules/astra/ui/AstraRatingModal';
import type { AstraWorkSummary } from '@modules/astra/AstraInterfaces';
import type { AstraDashboardLayout, IDashboardState } from '@modules/astra/interfaces/IDashboardState';
import { MediaListStatus } from '@/api/AnilistTypes';

const pause = (duration: number) => new Promise<void>(resolve => setTimeout(resolve, duration));

/** Count explicit add/remove operations, including detached controls; no heap inference. */
function auditListeners() {
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const listeners = new Map<EventTarget, Map<string, Set<EventListenerOrEventListenerObject>>>();
  EventTarget.prototype.addEventListener = function (type, callback, options) {
    if (this instanceof Element && callback) {
      let target = listeners.get(this); if (!target) { target = new Map(); listeners.set(this, target); }
      let handlers = target.get(type); if (!handlers) { handlers = new Set(); target.set(type, handlers); }
      handlers.add(callback);
    }
    return add.call(this, type, callback, options);
  };
  EventTarget.prototype.removeEventListener = function (type, callback, options) {
    if (callback) listeners.get(this)?.get(type)?.delete(callback);
    return remove.call(this, type, callback, options);
  };
  return {
    sample: (root: HTMLElement) => {
      let rootListeners = 0; let detachedListeners = 0;
      for (const [target, types] of listeners) {
        const count = [...types.values()].reduce((sum, handlers) => sum + handlers.size, 0);
        if (target instanceof Node && root.contains(target)) rootListeners += count;
        else detachedListeners += count;
      }
      return { rootListeners, detachedListeners };
    },
    restore: () => { EventTarget.prototype.addEventListener = add; EventTarget.prototype.removeEventListener = remove; listeners.clear(); },
  };
}

export async function measureAstraDashboard(size: number, layout: AstraDashboardLayout, mixedGroups = false) {
  const summaries: AstraWorkSummary[] = Array.from({ length: size }, (_, index) => ({
    id: `synthetic_${index}`, mediaId: index + 1, title: `Synthetic ${String(index).padStart(5, '0')}`,
    type: 'anime', status: mixedGroups && index >= Math.ceil(size / 2) ? MediaListStatus.COMPLETED : MediaListStatus.CURRENT,
    cover: 'https://example.com/synthetic-cover.png', country: 'JP', episodes: 12, progress: index % 13,
    updatedAt: 1, currentScore: 8, sectionScores: { story: 8, character: 7, sound: 9 },
  }));
  const state: IDashboardState = {
    filters: { search: '', type: 'all', ratingStatus: 'all', anilistStatus: 'all', country: 'all', customLists: [], isGrouped: true },
    sort: 'title-asc', filteredWorks: summaries, layout, showProgress: true, separateAiring: false, activeTab: 'dashboard', isLoading: false, error: null,
    stats: { totalCount: size, averageScore: 8, completedCount: mixedGroups ? Math.floor(size / 2) : 0,
      droppedCount: 0, planningCount: 0, genreDistribution: {}, statusDistribution: {} },
  };
  const edits: number[] = [];
  const audit = auditListeners();
  const table = new AstraWorkTable({ setSort: () => {} } as unknown as AstraDashboardStore,
    { getSections: () => [{ id: 'story', name: 'Story', weight: 1 }, { id: 'character', name: 'Character', weight: 1 },
      { id: 'sound', name: 'Sound', weight: 1 }] } as unknown as AstraService,
    { open: (mediaId: number) => { edits.push(mediaId); } } as unknown as AstraRatingModal);
  const internals = table as unknown as {
    renderTimer: number | null; renderProcessId: number; pendingBody: HTMLElement | null;
    renderVisibleRows(): void;
    renderedGroupCounts: Map<string, number>; renderNextGroupChunk(group: unknown): void; stopAutoRender(): void;
  };
  const originalChunk = internals.renderNextGroupChunk;
  let longestChunkMs = 0; let renderedChunks = 0;
  internals.renderNextGroupChunk = function (group) {
    const started = performance.now(); originalChunk.call(this, group);
    longestChunkMs = Math.max(longestChunkMs, performance.now() - started); renderedChunks++;
  };
  const renderedCount = () => [...internals.renderedGroupCounts.values()].reduce((sum, count) => sum + count, 0);
  const rowCount = (root: HTMLElement) => root.querySelectorAll('.astra-grid-row, .astra-layout-card').length;
  const untilCount = async (count: number) => {
    const deadline = performance.now() + 60000;
    while (renderedCount() < count) {
      if (performance.now() > deadline) throw new Error(`Synthetic dashboard render deadline exceeded: ${renderedCount()}/${count}; chunks=${renderedChunks}; timer=${internals.renderTimer}`);
      await pause(25);
    }
  };
  const parent = document.createElement('div'); parent.className = 'astra-dashboard'; document.body.append(parent);
  const beforeNodes = document.querySelectorAll('*').length;
  try {
    const started = performance.now(); table.mount(parent, state);
    const mountMs = performance.now() - started;
    const root = table.getElement();
    const initialRows = rowCount(root);
    if (!initialRows) {
      internals.renderVisibleRows();
      throw new Error(`Synthetic dashboard mount produced no rows: ${root.outerHTML.slice(0, 500)}`);
    }
    const initialNodes = root.querySelectorAll('*').length + 1;
    const collapsedGroups = root.querySelectorAll('.astra-grid-group-header.collapsed').length;
    await untilCount(mixedGroups ? Math.ceil(size / 2) : size);
    const naturallyCompletedMs = performance.now() - started;
    const naturallyCompletedRows = rowCount(root);
    const completedNodes = root.querySelectorAll('*').length + 1;
    const completedListeners = audit.sample(root);
    let expandedGroupMs: number | null = null;
    if (mixedGroups) {
      const expandStarted = performance.now(); root.querySelector<HTMLButtonElement>('.astra-grid-group-header.collapsed')?.click();
      await untilCount(size); expandedGroupMs = performance.now() - expandStarted;
    }
    const oldFirstRow = root.querySelector('.astra-grid-row, .astra-layout-card');
    const displayStarted = performance.now(); table.update({ showProgress: false });
    const displayOnlyUpdateMs = performance.now() - displayStarted;
    const displayOnlyRows = rowCount(root);
    const firstRowPreservedOnDisplayChange = oldFirstRow === root.querySelector('.astra-grid-row, .astra-layout-card');
    const changed = summaries.map((work, index) => index === 0 ? { ...work, progress: 11 } : work);
    const progressStarted = performance.now(); table.update({ filteredWorks: changed });
    const progressOnlyUpdateMs = performance.now() - progressStarted;
    const progressOnlyRows = rowCount(root);
    const progressText = root.querySelector('.astra-badge--progress, .astra-layout-card-meta')?.textContent?.trim();
    const beforeUnmountListeners = audit.sample(root);
    const detachedEdit = root.querySelector<HTMLElement>('[data-action="edit"]');
    const unmountStarted = performance.now(); table.unmount();
    const unmountMs = performance.now() - unmountStarted;
    const rowsAtUnmount = rowCount(root);
    const timerAfterUnmount = internals.renderTimer !== null;
    const editsBefore = edits.length; detachedEdit?.click();
    const detachedEditAccepted = edits.length > editsBefore;
    await pause(300);
    const rowsAfterUnmountDelay = rowCount(root);
    const afterUnmountListeners = audit.sample(root);
    return { size, layout, mixedGroups, mountMs, initialRows, initialNodes, collapsedGroups, naturallyCompletedMs,
      naturallyCompletedRows, completedNodes, completedListeners, renderedChunks, longestChunkMs, expandedGroupMs,
      displayOnlyUpdateMs, displayOnlyRows, firstRowPreservedOnDisplayChange, progressOnlyUpdateMs, progressOnlyRows, progressText,
      beforeUnmountListeners, unmountMs, rowsAtUnmount, timerAfterUnmount, rowsAfterUnmountDelay, afterUnmountListeners,
      detachedEditAccepted, connectedResidualNodes: document.querySelectorAll('*').length - beforeNodes };
  } finally {
    // Explicit fixture cleanup prevents a production detached render from contaminating subsequent workloads.
    internals.renderProcessId++; internals.stopAutoRender(); table.unmount(); parent.remove(); audit.restore();
  }
}
