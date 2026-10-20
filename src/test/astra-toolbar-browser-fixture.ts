/** Real dashboard/filter/table and CSS over in-memory synthetic account-free data. */
import 'reflect-metadata';
import '@/styles/main.css';
import '@/styles/astra.css';
import '@core/ui/Icons';
import { AstraDashboard } from '@modules/astra/ui/AstraDashboard';
import { AstraFilterBar } from '@modules/astra/ui/components/AstraFilterBar';
import { AstraWorkTable } from '@modules/astra/ui/components/AstraWorkTable';
import { AstraOverlayService } from '@modules/astra/services/AstraOverlayService';
import { EventBus } from '@core/events/EventBus';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { IDashboardState } from '@modules/astra/interfaces/IDashboardState';

let release: (() => void) | undefined;
let calls: string[] = [];

export async function mountAstraToolbar(): Promise<void> {
  release?.(); document.body.replaceChildren(); calls = [];
  let state: IDashboardState = {
    filters: { search: '', type: 'all', ratingStatus: 'all', anilistStatus: 'all', country: 'all', customLists: [], isGrouped: false },
    sort: 'title-asc', layout: 'table', showProgress: false, separateAiring: false, activeTab: 'dashboard', isLoading: false, error: null,
    filteredWorks: [{ id: 'synthetic_1', mediaId: 1, title: 'Synthetic work', type: 'anime', status: MediaListStatus.CURRENT,
      updatedAt: 1, currentScore: 8, progress: 3, episodes: 12, sectionScores: { story: 8 } }],
    stats: { totalCount: 1, averageScore: 8, completedCount: 0, droppedCount: 0, planningCount: 0, genreDistribution: {}, statusDistribution: {} },
  };
  let publish: ((next: IDashboardState) => void) | undefined;
  const patch = (next: Partial<IDashboardState>) => { state = { ...state, ...next }; publish?.(state); };
  const store = {
    ready: async () => {},
    getState: () => state,
    subscribe: (callback: typeof publish) => { publish = callback; callback?.(state); return () => { publish = undefined; }; },
    setTab: (activeTab: IDashboardState['activeTab']) => patch({ activeTab }),
    setSeparateAiring: (separateAiring: boolean) => patch({ separateAiring }),
    setSort: (sort: IDashboardState['sort']) => { calls.push(`sort:${sort}`); patch({ sort }); },
    setFilters: (filters: Partial<IDashboardState['filters']>) => { calls.push('filter'); patch({ filters: { ...state.filters, ...filters } }); },
    setSearch: (search: string) => { calls.push(`search:${search}`); },
  };
  const service = { init: async () => {}, getWorks: () => [], getSections: () => [{ id: 'story', name: 'Story', weight: 1 }],
    getAniListCustomLists: async () => ['Favorites', 'A very long custom list name that must not push search or filters outside the dashboard'],
 };
  const bus = new EventBus();
  const overlays = new AstraOverlayService();
  const filter = new AstraFilterBar(store as never, service as never, bus);
  const table = new AstraWorkTable(store as never, service as never, { open: async () => {} } as never);
  const dashboard = new AstraDashboard(store as never, service as never, bus, filter, table,
    { mount: () => {}, unmount: () => {} } as never, overlays);
  release = () => { dashboard.dispose(); overlays.dispose(); release = undefined; };
  await dashboard.open();
  await new Promise(requestAnimationFrame);
  await new Promise(resolve => setTimeout(resolve, 400));
}

