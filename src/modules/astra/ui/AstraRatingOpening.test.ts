import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../AstraService', () => ({ AstraService: class {} }));
import { AstraRatingModal } from './AstraRatingModal';
import { AstraOverlayService } from '../services/AstraOverlayService';
import { ratingInitialResponse } from '../services/AstraRatingResponse';
import { ratingResponse } from '@/test/astra-rating-fixtures';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IRatingInitialData } from '../interfaces/IAstraRatingService';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
function fixture() {
  const bus = new EventBus();
  const api = { getContext: () => ({ userId: 42, sessionId: 'one' }), ensureContext: async () => ({ userId: 42, sessionId: 'one' }) };
  const data = (id = 1) => {
    const response = ratingResponse(id); response.Media.title.userPreferred = `Work ${id}`;
    return ratingInitialResponse(response, id, 42)!;
  };
  const rating = { getMediaRatingData: vi.fn(async (_id: number): Promise<IRatingInitialData | null> => data(_id)) };
  const astra = { getFullWork: vi.fn(async (_id: number) => undefined), getWorks: () => [],
    getSettings: () => ({ enableSeriesFinale: false }), hasFinaleSection: () => false,
    getSections: () => [{ id: 'story', name: 'Story', weight: 1 }], getScoringMode: () => 'detailed', calcSectionScore: () => 8, calcSeasonScore: () => 8 };
  const toast = { error: vi.fn(), info: vi.fn() }; const overlays = new AstraOverlayService();
  const modal = new AstraRatingModal(astra as never, api as never, bus, toast as never, rating as never, overlays);
  return { modal, bus, api, rating, astra, toast, overlays, data };
}
const fixtures: ReturnType<typeof fixture>[] = [];
function setup() { const f = fixture(); fixtures.push(f); return f; }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

beforeEach(() => { vi.useFakeTimers(); history.replaceState({}, '', '/anime/1'); document.body.replaceChildren(); });
afterEach(() => {
  fixtures.splice(0).forEach(f => { f.modal.dispose(); f.overlays.dispose(); });
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren();
});

describe('Quick Edit opening responsiveness and navigation', () => {
  it('shows a cancellable window before waiting for authentication or provider data', async () => {
    const f = setup(); const context = deferred<{ userId: number; sessionId: string }>();
    f.api.ensureContext = () => context.promise;
    const pending = f.modal.open(1);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Loading');
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Close Quick Edit"]')).not.toBeNull();
    expect(document.body.style.overflow).toBe('hidden');
    context.resolve({ userId: 42, sessionId: 'one' }); await pending;
    expect(document.querySelector('.astra-header-title')?.textContent).toContain('Work 1');
    expect(document.querySelector('[role="status"]')).toBeNull();
  });
  it('reads the local work while the provider request is still pending and coalesces repeat clicks', async () => {
    const f = setup(); const response = deferred<IRatingInitialData>();
    f.rating.getMediaRatingData.mockReturnValueOnce(response.promise);
    const first = f.modal.open(1); const second = f.modal.open(1); await flush();
    expect(f.astra.getFullWork).toHaveBeenCalledWith(1);
    expect(f.rating.getMediaRatingData).toHaveBeenCalledTimes(1);
    response.resolve(f.data()); await Promise.all([first, second]);
    expect(document.querySelectorAll('.astra-modal-overlay')).toHaveLength(1);
  });
  it.each(['button', 'Escape'])('cancels a slow opening using %s, restores focus and permits reopening', async how => {
    const f = setup(); const response = deferred<IRatingInitialData>();
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    f.rating.getMediaRatingData.mockReturnValueOnce(response.promise);
    const old = f.modal.open(1); await flush();
    if (how === 'button') document.querySelector<HTMLButtonElement>('[aria-label="Close Quick Edit"]')!.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.astra-modal-overlay')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden'); expect(document.activeElement).toBe(opener);
    await f.modal.open(2); response.resolve(f.data()); await old;
    expect(document.querySelector('.astra-header-title')?.textContent).toContain('Work 2');
  });
  it('discards a late response when the user navigates to another work', async () => {
    const f = setup(); const response = deferred<IRatingInitialData>();
    f.rating.getMediaRatingData.mockReturnValueOnce(response.promise);
    const old = f.modal.open(1); await flush();
    history.replaceState({}, '', '/anime/2');
    f.bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/anime/2', previousPath: '/anime/1', timestamp: new Date() });
    expect(document.querySelector('.astra-modal-overlay')).toBeNull();
    await f.modal.open(2); response.resolve(f.data()); await old;
    expect(document.querySelector('.astra-header-title')?.textContent).toContain('Work 2');
    expect(f.toast.error).not.toHaveBeenCalled();
  });
  it('removes loading UI and scroll locks on failure, then permits retry', async () => {
    const f = setup(); f.rating.getMediaRatingData.mockResolvedValueOnce(null);
    await f.modal.open(1);
    expect(document.querySelector('.astra-modal-overlay')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(f.bus.listenerCount(EVENT_TYPES.PAGE_CHANGED)).toBe(0);
    await f.modal.open(1); expect(document.querySelector('.astra-header-title')).not.toBeNull();
  });
});
