import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../AstraService', () => ({ AstraService: class {} }));
vi.mock('./AstraDashboard', () => ({ AstraDashboard: class {} }));
import { AstraRatingModal } from './AstraRatingModal';
import { AstraOverlayService } from '../services/AstraOverlayService';
import { AstraRatingState } from './AstraRatingState';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { AstraWork } from '../AstraInterfaces';
import { ratingResponse } from '@/test/astra-rating-fixtures';
import { ratingInitialResponse } from '../services/AstraRatingResponse';
import { DEFAULT_SECTIONS, DEFAULT_SETTINGS } from '../utils/AstraConstants';
import type { AstraService } from '../AstraService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { ToastService } from '@core/services/ToastService';
import type {
  IAstraRatingService,
  AstraSaveOptions,
  AstraSaveResult,
  AstraRatingMedia,
  IRatingInitialData,
} from '../interfaces/IAstraRatingService';

/** Access only the controller seams exercised by these isolated persistence tests. */
interface ModalTestAccess {
  save(): Promise<void>;
  render(media: AstraRatingMedia | null, lists: string[]): void;
  state: AstraRatingState;
  reloadAfterClose: boolean;
  needsListStatus: boolean;
  reloadHost(): void;
  renderDateField(id: string, label: string, iso: string): string;
}
const inspect = (modal: AstraRatingModal): ModalTestAccess => modal as unknown as ModalTestAccess;

function setup() {
  const astra = {
    calcSeasonScore: () => 8,
    getFullWork: vi.fn(async () => undefined),
    getWorks: () => [],
  };
  const api = { getCurrentUserId: vi.fn(async () => 42) };
  const bus = { emit: vi.fn() };
  const toast = { error: vi.fn(), info: vi.fn() };
  const rating = {
    saveAndSync: vi.fn(
      async (_work: AstraWork, _extra: AstraSaveOptions): Promise<AstraSaveResult> => 'synced'
    ),
    getMediaRatingData: vi.fn(async () => ratingInitialResponse(ratingResponse(), 1, 42)!),
  };
  const modal = new AstraRatingModal(
    astra as unknown as AstraService,
    api as unknown as IApiClient,
    bus as unknown as IEventBus,
    toast as unknown as ToastService,
    rating as unknown as IAstraRatingService,
    new AstraOverlayService()
  );
  const state = new AstraRatingState({
    id: 'work_1',
    title: 'Synthetic work',
    type: 'anime',
    updatedAt: 100,
    mediaId: 1,
    status: MediaListStatus.COMPLETED,
    notes: '',
    seasons: [
      {
        id: 'season_1',
        name: 'Season 1',
        scores: {},
        notes: 'New note',
        episodeNotes: { 3: { text: 'Watched', score: 9, timestamp: 123 } },
      },
    ],
    tags: [],
    customLists: [],
    progress: 2,
  });
  state.isDirty = true;
  const overlay = document.createElement('div');
  overlay.innerHTML =
    '<input id="astra-progress" value="2"><textarea id="astra-general-notes">New note</textarea><div class="astra-ep-date-picker" data-ep="3" data-timestamp="0"></div>';
  document.body.appendChild(overlay);
  Object.assign(modal, { overlay, state, initialProgress: 1 });
  return { modal, state, overlay, rating, toast, api };
}

