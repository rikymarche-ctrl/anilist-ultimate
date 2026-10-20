/** Real Quick Edit and media-button delegation over a deliberately slow synthetic provider. */
import 'reflect-metadata';
import '@/styles/main.css';
import '@/styles/astra.css';
import { AstraRatingModal } from '@modules/astra/ui/AstraRatingModal';
import { AstraRatingService } from '@modules/astra/services/AstraRatingService';
import { AstraNavigationService } from '@modules/astra/services/AstraNavigationService';
import { AstraOverlayService } from '@modules/astra/services/AstraOverlayService';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { ratingResponse } from './astra-rating-fixtures';

const assert = (value: boolean, message: string) => { if (!value) throw new Error(message); };
const until = async (predicate: () => boolean) => {
  const deadline = performance.now() + 4000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Quick Edit fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
const bus = new EventBus();
const context = { userId: 42, sessionId: 'opening-fixture' };
let reads = 0; let localReads = 0; const errors: unknown[] = [];
let release: (() => void) | undefined;
let waitForProvider = new Promise<void>(resolve => { release = resolve; });
const api = { getContext: () => ({ ...context }), ensureContext: async () => ({ ...context }),
  query: async (_query: string, variables: { id: number }) => {
    reads++; await waitForProvider;
    const response = ratingResponse(variables.id); response.Media.title.userPreferred = `Work ${variables.id}`;
    if (variables.id === 9) Object.assign(response.Media, { type: 'MANGA', format: 'MANGA', chapters: 20, episodes: null, nextAiringEpisode: null });
    return response;
  } };
const astra = { getFullWork: async () => { localReads++; return undefined; }, getWorks: () => [],
  getSettings: () => ({ enableSeriesFinale: false }), hasFinaleSection: () => false,
  getSections: () => [{ id: 'story', name: 'Story', weight: 1 }], calcSectionScore: () => 8, calcSeasonScore: () => 8 };
const rating = new AstraRatingService(astra as never, api as never,
  { getSnapshot: async () => ({ revision: 'stable', entries: [] }) } as never, {} as never);
const overlays = new AstraOverlayService();
const modal = new AstraRatingModal(astra as never, api as never, bus, { error: (error: unknown) => errors.push(error), info: () => {} } as never, rating, overlays);
const navigation = new AstraNavigationService({} as never);

export async function prepareQuickEditOpening(): Promise<void> {
  history.replaceState({}, '', '/anime/7/title');
  document.body.innerHTML = '<main class="actions"><button class="list">Edit entry</button></main>';
  navigation.hijackMediaButton(id => modal.open(id));
  document.querySelector<HTMLButtonElement>('.list')!.click();
  const loading = document.querySelector<HTMLElement>('.astra-rating-loading');
  assert(!!loading && loading.getBoundingClientRect().width > 0, 'Quick Edit window must mount before the provider resolves');
  assert(getComputedStyle(loading!).display === 'flex' && !!loading!.querySelector('[role="status"]'), 'loading window must be visible and announce its state');
  await until(() => reads === 1 && localReads === 1);
  document.querySelector<HTMLButtonElement>('.list')!.click();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(reads === 1, 'repeat clicks must share the pending provider request');
}

export async function completeQuickEditOpening(): Promise<string[]> {
  const checks = ['Quick Edit mounts visibly before slow provider data; local work loads concurrently; repeat clicks share one request'];
  try {
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close Quick Edit"]')!;
    assert(document.activeElement === close, 'the loading window must focus its close action');
    close.click();
    assert(!document.querySelector('.astra-modal-overlay') && document.body.style.overflow !== 'hidden', 'cancel must release UI and scroll lock');
    checks.push('native close cancels pending opening and restores scrolling');
    release!(); waitForProvider = Promise.resolve();
    for (const [type, id] of [['anime', 8], ['manga', 9], ['anime', 10]] as const) {
      const previousPath = location.pathname;
      history.replaceState({}, '', `/${type}/${id}/title`);
      bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: location.pathname, previousPath, timestamp: new Date() });
      document.querySelector('.actions')!.innerHTML = '<button class="list"><svg><path></path></svg></button>';
      document.querySelector('path')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await until(() => document.querySelector('.astra-header-title')?.textContent?.includes(`Work ${id}`) === true);
      assert(document.querySelectorAll('.astra-modal-overlay').length === 1, 'only the current work may open after navigation');
    }
    checks.push('replaced buttons and SVG targets open the current work through repeated anime/manga navigation without rescanning');
    assert(errors.length === 0, 'opening must not produce errors');
    return checks;
  } finally { navigation.dispose(); modal.dispose(); overlays.dispose(); }
}
