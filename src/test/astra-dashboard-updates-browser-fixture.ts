/** Dedicated production updates probe; forced settling is preparation only. */
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

export async function measureAstraDashboardUpdates(size: number, layout: AstraDashboardLayout) {
  let works: AstraWorkSummary[] = Array.from({ length: size }, (_, index) => ({
    id: `synthetic_${index}`, mediaId: index + 1, title: `Synthetic ${index}`, type: 'anime',
    status: MediaListStatus.CURRENT, cover: '', country: 'JP', episodes: 12, progress: 1,
    updatedAt: 1, currentScore: 8, sectionScores: { story: 8, character: 7, sound: 9 },
  }));
  const state: IDashboardState = {
    filters: { search: '', type: 'all', ratingStatus: 'all', anilistStatus: 'all', country: 'all', customLists: [], isGrouped: true },
    sort: 'title-asc', filteredWorks: works, layout, showProgress: true, separateAiring: false, activeTab: 'dashboard', isLoading: false, error: null,
    stats: { totalCount: size, averageScore: 8, completedCount: 0, droppedCount: 0, planningCount: 0, genreDistribution: {}, statusDistribution: {} },
  };
  const edits: number[] = [];
  const table = new AstraWorkTable({ setSort: () => {} } as unknown as AstraDashboardStore,
    { getSections: () => [{ id: 'story', name: 'Story', weight: 1 }, { id: 'character', name: 'Character', weight: 1 },
      { id: 'sound', name: 'Sound', weight: 1 }] } as unknown as AstraService,
    { open: (id: number) => { edits.push(id); } } as unknown as AstraRatingModal);
  const internals = table as unknown as { renderProcessId: number; renderTimer: number | null;
    pendingGroups: Array<{ status: string; works: AstraWorkSummary[] }>; renderedGroupCounts: Map<string, number>;
    renderNextGroupChunk(group: unknown): void; stopAutoRender(): void };
  const parent = document.createElement('div'); parent.className = 'astra-dashboard'; document.body.append(parent);
  const roots = () => [...table.getElement().querySelectorAll<HTMLElement>('.astra-grid-row, .astra-layout-card')];
  const text = (row: HTMLElement) => row.querySelector('.astra-badge--progress, .astra-layout-card-meta')?.textContent?.trim();
  const expected = (progress: number) => layout === 'grid' ? `${progress}/12` : `${progress} / 12`;
  const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  try {
    table.mount(parent, state);
    const root = table.getElement(); const first = roots()[0];
    const process = internals.renderProcessId; const timer = internals.renderTimer;
    works = works.map((work, index) => ({ ...work, progress: index === 0 || index === size - 1 ? 11 : work.progress, updatedAt: 2 }));
    const pendingStarted = performance.now(); table.update({ filteredWorks: works });
    const pendingUpdateMs = performance.now() - pendingStarted;
    const pendingRows = roots().length;
    const pendingPreserved = roots()[0] === first && process === internals.renderProcessId && timer === internals.renderTimer;
    assert(pendingRows === 50 && pendingPreserved && text(first) === expected(11), 'Pending update restarted/replaced rows');
    const resumeStarted = performance.now();
    while ([...internals.renderedGroupCounts.values()].reduce((sum, count) => sum + count, 0) === 50) {
      assert(performance.now() - resumeStarted < 3000, 'Native pending chunk did not resume'); await pause(25);
    }
    const nativeResumeRows = roots().length;
    const nativeResumeMs = performance.now() - resumeStarted;
    // Produce a complete DOM for update measurements without treating this as
    // a measurement of production scheduling/completion latency.
    const settlingStarted = performance.now(); internals.stopAutoRender();
    for (const group of internals.pendingGroups) {
      while ((internals.renderedGroupCounts.get(group.status) ?? 0) < group.works.length) {
        const before = internals.renderedGroupCounts.get(group.status) ?? 0;
        internals.renderNextGroupChunk(group);
        assert((internals.renderedGroupCounts.get(group.status) ?? 0) > before, 'Forced preparation stopped making progress');
      }
    }
    const forcedSettlingPreparationMs = performance.now() - settlingStarted;
    const settled = roots(); assert(settled.length === size, 'Forced preparation lost rows');
    assert(text(settled[size - 1]) === expected(11), 'Pending references remained stale');
    const nodeCountBefore = root.querySelectorAll('*').length;
    const displaySamplesMs: number[] = []; const progressSamplesMs: number[] = [];
    for (let index = 0; index < 20; index++) {
      const started = performance.now(); table.update({ showProgress: index % 2 === 0 }); displaySamplesMs.push(performance.now() - started);
    }
    for (let index = 0; index < 5; index++) {
      const progress = index % 2 === 0 ? 12 : 10;
      works = works.map((work, offset) => ({ ...work, progress: offset === 0 || offset === size - 1 ? progress : work.progress, updatedAt: index + 3 }));
      const started = performance.now(); table.update({ filteredWorks: works }); progressSamplesMs.push(performance.now() - started);
      assert(text(settled[0]) === expected(progress) && text(settled[size - 1]) === expected(progress), 'Settled progress mismatch');
    }
    const after = roots(); const allRowsPreserved = after.length === size && after.every((row, index) => row === settled[index]);
    const action = (row: HTMLElement) => { if (layout === 'grid') row.click(); else row.querySelector<HTMLElement>('[data-action="edit"]')!.click(); };
    action(settled[0]); action(settled[size - 1]);
    assert(allRowsPreserved && edits.join(',') === `1,${size}`, 'Rows/actions lost after updates');
    const timerAfterUpdates = internals.renderTimer !== null;
    const processPreserved = process === internals.renderProcessId;
    const nodeCountAfter = root.querySelectorAll('*').length;
    table.unmount(); action(settled[0]); action(settled[size - 1]);
    const detachedActionsRejected = edits.length === 2;
    assert(detachedActionsRejected && !timerAfterUpdates && processPreserved, 'Lifecycle guard/process regression');
    return { size, layout, pendingUpdateMs, pendingRows, pendingPreserved, nativeResumeRows, nativeResumeMs,
      forcedSettlingPreparationMs, displaySamplesMs, progressSamplesMs, settledRows: settled.length,
      allRowsPreserved, firstProgress: text(settled[0]), lastProgress: text(settled[size - 1]),
      nodeCountBefore, nodeCountAfter, timerAfterUpdates, processPreserved, acceptedActions: edits, detachedActionsRejected };
  } finally { table.unmount(); parent.remove(); }
}