describe('AstraRatingModal save lifecycle without visual changes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chrome.runtime.id = 'test';
    document.body.innerHTML = '';
    // Constructor resize callbacks are irrelevant to these isolated save tests.
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps the modal and unsaved edits open when persistence fails', async () => {
    const { modal, state, overlay, rating, toast } = setup();
    rating.saveAndSync.mockRejectedValue(new Error('Storage failed'));
    await modal.close();
    expect(overlay.isConnected).toBe(true);
    expect(overlay.classList.contains('astra-modal-overlay--closing')).toBe(false);
    expect(state.isDirty).toBe(true);
    expect(toast.error).toHaveBeenCalled();
  });

  it('uses durable sync and retains watch history when progress is reduced', async () => {
    const { modal, state, rating } = setup();
    await inspect(modal).save();
    expect(rating.saveAndSync.mock.calls[0][0].seasons[0].episodeNotes![3]).toEqual({
      text: 'Watched',
      score: 9,
      timestamp: 123,
    });
    expect(rating.saveAndSync.mock.calls[0][1]).toMatchObject({ progress: 2, overallScore: 8 });
    expect(rating.saveAndSync.mock.calls[0][1]).not.toHaveProperty('notes');
    expect(rating.saveAndSync.mock.calls[0][1]).toMatchObject({ replaceNotes: false });
    expect(state.isDirty).toBe(false);
  });

  it('includes edited general notes in the synchronized snapshot', async () => {
    const { modal, overlay, rating } = setup();
    const textarea = overlay.querySelector<HTMLTextAreaElement>('#astra-general-notes')!;
    textarea.value = 'An explicit note edit';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await inspect(modal).save();
    expect(rating.saveAndSync.mock.calls[0][1].notes).toBe('An explicit note edit');
    expect(rating.saveAndSync.mock.calls[0][1]).toMatchObject({ replaceNotes: true });
  });

  it('shares an in-flight save and retains edits made during that save', async () => {
    const { modal, state, rating } = setup();
    let complete!: (result: AstraSaveResult) => void;
    rating.saveAndSync.mockReturnValue(
      new Promise<AstraSaveResult>((resolve) => {
        complete = resolve;
      })
    );
    const first = inspect(modal).save();
    const second = inspect(modal).save();
    state.updateSeasonField(0, 'notes', 'Edited during save');
    complete('synced');
    await Promise.all([first, second]);
    expect(rating.saveAndSync).toHaveBeenCalledTimes(1);
    expect(state.isDirty).toBe(true);
    expect(rating.saveAndSync.mock.calls[0][0].seasons[0].notes).toBe('New note');
  });

  it('waits for an in-flight save before closing', async () => {
    const { modal, overlay, rating } = setup();
    let complete!: (result: AstraSaveResult) => void;
    rating.saveAndSync.mockReturnValue(
      new Promise<AstraSaveResult>((resolve) => {
        complete = resolve;
      })
    );
    const saving = inspect(modal).save();
    const closing = modal.close();
    expect(overlay.classList.contains('astra-modal-overlay--closing')).toBe(false);
    complete('synced');
    await saving;
    await closing;
    expect(overlay.classList.contains('astra-modal-overlay--closing')).toBe(true);
    expect(rating.saveAndSync).toHaveBeenCalledTimes(1);
  });

  it('closes an offline queued save without reloading before the retry can run', async () => {
    const { modal, overlay, rating, toast } = setup();
    const settle = captureDrain(rating);
    await modal.close();
    expect(inspect(modal).reloadAfterClose).toBe(false);
    await vi.advanceTimersByTimeAsync(350);
    expect(overlay.isConnected).toBe(false);
    settle('queued');
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('queued'));
  });

  it('does not claim success after extension context invalidation', async () => {
    const { modal, overlay, rating } = setup();
    chrome.runtime.id = '';
    await modal.close();
    expect(overlay.isConnected).toBe(true);
    expect(rating.saveAndSync).not.toHaveBeenCalled();
  });

  it('does not seed Astra section ratings from the AniList score', async () => {
    const { modal } = setup();
    vi.spyOn(inspect(modal), 'render').mockImplementation(() => {});
    await modal.open(1);
    expect(inspect(modal).state.data.seasons[0].scores).toEqual({});
  });
  it('uses the committed draft version for subsequent saves, including a failed remote sync', async () => {
    const { modal, state, rating } = setup();
    rating.saveAndSync.mockImplementationOnce(async (draft) => {
      draft.updatedAt = 200;
      throw new Error('Queue write failed');
    });
    await expect(inspect(modal).save()).rejects.toThrow('Queue write failed');
    expect(state.data.updatedAt).toBe(200);
    expect(state.isDirty).toBe(true);
    await inspect(modal).save();
    expect(rating.saveAndSync.mock.calls[1][0].updatedAt).toBe(200);
  });
  it('binds a new work draft to its opening account and ignores a closed pending open', async () => {
    const { modal, api, rating } = setup();
    Object.assign(api, {
      ensureContext: async () => ({ sessionId: 'one', userId: 1 }),
      getContext: () => ({ sessionId: 'one', userId: 1 }),
    });
    const render = vi.spyOn(inspect(modal), 'render').mockImplementation(() => {});
    await modal.open(1);
    expect(inspect(modal).state.data.ownerId).toBe(1);
    let finish!: (value: IRatingInitialData) => void;
    const data = await rating.getMediaRatingData();
    rating.getMediaRatingData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const opening = modal.open(2);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    Object.assign(modal, { overlay: null });
    await modal.close();
    finish(data);
    await opening;
    expect(render).toHaveBeenCalledTimes(1);
  });
});