export function measureAstraToolbar() {
  const root = document.querySelector<HTMLElement>('.astra-modal--dashboard')!;
  const left = root.querySelector<HTMLElement>('.astra-filter-toolbar-left')!;
  const right = root.querySelector<HTMLElement>('.astra-filter-toolbar-right')!;
  const toolbar = root.querySelector<HTMLElement>('.astra-filter-toolbar')!;
  const controls = [...root.querySelectorAll<HTMLElement>('.astra-filter-toolbar-left > .astra-toolbar-chip, .astra-search-box--toolbar, .astra-filter-toolbar-right [data-dropdown-trigger]')];
  const bounds = controls.map(control => {
    const box = control.getBoundingClientRect();
    return { label: control.textContent?.trim() || 'Search', x: box.x, y: box.y, width: box.width, height: box.height };
  });
  const area = toolbar.getBoundingClientRect();
  const singleRow = bounds.every(box => Math.abs(box.y - bounds[0].y) < 1);
  const overlap = bounds.some((a, i) => bounds.slice(i + 1).some(b =>
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1
    && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1));
  return { width: root.clientWidth, leftOverflow: left.scrollWidth - left.clientWidth,
    rightOverflow: right.scrollWidth - right.clientWidth, toolbarOverflow: toolbar.scrollWidth - toolbar.clientWidth,
    clippedControls: bounds.some(box => box.x < area.x - 1 || box.x + box.width > area.right + 1), overlap, singleRow, bounds,
    clip: { x: root.getBoundingClientRect().x, y: root.getBoundingClientRect().y,
      width: root.getBoundingClientRect().width, height: area.bottom - root.getBoundingClientRect().y + 28, scale: 1 } };
}

export async function verifyAstraToolbar(): Promise<string[]> {
  const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  const report = measureAstraToolbar();
  assert(report.leftOverflow <= 1 && report.rightOverflow <= 1 && report.toolbarOverflow <= 1
    && !report.clippedControls && !report.overlap, `Dashboard toolbar clipped or overlapping: ${JSON.stringify(report)}`);
  if (innerWidth >= 1440) assert(report.singleRow, 'Desktop must retain the original single toolbar row');
  const root = () => document.querySelector<HTMLElement>('.astra-modal--dashboard')!;
  const input = root().querySelector<HTMLInputElement>('#astra-search')!;
  input.value = 'Synthetic'; input.dispatchEvent(new Event('input', { bubbles: true }));
  assert(calls.includes('search:Synthetic'), 'Search must retain its original handler');
  assert(!root().querySelector('[data-sort-dropdown]'), 'Toolbar must not duplicate column sorting');
  const divider = root().querySelector<HTMLElement>('.astra-toolbar-separator')!;
  assert(divider.getBoundingClientRect().width === 1 && divider.getBoundingClientRect().height > 0,
    'The original plain divider must remain visible');
  root().querySelector<HTMLElement>('[data-sort-key="title"]')!.click();
  assert(calls.includes('sort:title-desc'), 'Title column must sort descending');
  root().querySelector<HTMLElement>('[data-sort-key="title"]')!.click();
  assert(calls.includes('sort:title-asc'), 'Title column must toggle back to ascending');
  const listDropdown = root().querySelector('[data-filter-field="customList"]')!.closest('[data-toolbar-dropdown]')!;
  listDropdown.querySelector<HTMLButtonElement>('[data-dropdown-trigger]')!.click();
  await new Promise(resolve => setTimeout(resolve, 250));
  const item = root().querySelector<HTMLElement>('[data-filter-value="Favorites"]')!;
  const box = item.getBoundingClientRect();
  assert(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('[data-filter-value]') === item,
    'Open list menu must stay visible and clickable outside the toolbar');
  root().querySelector<HTMLButtonElement>('[data-filter-value^="A very long"]')!.click();
  const selected = measureAstraToolbar();
  assert(selected.leftOverflow <= 1 && selected.rightOverflow <= 1 && selected.toolbarOverflow <= 1
    && !selected.clippedControls && !selected.overlap, `Selected long list labels must not break the layout: ${JSON.stringify(selected)}`);
  if (innerWidth >= 1440) assert(selected.singleRow, 'Selected list labels must preserve the single desktop row');
  root().querySelector<HTMLButtonElement>('[data-quick-filter="watching"]')!.click();
  assert(calls.includes('filter'), 'Quick filters must retain their original handlers');
  return ['toolbar controls remain visible without horizontal scrolling or overlap',
    'plain divider, column sorting, search, quick filters and dropdown hit testing remain operational'];
}

export function disposeAstraToolbar(): void { release?.(); }
