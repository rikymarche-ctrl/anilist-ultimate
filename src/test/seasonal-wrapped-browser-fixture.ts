import 'reflect-metadata';
import '@/styles/main.css';
import '@/styles/astra.css';
import '@/styles/astra-wrapped.css';
import '@core/ui/Icons';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MediaListStatus } from '@/api/AnilistTypes';
import { AstraRepository } from '@modules/astra/store/AstraRepository';
import { AstraService } from '@modules/astra/AstraService';
import { AstraDashboard } from '@modules/astra/ui/AstraDashboard';
import { AstraOverlayService } from '@modules/astra/services/AstraOverlayService';
import { SeasonalWrappedService } from '@modules/astra/services/SeasonalWrappedService';
import { SeasonalWrappedView } from '@modules/astra/ui/SeasonalWrappedView';
import { buildSeasonalReport, emptySeasonalChoices, type SeasonalEntry } from '@modules/astra/services/SeasonalWrappedModel';
import { drawSeasonalImage } from '@modules/astra/ui/SeasonalWrappedImage';
import { seasonalEntry, seasonalResponse, seasonalWork } from './seasonal-wrapped-fixtures';
import type { IDashboardState } from '@modules/astra/interfaces/IDashboardState';
import type { IStorageService } from '@core/interfaces/IStorageService';

