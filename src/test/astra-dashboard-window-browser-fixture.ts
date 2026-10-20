import 'reflect-metadata';
import '@/styles/astra.css';
import { AstraWorkTable } from '@modules/astra/ui/components/AstraWorkTable';
import type { AstraDashboardStore } from '@modules/astra/store/AstraDashboardStore';
import type { AstraService } from '@modules/astra/AstraService';
import type { AstraRatingModal } from '@modules/astra/ui/AstraRatingModal';
import type { AstraWorkSummary } from '@modules/astra/AstraInterfaces';
import type { AstraDashboardLayout, IDashboardState } from '@modules/astra/interfaces/IDashboardState';
import { MediaListStatus } from '@/api/AnilistTypes';

const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export async function measureAstraDashboardWindow(size: number, layout: AstraDashboardLayout) {
  const works: AstraWorkSummary[] = Array.from({ length: size }, (_, index) => ({ id: `work_${index}`, mediaId: index + 1,
    title: `Synthetic ${index} ${'title '.repeat(index % 5)}`, type: 'anime', status: MediaListStatus.CURRENT, cover: '',
    updatedAt: 1, currentScore: 8, progress: 1, episodes: 12, sectionScores: { story: 8, character: 7, sound: 9 } }));
  const state: IDashboardState = {
    filters: { search: '', type: 'all', ratingStatus: 'all', anilistStatus: 'all', country: 'all', customLists: [], isGrouped: true },
    layout, sort: 'title-asc', showProgress: true, separateAiring: false, activeTab: 'dashboard', isLoading: false, error: null, filteredWorks: works,
    stats: { totalCount: size, averageScore: 8, completedCount: 0, droppedCount: 0, planningCount: 0, genreDistribution: {}, statusDistribution: {} },
  };
  const assert = (condition: boolean, description: string) => { if (!condition) throw new Error(description); };
  const edits: number[] = [];
  const table = new AstraWorkTable({ setSort: () => {} } as unknown as AstraDashboardStore,
    { getSections: () => [{ id: 'story', name: 'Story', weight: 1 }, { id: 'character', name: 'Character', weight: 1 }, { id: 'sound', name: 'Sound', weight: 1 }] } as unknown as AstraService,
    { open: (id: number) => { edits.push(id); } } as unknown as AstraRatingModal);
  const internals = table as unknown as { renderWindow(): void; renderFrame: number | null; windowColumns: number; windowPlanner: { totalHeight: number } | null };
  const host = document.createElement('div'); host.className = 'astra-modal--dashboard astra-dashboard astra-window-stress';
  host.style.cssText = 'position:relative;display:flex;flex-direction:column;width:1100px;height:600px;'; document.body.append(host);
  const stressStyle = document.createElement('style');
  stressStyle.textContent = '.astra-window-stress .astra-grid-row[data-media-id="3"]{min-height:180px!important}';
  document.head.append(stressStyle);
  const rows = () => [...table.getElement().querySelectorAll<HTMLElement>('.astra-grid-row, .astra-layout-card')];
  const id = (row: HTMLElement) => Number(row.dataset.mediaId);
  try {
    const mounted = performance.now(); table.mount(host, state); const mountMs = performance.now() - mounted;
    await settle(); const root = table.getElement();
    const viewportHeight = root.clientHeight;
    assert(root.clientHeight > 200 && root.clientHeight <= 700, `Invalid native viewport ${root.clientHeight}`);
    const initialRows = rows().length; const initialNodes = root.querySelectorAll('*').length;
    const rowHeight = rows()[0].getBoundingClientRect().height;
    const variableRowHeight = root.querySelector('[data-media-id="3"]')?.getBoundingClientRect().height;
    if (layout !== 'grid') assert((variableRowHeight ?? 0) >= 179.5, `Variable row height stress was not measured: ${variableRowHeight}; rows=${rows().map(id)}; scroll=${root.scrollTop}; heights=${rows().map(row => row.getBoundingClientRect().height)}`);
    const columnsBefore = internals.windowColumns;
    assert(initialRows > 0 && initialRows < 250, `Initial live rows not bounded: ${initialRows}`);
    const first = rows()[0]; const control = layout === 'grid' ? first : first.querySelector<HTMLElement>('[data-action="edit"]')!;
    const progressStarted = performance.now(); table.update({ filteredWorks: works.map((work, index) => ({ ...work, progress: index === 0 ? 11 : index === size - 1 ? 12 : 1 })) });
    const progressUpdateMs = performance.now() - progressStarted;
    assert(rows()[0] === first, 'Progress replaced live first row');
    const jumpStarted = performance.now(); table.focusEntry(size); await settle(); const distantJumpMs = performance.now() - jumpStarted;
    const last = root.querySelector<HTMLElement>(`[data-media-id="${size}"]`)!;
    assert(Boolean(last) && rows().length < 250, 'Distant jump lost target/bound');
    const lastProgress = last.querySelector('.astra-badge--progress, .astra-layout-card-meta')?.textContent?.trim();
    assert(lastProgress === (layout === 'grid' ? '12/12' : '12 / 12'), 'Offscreen progress was stale');
    (layout === 'grid' ? last : last.querySelector<HTMLElement>('[data-action="edit"]')!).click();
    control.click(); assert(edits.join(',') === String(size), 'Stale row callback was accepted');
    root.scrollTop = 0; root.dispatchEvent(new Event('scroll')); await settle();
    assert(rows().some(row => id(row) === 1) && !last.isConnected, 'Native backwards scroll failed');
    // Exhaustive data reachability uses the production viewport method directly;
    // this is an explicit traversal probe, not a browser scroll-latency measure.
    const seen = new Set<number>(); let maxRows = 0; let maxNodes = 0;
    const traversalStarted = performance.now();
    for (let top = 0; top <= root.scrollHeight + root.clientHeight; top += root.clientHeight / 2) {
      root.scrollTop = top; internals.renderWindow();
      const current = rows(); current.forEach(row => seen.add(id(row)));
      maxRows = Math.max(maxRows, current.length); maxNodes = Math.max(maxNodes, root.querySelectorAll('*').length);
    }
    const explicitTraversalMs = performance.now() - traversalStarted;
    assert(seen.size === size && maxRows < 250, `Reachability/bound failure ${seen.size}/${size}, rows=${maxRows}`);
    table.focusEntry(Math.floor(size / 2)); await settle();
    host.style.width = '650px'; await settle(); await settle();
    const columnsAfter = internals.windowColumns;
    assert(Boolean(root.querySelector(`[data-media-id="${Math.floor(size / 2)}"]`)), 'Resize lost scroll anchor');
    if (layout === 'grid') assert(columnsAfter < columnsBefore, 'Grid columns did not follow actual CSS resize');
    const mixed = works.map((work, index) => ({ ...work, status: index >= size / 2 ? MediaListStatus.COMPLETED : MediaListStatus.CURRENT }));
    table.update({ filteredWorks: mixed }); table.focusEntry(size); await settle();
    assert(Boolean(root.querySelector(`[data-media-id="${size}"]`)), 'Collapsed group jump failed');
    table.focusEntry(Math.floor(size / 2) + 1); await settle();
    const completed = root.querySelector<HTMLButtonElement>('[data-status="COMPLETED"]');
    assert(Boolean(completed), 'Completed header unreachable'); completed!.focus(); completed!.click(); await settle();
    assert(!root.querySelector(`[data-media-id="${size}"]`), 'Collapsed group retained work');
    assert(document.activeElement?.getAttribute('data-status') === 'COMPLETED', 'Group toggle lost keyboard focus');
    table.focusEntry(1); await settle();
    root.querySelector<HTMLElement>('[data-media-id="1"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await settle();
    assert(Number(document.activeElement?.closest<HTMLElement>('[data-media-id]')?.dataset.mediaId) === Math.floor(size / 2), 'Keyboard End failed across viewport');
    const oldRoot = root; const live = rows()[0]; const liveControl = layout === 'grid' ? live : live.querySelector<HTMLElement>('[data-action="edit"]')!;
    root.dispatchEvent(new Event('scroll')); const unmountStarted = performance.now(); table.unmount(); const unmountMs = performance.now() - unmountStarted;
    liveControl.click(); await settle();
    assert(edits.length === 1 && internals.renderFrame === null && !oldRoot.isConnected, 'Unmount left callbacks/frame active');
    table.mount(host); await settle(); assert(rows().length > 0 && rows().length < 250, 'Remount lost viewport/bound');
    for (const nextLayout of ['table', 'list', 'grid'] as const) {
      const target = Math.floor(size / 4); table.focusEntry(target); await settle();
      table.update({ layout: nextLayout }); await settle();
      assert(Boolean(table.getElement().querySelector(`[data-media-id="${target}"]`)), 'Layout transition lost distant anchor');
      assert(rows().length < 250, 'Layout transition exceeded live DOM bound');
    }
    return { size, layout, mountMs, viewportHeight, rowHeight, variableRowHeight, columnsBefore, columnsAfter,
      initialRows, initialNodes, progressUpdateMs, distantJumpMs, lastProgress,
      maxRows, maxNodes, reachableWorks: seen.size, explicitTraversalMs,
      groupJumpCollapse: true, groupKeyboardFocusPreserved: true, keyboardDistantJump: true, resizeAnchorPreserved: true, layoutTransitionsPreserved: true,
      staleActionsRejected: true, unmountMs, remountRows: rows().length };
  } finally { table.unmount(); host.remove(); stressStyle.remove(); }
}
