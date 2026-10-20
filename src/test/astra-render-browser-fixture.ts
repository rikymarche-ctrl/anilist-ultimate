/** Synthetic native-DOM measurements of the current production rating view. */
import 'reflect-metadata';
import '@/styles/astra.css';
import { AstraRatingModal } from '@modules/astra/ui/AstraRatingModal';
import { AstraOverlayService } from '@modules/astra/services/AstraOverlayService';
import { ratingInitialResponse } from '@modules/astra/services/AstraRatingResponse';
import { EventBus } from '@core/events/EventBus';
import type { AstraService } from '@modules/astra/AstraService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ToastService } from '@core/services/ToastService';
import type { IAstraRatingService } from '@modules/astra/interfaces/IAstraRatingService';
import type { AstraEpisodeNote } from '@modules/astra/AstraInterfaces';
import { ratingResponse } from './astra-rating-fixtures';

function setup(count: number) {
  const context = { sessionId: 'synthetic-render-benchmark', userId: 42 };
  const api = { getCurrentUserId: async () => 42, ensureContext: async () => ({ ...context }), getContext: () => ({ ...context }) };
  const astra = { getFullWork: async () => undefined, getWorks: () => [], getSettings: () => ({ enableSeriesFinale: false }),
    hasFinaleSection: () => false, getSections: () => [{ id: 'story', name: 'Story', weight: 1 }],
    calcSectionScore: () => 8, calcSeasonScore: () => 8 };
  const feedback: string[] = [];
  const rating = { getMediaRatingData: async (id: number) => {
    const raw = ratingResponse(id); raw.Media.episodes = count; raw.Media.nextAiringEpisode.episode = Math.min(2147483647, count + 1);
    raw.Media.coverImage.large = ''; return ratingInitialResponse(raw, id, 42);
  }, saveAndSync: async () => 'local' as const };
  const modal = new AstraRatingModal(astra as unknown as AstraService, api as IApiClient, new EventBus(),
    { error: (message: string) => feedback.push(message), info: () => {} } as unknown as ToastService,
    rating as unknown as IAstraRatingService, new AstraOverlayService());
  // Inspection of private resource counts is confined to this synthetic fixture.
  const internals = modal as unknown as {
    viewScope: { listeners: unknown[] } | null;
    journalScope: { listeners: unknown[] } | null;
    journalPageIndex: number;
    renderEpisodeJournal(): void;
    renderEpisodeList(progress: number, total: number | null, notes: Record<number, AstraEpisodeNote>, aired: number | null): string;
  };
  return { modal, internals, feedback };
}

export async function measureAstraRender(count: number, refreshes = 0) {
  const f = setup(count);
  const beforeNodes = document.querySelectorAll('*').length;
  let heartbeatDelayMs = 0;
  const heartbeatStarted = performance.now();
  const heartbeat = new Promise<void>(resolve => setTimeout(() => { heartbeatDelayMs = performance.now() - heartbeatStarted; resolve(); }, 0));
  const started = performance.now();
  try {
    await f.modal.open(1);
    const openMs = performance.now() - started;
    const overlay = document.querySelector('.astra-modal-overlay');
    if (!overlay || f.feedback.length) throw new Error('Synthetic modal did not mount');
    const rows = overlay.querySelectorAll('.astra-ep-row').length;
    const addedNodes = document.querySelectorAll('*').length - beforeNodes;
    const journalHidden = !overlay.querySelector('#astra-tab-journal')?.classList.contains('astra-tab-content--active');
    const scope = f.internals.viewScope;
    const journalScopes = new Set<{ listeners: unknown[] }>();
    if (f.internals.journalScope) journalScopes.add(f.internals.journalScope);
    const listenersAfterOpen = scope?.listeners.length ?? null;
    const journalListenersAfterOpen = f.internals.journalScope?.listeners.length ?? 0;
    const refreshStarted = performance.now();
    for (let i = 0; i < refreshes; i++) {
      f.internals.renderEpisodeJournal();
      if (f.internals.journalScope) journalScopes.add(f.internals.journalScope);
    }
    const refreshMs = performance.now() - refreshStarted;
    const listenersAfterRefresh = scope?.listeners.length ?? null;
    const journalListenersAfterRefresh = [...journalScopes].reduce((sum, journalScope) => sum + journalScope.listeners.length, 0);
    await heartbeat;
    const disposeStarted = performance.now(); f.modal.dispose();
    const disposeMs = performance.now() - disposeStarted;
    return { requestedCount: count, rows, journalHidden, addedNodes, openMs, heartbeatDelayMs, refreshes, refreshMs,
      listenersAfterOpen, listenersAfterRefresh, listenersAfterDispose: scope?.listeners.length ?? null, disposeMs,
      journalListenersAfterOpen, journalListenersAfterRefresh,
      journalListenersAfterDispose: [...journalScopes].reduce((sum, journalScope) => sum + journalScope.listeners.length, 0),
      residualNodes: document.querySelectorAll('*').length - beforeNodes };
  } finally { f.modal.dispose(); }
}

export function inspectAstraSparseNotes() {
  const f = setup(12);
  try {
    const html = f.internals.renderEpisodeList(3, null, { 120: { text: 'Synthetic sparse saved note' } }, null);
    const root = document.createElement('div'); root.innerHTML = html;
    f.internals.journalPageIndex = 1;
    const laterPage = document.createElement('div');
    laterPage.innerHTML = f.internals.renderEpisodeList(3, null, { 120: { text: 'Synthetic sparse saved note' } }, null);
    const raw = ratingResponse(); raw.Media.episodes = 2147483647;
    const validMaxInt = ratingInitialResponse(raw, 1, 42)?.media.episodes === 2147483647;
    return { validMaxInt, rows: root.querySelectorAll('.astra-ep-row').length,
      sparseNoteReachable: !!laterPage.querySelector('textarea[data-ep="120"]') };
  } finally { f.modal.dispose(); }
}
