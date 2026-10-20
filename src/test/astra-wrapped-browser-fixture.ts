import 'reflect-metadata';
import '@/styles/main.css';
import '@/styles/astra.css';
import '@/styles/astra-wrapped.css';
import '@/styles/astra-wrapped-year.css';
import '@/styles/astra-wrapped-hub.css';
import '@core/ui/Icons';
import { AstraDashboard } from '@modules/astra/ui/AstraDashboard';
import { AstraOverlayService } from '@modules/astra/services/AstraOverlayService';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { AstraWork } from '@modules/astra/AstraInterfaces';
import type { IDashboardState } from '@modules/astra/interfaces/IDashboardState';
import { DEFAULT_SECTIONS, DEFAULT_SETTINGS } from '@modules/astra/utils/AstraConstants';
import { drawWrappedImage } from '@modules/astra/ui/AstraWrappedImage';
import { buildYearReview } from '@modules/astra/services/year/YearReview';
import { PRIVATE_TITLE, yearReviewData } from './year-review-fixtures';

let release: (() => void) | undefined;
let bus: EventBus;
let works: AstraWork[];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 50));

export async function mountWrapped(): Promise<void> {
  release?.(); document.body.replaceChildren();
  const now = new Date(); now.setHours(0, 0, 0, 0);
  works = ['Frieren: Beyond Journey’s End', 'Witch Hat Atelier', 'The Apothecary Diaries', '<img src=x onerror=alert(1)> A very long title '.repeat(5), 'Private title'].map((title, i) => ({
    id: `work_${i}`, ownerId: 42, mediaId: i + 1, title, type: i % 3 === 0 ? 'anime' : i % 3 === 1 ? 'manga' : 'novel',
    status: MediaListStatus.CURRENT, customLists: [], tags: [], notes: 'Never share these notes', updatedAt: 1,
    genres: i % 2 ? ['Fantasy', 'Adventure'] : ['Drama', 'Fantasy'], duration: 24, isPrivate: i === 4,
    seasons: [{ scores: { story: 8 }, episodeNotes: Object.fromEntries(Array.from({ length: 12 + i }, (_, unit) => [unit + 1,
      { text: 'Secret journal note', timestamp: now.getTime() - (unit % 8) * 86400000 }])) }],
  }));
  let state: IDashboardState = { filters: { search: '', type: 'all', ratingStatus: 'all', anilistStatus: 'all', country: 'all', customLists: [], isGrouped: false },
    sort: 'title-asc', layout: 'table', showProgress: false, separateAiring: false, activeTab: 'dashboard', isLoading: false, error: null, filteredWorks: [],
    stats: { totalCount: 5, averageScore: 8, completedCount: 0, droppedCount: 0, planningCount: 0, genreDistribution: {}, statusDistribution: {} } };
  let publish: ((state: IDashboardState) => void) | undefined;
  const store = { getState: () => state, subscribe: (callback: typeof publish) => { publish = callback; callback?.(state); return () => { publish = undefined; }; },
    setTab: (activeTab: IDashboardState['activeTab']) => { state = { ...state, activeTab }; publish?.(state); } };
  const service = { init: async () => {}, calcSeriesOverall: () => 8, exportJSON: async () => JSON.stringify({ schemaVersion: 1,
    manifest: works.map(({ mediaId }) => ({ mediaId })), works: Object.fromEntries(works.map(work => [work.mediaId, work])), sections: DEFAULT_SECTIONS, settings: DEFAULT_SETTINGS }) };
  bus = new EventBus(); const overlay = new AstraOverlayService();
  const component = () => ({ mount: () => {}, unmount: () => {}, update: () => {}, prepareAiringData: async () => {} });
  const years = { load: async (_period: unknown, _current: () => boolean, progress: (step: string) => void) => { progress('Reading your activity'); return yearReviewData(); } };
  const dashboard = new AstraDashboard(store as never, service as never, bus, component() as never, component() as never, component() as never, overlay, undefined, years as never);
  release = () => { dashboard.dispose(); overlay.dispose(); release = undefined; };
  await dashboard.open();
  document.querySelector<HTMLElement>('[data-tab="recaps"]')!.click(); await pause();
  document.querySelector<HTMLButtonElement>('[data-open-astra-wrapped]')!.click(); await pause();
}