/** Captures the completion callback a background close hands to the rating service. */
function captureDrain(rating: ReturnType<typeof setup>['rating']) {
  const drain: { settle?: (result: 'synced' | 'queued') => void } = {};
  rating.saveAndSync.mockImplementation(async (_work: AstraWork, extra: AstraSaveOptions): Promise<AstraSaveResult> => {
    drain.settle = extra.onDispatched;
    return 'queued';
  });
  return (result: 'synced' | 'queued') => drain.settle?.(result);
}

describe('AstraRatingModal background sync feedback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chrome.runtime.id = 'test';
    document.body.innerHTML = '';
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'visibilityState');
    window.history.replaceState({}, '', '/');
  });

  it('reloads once when a synced drain lands while the closing view is still on screen', async () => {
    const { modal, rating } = setup();
    const settle = captureDrain(rating);
    const reload = vi.spyOn(inspect(modal), 'reloadHost').mockImplementation(() => {});
    await modal.close();
    settle('synced');
    expect(reload).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(400);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads a synced drain that lands after the closing animation on the same page', async () => {
    const { modal, rating } = setup();
    const settle = captureDrain(rating);
    const reload = vi.spyOn(inspect(modal), 'reloadHost').mockImplementation(() => {});
    await modal.close();
    await vi.advanceTimersByTimeAsync(400);
    settle('synced');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not reload after the user navigated to another page', async () => {
    const { modal, rating } = setup();
    const settle = captureDrain(rating);
    const reload = vi.spyOn(inspect(modal), 'reloadHost').mockImplementation(() => {});
    await modal.close();
    window.history.pushState({}, '', '/anime/999');
    settle('synced');
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when another Astra view has opened since the close', async () => {
    const { modal, rating } = setup();
    const settle = captureDrain(rating);
    const reload = vi.spyOn(inspect(modal), 'reloadHost').mockImplementation(() => {});
    await modal.close();
    Object.assign(modal, { overlay: document.createElement('div') });
    settle('synced');
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload while a form field has focus', async () => {
    const { modal, rating } = setup();
    const settle = captureDrain(rating);
    const reload = vi.spyOn(inspect(modal), 'reloadHost').mockImplementation(() => {});
    const field = document.createElement('input');
    document.body.appendChild(field);
    await modal.close();
    field.focus();
    settle('synced');
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when the close asked to suppress it', async () => {
    const { modal, rating } = setup();
    const settle = captureDrain(rating);
    const reload = vi.spyOn(inspect(modal), 'reloadHost').mockImplementation(() => {});
    await modal.close({ suppressReload: true });
    settle('synced');
    expect(reload).not.toHaveBeenCalled();
  });

  it('shows the queued notice only once the drain reports it', async () => {
    const { modal, rating, toast } = setup();
    const settle = captureDrain(rating);
    const reload = vi.spyOn(inspect(modal), 'reloadHost').mockImplementation(() => {});
    await modal.close();
    expect(toast.info).not.toHaveBeenCalled();
    settle('queued');
    expect(toast.info).toHaveBeenCalledOnce();
    expect(toast.info).toHaveBeenCalledWith('Saved locally. AniList synchronization is queued.');
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps the queued notice for an explicit Save', async () => {
    const { modal, rating, toast } = setup();
    rating.saveAndSync.mockResolvedValue('queued');
    await inspect(modal).save();
    expect(toast.info).toHaveBeenCalledWith('Saved locally. AniList synchronization is queued.');
  });

  it('never reloads for a local-only save of an unlisted title', async () => {
    const { modal, rating } = setup();
    const reload = vi.spyOn(inspect(modal), 'reloadHost').mockImplementation(() => {});
    rating.saveAndSync.mockResolvedValue('local');
    inspect(modal).needsListStatus = true;
    await modal.close();
    await vi.advanceTimersByTimeAsync(400);
    expect(rating.saveAndSync.mock.calls[0][1]).toMatchObject({ skipSync: true });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('AstraRatingModal quick-edit data protection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chrome.runtime.id = 'test';
    document.body.innerHTML = '';
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('saves the previous progress instead of zero when the progress field is emptied', async () => {
    const { modal, overlay, rating } = setup();
    (overlay.querySelector('#astra-progress') as HTMLInputElement).value = '';
    await inspect(modal).save();
    expect(rating.saveAndSync.mock.calls[0][1].progress).toBe(2);
  });

  it('does not treat an emptied progress field as a change when closing', async () => {
    const { modal, state, overlay, rating } = setup();
    state.isDirty = false;
    (overlay.querySelector('#astra-progress') as HTMLInputElement).value = '';
    await modal.close();
    expect(rating.saveAndSync).not.toHaveBeenCalled();
  });

  it('keeps auto-stamped episode dates that the picker never edited', async () => {
    const { modal, state, overlay } = setup();
    (overlay.querySelector('#astra-progress') as HTMLInputElement).value = '3';
    await inspect(modal).save();
    expect(state.data.seasons[0].episodeNotes?.[3]?.timestamp).toBe(123);
  });

  it('saves a date committed on an aired episode beyond the watched progress and clears its marker', async () => {
    const { modal, state, overlay } = setup();
    overlay.insertAdjacentHTML(
      'beforeend',
      '<div class="astra-ep-date-picker" data-ep="5" data-edited="1" data-timestamp="555"></div>'
    );
    await inspect(modal).save();
    expect(state.data.seasons[0].episodeNotes?.[5]?.timestamp).toBe(555);
    expect(overlay.querySelector('[data-ep="5"]')?.getAttribute('data-edited')).toBeNull();
  });

  it('saves a new-title draft in Astra only and closes without queuing an AniList write', async () => {
    const { modal, overlay, rating, toast } = setup();
    rating.saveAndSync.mockResolvedValue('local');
    inspect(modal).needsListStatus = true;
    await modal.close();
    await vi.advanceTimersByTimeAsync(400);
    expect(overlay.isConnected).toBe(false);
    expect(rating.saveAndSync).toHaveBeenCalledTimes(1);
    expect(rating.saveAndSync.mock.calls[0][1]).toMatchObject({ skipSync: true });
    expect(rating.saveAndSync.mock.calls[0][1]).not.toHaveProperty('dispatch');
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith('Saved in Astra only: this title is not on your AniList list. Pick a status to add it.');
  });

  it('explicit Save on an unlisted title commits locally and clears the draft without an AniList write', async () => {
    const { modal, state, rating, toast } = setup();
    rating.saveAndSync.mockResolvedValue('local');
    inspect(modal).needsListStatus = true;
    await inspect(modal).save();
    expect(rating.saveAndSync.mock.calls[0][1]).toMatchObject({ skipSync: true });
    expect(state.isDirty).toBe(false);
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('Saved in Astra only'));
  });

  it('auto-saves on close with background dispatch so a slow AniList round-trip cannot hold the modal open', async () => {
    const { modal, overlay, rating } = setup();
    rating.saveAndSync.mockImplementation(async (_work: AstraWork, extra: AstraSaveOptions): Promise<AstraSaveResult> =>
      extra.dispatch === 'background' ? 'queued' : new Promise<AstraSaveResult>(() => {}));
    await modal.close();
    await vi.advanceTimersByTimeAsync(400);
    expect(rating.saveAndSync.mock.calls[0][1]).toMatchObject({ dispatch: 'background' });
    expect(overlay.isConnected).toBe(false);
  });

  it('does not reload the host when closing hands off to the dashboard after a synced save', async () => {
    const { modal, state, overlay } = setup();
    const reload = vi.spyOn(inspect(modal), 'reloadHost').mockImplementation(() => {});
    inspect(modal).reloadAfterClose = true;
    state.isDirty = false;
    (overlay.querySelector('#astra-progress') as HTMLInputElement).value = '1';
    await modal.close({ suppressReload: true });
    await vi.advanceTimersByTimeAsync(400);
    expect(reload).not.toHaveBeenCalled();
    expect(overlay.isConnected).toBe(false);
  });

  it('renders an invalid fuzzy AniList date without throwing and keeps its raw value for the form', () => {
    const { modal } = setup();
    const html = inspect(modal).renderDateField('astra-start-date', 'START DATE', '2023-02-30');
    expect(html).toContain('id="astra-start-date" value="2023-02-30"');
  });
});