let release: (() => void) | undefined;
let dashboard: AstraDashboard;
let bus: EventBus;
let repository: AstraRepository;
let service: SeasonalWrappedService;
let entries: SeasonalEntry[];
const pause = () => new Promise(resolve => setTimeout(resolve, 50));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
async function until(test: () => boolean, message: string) { for (let i = 0; i < 60; i++) { if (test()) return; await pause(); } throw new Error(message); }
const root = () => document.querySelector<HTMLElement>('.seasonal-wrapped')!;
/** Brings the story slide holding `selector` on screen (inactive slides are inert) and returns the element. */
function show<T extends HTMLElement>(selector: string): T {
  const element = root().querySelector<T>(selector)!;
  const index = [...root().querySelectorAll('.aw-slide')].indexOf(element.closest('.aw-slide')!);
  root().querySelector<HTMLButtonElement>(`[data-goto="${index}"]`)!.click();
  return element;
}
function selectSpring() {
  const year = root().querySelector<HTMLInputElement>('[name="year"]')!; year.value = '2026';
  const season = root().querySelector<HTMLSelectElement>('[name="season"]')!; season.value = 'SPRING'; season.dispatchEvent(new Event('change'));
}
export async function mountSeasonal(): Promise<void> {
  release?.(); document.body.replaceChildren();
  const namespace = `seasonal_fixture_${crypto.randomUUID()}_`;
  const storage = {
    get: async (key: string) => (await chrome.storage.local.get(namespace + key))[namespace + key] ?? null,
    set: async (key: string, value: unknown) => { await chrome.storage.local.set({ [namespace + key]: value }); return true; },
    setMultiple: async (values: Record<string, unknown>) => { await chrome.storage.local.set(Object.fromEntries(Object.entries(values).map(([key, value]) => [namespace + key, value]))); return true; },
    remove: async (key: string) => { await chrome.storage.local.remove(namespace + key); return true; },
  } as IStorageService;
  entries = [seasonalEntry({ title: 'The quiet art of starting over', score: 9.3 }),
    seasonalEntry({ mediaId: 2, title: 'A winter story, a spring ending', origin: { year: 2026, season: 'WINTER' }, score: 8.8 }),
    seasonalEntry({ mediaId: 3, title: 'Beyond the last horizon', endDate: { year: 2026, month: 9, day: 26 }, score: 9.9 }),
    seasonalEntry({ mediaId: 4, title: 'The overlooked discovery', startedAt: null, completedAt: null, score: 8.2 }),
    seasonalEntry({ mediaId: 5, title: 'Private title', private: true }),
    seasonalEntry({ mediaId: 6, title: 'A promise left behind', status: MediaListStatus.DROPPED, score: 4 }),
    seasonalEntry({ mediaId: 7, title: 'An older adventure', origin: { year: 2025, season: 'FALL' }, endDate: { year: 2025, month: 12, day: 23 } }),
    seasonalEntry({ mediaId: 8, title: 'Summer catch-up', startedAt: { year: 2026, month: 8, day: 1 }, completedAt: null }),
    seasonalEntry({ mediaId: 9, title: 'An ending still unknown', endDate: null }),
    seasonalEntry({ mediaId: 10, title: 'One more episode to go', status: MediaListStatus.CURRENT, score: 7.5 }),
    seasonalEntry({ mediaId: 11, title: 'The season of little things', score: 8.5 })];
  bus = new EventBus(); repository = new AstraRepository(bus, storage); repository.setOwner(42); await repository.init();
  await repository.saveWork(seasonalWork({ seasons: [{ scores: { story: 9.4 } }] }));
  const api = { getContext: () => ({ userId: 42, sessionId: 'fixture' }), ensureContext: async () => ({ userId: 42, sessionId: 'fixture' }),
    getCurrentUserId: async () => 42, isAuthenticated: () => true, query: async () => seasonalResponse(entries) };
  const astra = new AstraService(bus, api as never, repository, {} as never, {} as never, {} as never);
  service = new SeasonalWrappedService(astra, api as never);
  const state: IDashboardState = { filters: { search: '', type: 'all', ratingStatus: 'all', anilistStatus: 'all', country: 'all', customLists: [], isGrouped: false },
    sort: 'title-asc', activeTab: 'dashboard', layout: 'table', showProgress: false, separateAiring: false, isLoading: false, error: null, filteredWorks: [],
    stats: { totalCount: 1, averageScore: 9, completedCount: 1, droppedCount: 0, planningCount: 0, genreDistribution: {}, statusDistribution: {} } };
  let publish: ((value: IDashboardState) => void) | undefined;
  const store = { getState: () => state, subscribe: (callback: typeof publish) => { publish = callback; callback?.(state); return () => { publish = undefined; }; },
    setTab: (tab: IDashboardState['activeTab']) => { state.activeTab = tab; publish?.(state); } };
  const component = () => ({ mount: () => {}, unmount: () => {}, update: () => {}, prepareAiringData: async () => {} });
  const overlay = new AstraOverlayService();
  dashboard = new AstraDashboard(store as never, astra, bus, component() as never, component() as never, component() as never, overlay, service);
  release = () => { dashboard.dispose(); astra.dispose(); overlay.dispose(); release = undefined; };
  await dashboard.open();
  await until(() => !!document.querySelector('[data-open-released-seasonal]'), 'A released Seasonal Wrapped must be announced on the dashboard');
  assert(!document.querySelector('.seasonal-wrapped'), 'Opening Astra must not take over the dashboard');
  document.querySelector<HTMLElement>('[data-tab="recaps"]')!.click();
  await until(() => !!document.querySelector('[data-open-seasonal]'), 'Wrapped library must be reachable by choice');
  document.querySelector<HTMLButtonElement>('[data-open-seasonal]')!.click();
  await until(() => !!root()?.querySelector('.seasonal-hero'), 'Seasonal Wrapped must open when selected'); selectSpring();
  await new Promise(requestAnimationFrame);
}