export async function verifyWrapped(): Promise<string[]> {
  const root = document.querySelector<HTMLElement>('.astra-wrapped')!;
  assert(root && root.clientHeight > 100, 'Wrapped must mount from its dashboard action');
  assert(root.scrollWidth <= root.clientWidth + 1, 'Wrapped must fit the viewport without horizontal scrolling');
  const bounds = root.getBoundingClientRect();
  assert(bounds.left >= 0 && bounds.right <= innerWidth + 1, 'Wrapped must stay inside the browser viewport');
  assert(!root.querySelector('img'), 'Titles must remain escaped text');
  assert(!root.textContent!.includes(PRIVATE_TITLE) && !root.textContent!.includes('Secret journal note'), 'Private titles and journal notes must be excluded');
  assert(root.querySelector('[data-wrapped-titles]')!.children.length === 5, 'The top anime slide must list five titles');
  assert(root.querySelector('[data-wrapped-characters]')!.children.length === 3, 'The cast slide must show three characters');
  const active = () => [...root.querySelectorAll('.aw-slide')].findIndex(slide => slide.classList.contains('is-active'));
  const slideCount = root.querySelectorAll('.aw-slide').length;
  assert(slideCount >= 18 && active() === 0, 'The recap must open as a story on its intro slide');
  root.querySelector<HTMLButtonElement>('.aw-nav [data-story-next]')!.click();
  assert(active() === 1, 'Next must advance the story');
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert(active() === slideCount - 1 && root.querySelector('.aw-slide.is-active [data-wrapped-download]'), 'End must reach the summary with its download action');
  root.querySelector<HTMLButtonElement>('.aw-slide.is-active [data-story-restart]')!.click();
  assert(active() === 0, 'Watch again must restart the story');
  // Autoplay is driven by the CSS fill of the active progress segment: shorten it and let real Chrome run it.
  const story = root.querySelector<HTMLElement>('.aw-story')!;
  story.style.setProperty('--aw-slide-duration', '0.25s');
  root.querySelector<HTMLButtonElement>('.aw-slide.is-active [data-story-play]')!.click();
  assert(story.classList.contains('is-playing') && active() === 1, 'The intro call to action must start autoplay');
  for (let attempt = 0; attempt < 40 && active() < 3; attempt++) await pause();
  assert(active() >= 3, 'Autoplay must advance through the story');
  root.querySelector<HTMLButtonElement>('[data-story-toggle]')!.click();
  assert(!story.classList.contains('is-playing'), 'The pause control must stop autoplay');
  const stopped = active(); await pause(); await pause();
  assert(active() === stopped, 'A paused story must stay on its slide');
  story.style.removeProperty('--aw-slide-duration');
  root.querySelector<HTMLButtonElement>('[data-goto="0"]')!.click();
  for (const slide of root.querySelectorAll<HTMLElement>('.aw-slide')) {
    assert(slide.scrollWidth <= slide.clientWidth + 1, `Slide "${slide.getAttribute('aria-label')}" must not scroll horizontally`);
  }
  const privateInput = root.querySelector<HTMLInputElement>('[name="private"]')!;
  privateInput.checked = true; privateInput.dispatchEvent(new Event('change'));
  assert(root.textContent!.includes(PRIVATE_TITLE), 'Explicit private inclusion must update the recap');
  privateInput.checked = false; privateInput.dispatchEvent(new Event('change'));
  const end = root.querySelector<HTMLInputElement>('[name="end"]')!;
  const previousEnd = end.value; end.value = '2000-01-01'; end.dispatchEvent(new Event('change'));
  assert(root.querySelector<HTMLButtonElement>('[data-wrapped-export]')!.disabled, 'Invalid dates must disable export');
  end.value = previousEnd; end.dispatchEvent(new Event('change'));
  root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await pause();
  assert(!root.querySelector<HTMLButtonElement>('[data-wrapped-export]')!.disabled, 'Update recap must restore export');
  let downloaded: { filename: string; image: Promise<ImageBitmap> } | undefined;
  const onDownload = (event: Event) => {
    const anchor = event.target as HTMLAnchorElement;
    if (anchor.tagName === 'A' && anchor.download) downloaded = { filename: anchor.download,
      image: fetch(anchor.href).then(response => response.blob()).then(blob => createImageBitmap(blob)) };
  };
  document.addEventListener('click', onDownload, true);
  try {
    root.querySelector<HTMLButtonElement>('[data-wrapped-export]')!.click();
    for (let attempt = 0; attempt < 40 && !downloaded; attempt++) await pause();
    assert(downloaded?.filename.endsWith('.png'), 'The actual export button must trigger a PNG download');
    const bitmap = await downloaded!.image; assert(bitmap.width === 1080 && bitmap.height === 1920, 'PNG dimensions must be 1080 × 1920'); bitmap.close();
  } finally { document.removeEventListener('click', onDownload, true); }
  root.querySelector<HTMLButtonElement>('[data-wrapped-back]')!.click();
  assert(!!document.querySelector('[data-open-astra-wrapped]'), 'Back must restore the Wrapped library');
  document.querySelector<HTMLButtonElement>('[data-open-astra-wrapped]')!.click(); await pause();
  bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
  assert(!document.querySelector('.astra-wrapped'), 'Account changes must clear the recap');
  return ['dashboard entry and back', 'responsive geometry', 'safe title and note handling', 'story navigation, keyboard, restart and autoplay', 'private inclusion', 'date validation', 'actual PNG button and decoded image', 'account-change cleanup'];
}

export function wrappedArtwork(): string {
  const data = yearReviewData();
  return drawWrappedImage(buildYearReview(data.input, { local: data.local })).toDataURL('image/png').split(',')[1];
}
export function disposeWrapped(): void { release?.(); }