describe('AstraRatingModal reconciliation with AniList on open', () => {
  const REMOTE_NOTES = 'Story 8 | Characters 7.8';
  beforeEach(() => {
    vi.useFakeTimers();
    chrome.runtime.id = 'test';
    document.body.innerHTML = '';
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows AniList notes, clears stale local scores, and saves without pushing an Astra score', async () => {
    const existing: AstraWork = {
      id: 'work_1',
      mediaId: 1,
      title: 'Test',
      type: 'anime',
      status: MediaListStatus.CURRENT,
      customLists: [],
      tags: [],
      notes: '',
      updatedAt: 100,
      seasons: [{ id: 'season_1', name: 'Season 1', scores: { story: 8 }, notes: '' }],
    };
    const response = ratingResponse();
    Object.assign(response.Media.mediaListEntry, { score: 0, notes: REMOTE_NOTES });
    const astra = {
      calcSeasonScore: () => 0,
      calcSectionScore: () => null,
      getFullWork: vi.fn(async () => structuredClone(existing)),
      getWorks: () => [],
      getSections: () => DEFAULT_SECTIONS,
      getSettings: () => DEFAULT_SETTINGS,
      saveWork: vi.fn(async (patch: Partial<AstraWork>) => ({
        ...structuredClone(existing),
        ...patch,
      })),
    };
    const api = { getCurrentUserId: vi.fn(async () => 42) };
    const bus = { emit: vi.fn() };
    const toast = { error: vi.fn(), info: vi.fn() };
    const rating = {
      saveAndSync: vi.fn(
        async (_work: AstraWork, _extra: AstraSaveOptions): Promise<AstraSaveResult> => 'synced'
      ),
      getMediaRatingData: vi.fn(async () => ratingInitialResponse(response, 1, 42)!),
    };
    const modal = new AstraRatingModal(
      astra as unknown as AstraService,
      api as unknown as IApiClient,
      bus as unknown as IEventBus,
      toast as unknown as ToastService,
      rating as unknown as IAstraRatingService,
      new AstraOverlayService()
    );

    await modal.open(1);

    expect(document.querySelector<HTMLTextAreaElement>('#astra-general-notes')!.value).toContain(
      REMOTE_NOTES
    );
    expect(astra.saveWork).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 1,
        notes: REMOTE_NOTES,
        seasons: [expect.objectContaining({ scores: {}, notes: REMOTE_NOTES })],
      }),
      true
    );

    inspect(modal).state.isDirty = true;
    await inspect(modal).save();
    expect(rating.saveAndSync.mock.calls[0][1]).toMatchObject({ syncScore: false });
    expect(rating.saveAndSync.mock.calls[0][1]).not.toHaveProperty('notes');
  });
});