export async function verifySeasonal(): Promise<string[]> {
  const report: string[] = [];
  assert(root().scrollWidth <= root().clientWidth + 1, 'Seasonal Wrapped must not scroll horizontally');
  const bounds = root().getBoundingClientRect(); assert(bounds.left >= 0 && bounds.right <= innerWidth + 1, 'Recap must stay inside the viewport');
  assert(root().textContent!.includes('Leftover from Winter 2026'), 'The concluded winter leftover must appear in spring');
  assert(!root().querySelector('.seasonal-podium')!.textContent!.includes('Beyond the last horizon'), 'A future leftover must not enter the earlier ranking');
  assert(root().querySelector('[data-seasonal-continuing]')!.textContent!.includes('Beyond the last horizon'), 'The continuing series must appear separately');
  assert(!root().querySelector('[data-seasonal-results]')!.textContent!.includes('Private title'), 'Private titles must start excluded');
  assert(!root().textContent!.includes('Summer catch-up') && !root().textContent!.includes('An older adventure'), 'Backlog viewing must not enter the recap');
  report.push('passive seasonal release announcement, explicit opening, responsive geometry, concluded leftovers, future leftovers and recovery exclusion');
  const favorite = show<HTMLSelectElement>('[data-award="favorite"]'); favorite.value = '1'; favorite.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => root().querySelector('[data-seasonal-status]')!.textContent === 'Personal picks saved to Astra.', 'Award must save');
  assert(root().querySelector('.aw-slide.is-active [data-award="favorite"]'), 'Saving a pick must keep the awards slide on screen');
  const backup = JSON.parse(await repository.exportJSON()); assert(backup.seasonalWrapped['2026-SPRING'].awards.favorite === 1, 'Award must reach native Chrome storage and backup');
  const confirm = show<HTMLInputElement>('[data-confirm="4"]'); confirm.click();
  await until(() => !!root().querySelector('[data-unconfirm="4"]'), 'Participation confirmation must move the title into the recap');
  show<HTMLButtonElement>('[data-unconfirm="4"]').click(); await until(() => !!root().querySelector('[data-confirm="4"]'), 'Participation confirmation must be reversible');
  report.push('manual award in real repository/native Chrome storage/backup and reversible participation');
  root().querySelector<HTMLButtonElement>('[data-seasonal-back]')!.click();
  document.querySelector<HTMLButtonElement>('[data-open-seasonal]')!.click(); await until(() => !!root()?.querySelector('.seasonal-hero'), 'Reopen must load'); selectSpring();
  assert(root().querySelector<HTMLSelectElement>('[data-award="favorite"]')!.value === '1', 'Reopen must restore the saved award');
  let download: Promise<ImageBitmap> | undefined;
  const listener = (event: Event) => { const anchor = event.target as HTMLAnchorElement;
    if (anchor.tagName === 'A' && anchor.download) { assert(anchor.download === 'astra-seasonal-2026-spring.png', 'Export filename must identify the season');
      download = fetch(anchor.href).then(response => response.blob()).then(blob => createImageBitmap(blob)); } };
  document.addEventListener('click', listener, true);
  try {
    root().querySelector<HTMLButtonElement>('[data-seasonal-export]')!.click(); await until(() => !!download, 'PNG button must trigger the download');
    const bitmap = await download!; assert(bitmap.width === 1080 && bitmap.height === 1920, 'PNG must decode to 1080 × 1920'); bitmap.close();
  } finally { document.removeEventListener('click', listener, true); }
  report.push('saved award after reopen and real PNG button with image decoding');
  bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() }); assert(!root(), 'Account changes must clear the seasonal recap');
  // A detached load must not revive the old account view.
  let finish!: () => void;
  const late = new SeasonalWrappedView({ load: async () => { await new Promise<void>(yes => { finish = yes; }); return service.load(() => true); } } as never, () => {});
  late.mount(document.body); late.unmount(); finish(); await pause(); assert(!root(), 'Late completion must not remount');
  report.push('account cleanup and retired asynchronous load'); return report;
}

export function seasonalArtwork(): string {
  const report = buildSeasonalReport(entries, [seasonalWork()], { year: 2026, season: 'SPRING' },
    { ...emptySeasonalChoices(), awards: { favorite: 1, surprise: 2, disappointment: 6, discovery: 11 } }, () => 9.4, false, new Date('2026-10-19T12:00:00'));
  return drawSeasonalImage(report).toDataURL('image/png').split(',')[1];
}
export function disposeSeasonal(): void { release?.(); }
