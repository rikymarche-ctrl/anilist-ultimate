import { rerenderRatingModal } from '@/test/astra-rating-fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../AstraService', () => ({ AstraService: class {} }));
import { AstraRatingModal } from './AstraRatingModal';
import { AstraOverlayService } from '../services/AstraOverlayService';
import { ratingResponse } from '@/test/astra-rating-fixtures';
import { ratingInitialResponse } from '../services/AstraRatingResponse';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { AstraService } from '../AstraService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ToastService } from '@core/services/ToastService';
import type { IAstraRatingService, AstraSaveOptions, AstraSaveResult, IRatingInitialData } from '../interfaces/IAstraRatingService';
import type { AstraWork } from '../AstraInterfaces';

function setup() {
  let context = { sessionId: 'one', userId: 42 };
  const api = { getCurrentUserId: async () => context.userId, ensureContext: async () => ({ ...context }), getContext: () => ({ ...context }) };
  const bus = new EventBus(); const emit = vi.spyOn(bus, 'emit');
  const toast = { error: vi.fn(), info: vi.fn() };
  const rating = { getMediaRatingData: vi.fn(async (id: number): Promise<IRatingInitialData | null> => ratingInitialResponse(ratingResponse(id), id, 42)),
    deleteEntry: vi.fn(async (_id: number): Promise<'synced' | 'queued'> => 'synced'),
    saveAndSync: vi.fn(async (_work: AstraWork, _extra: AstraSaveOptions): Promise<AstraSaveResult> => 'local') };
  const astra = { getFullWork: async () => undefined, getWorks: () => [], getSettings: () => ({ enableSeriesFinale: false }),
    hasFinaleSection: () => false, getSections: () => [{ id: 'story', name: 'Story', weight: 1 }], getScoringMode: () => 'detailed', calcSectionScore: () => 8, calcSeasonScore: () => 8 };
  const overlayService = new AstraOverlayService();
  const modal = new AstraRatingModal(astra as unknown as AstraService, api as IApiClient, bus,
    toast as unknown as ToastService, rating as unknown as IAstraRatingService, overlayService);
  const root = () => document.querySelector<HTMLElement>('.astra-modal-overlay')!;
  const input = (selector: string) => root().querySelector<HTMLInputElement>(selector)!;
  const save = () => (modal as unknown as { save(): Promise<void> }).save();
  const dispose = () => (modal as unknown as { dispose(): void }).dispose();
  return { modal, overlayService, api, bus, emit, toast, rating, root, input, save, dispose,
    switchContext: (sessionId: string, userId = 42) => { context = { sessionId, userId }; } };
}

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
describe('Astra rating modal lifecycle and account ownership', () => {
  const fixtures: ReturnType<typeof setup>[] = [];
  beforeEach(() => {
    vi.useFakeTimers(); document.body.innerHTML = ''; document.body.style.overflow = ''; document.documentElement.style.overflow = '';
    Object.assign(chrome.runtime, { id: 'test' });
  });
  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      const modal = fixture.modal as unknown as { dispose?(): void };
      if (modal.dispose) modal.dispose(); else await fixture.modal.close();
      fixture.overlayService.dispose();
    }
    await vi.runOnlyPendingTimersAsync(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '';
    document.body.style.overflow = ''; document.documentElement.style.overflow = '';
  });
  const open = async () => { const fixture = setup(); fixtures.push(fixture); await fixture.modal.open(1); return fixture; };
  const dirty = (f: ReturnType<typeof setup>, value = 'Edited') => {
    f.input('#astra-general-notes').value = value; f.input('#astra-general-notes').dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('does not reload another account after an accepted deletion completes', async () => {
    const f = await open(); vi.spyOn(window, 'confirm').mockReturnValue(true);
    let finish!: (result: 'synced') => void;
    f.rating.deleteEntry.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const reload = vi.spyOn(f.modal as unknown as { reloadHost(): void }, 'reloadHost').mockImplementation(() => {});
    f.root().querySelector<HTMLButtonElement>('#astra-delete-entry')!.click();
    await flush(); expect(f.rating.deleteEntry).toHaveBeenCalledOnce();
    f.switchContext('two', 99); finish('synced'); await flush();
    expect(reload).not.toHaveBeenCalled(); expect(f.rating.saveAndSync).not.toHaveBeenCalled();
    expect(f.toast.error).not.toHaveBeenCalled();
  });

  it('makes detached stepper controls inert after a view rerender', async () => {
    const f = await open(); const old = f.root().querySelector<HTMLButtonElement>('[data-step-field="progress"][data-step="1"]')!;
    rerenderRatingModal(f.modal); old.click();
    const state = (f.modal as unknown as { state: { data: AstraWork } }).state;
    expect(state.data.progress).toBe(3);
  });

  it('makes controls removed individually inert', async () => {
    const f = await open(); const button = f.root().querySelector<HTMLButtonElement>('[data-step-field="progress"][data-step="1"]')!;
    button.remove(); button.click();
    expect((f.modal as unknown as { state: { isDirty: boolean } }).state.isDirty).toBe(false);
  });

  it('does not allow a detached old header to change a newly opened work', async () => {
    const f = await open(); const button = f.input('[data-step-field="progress"][data-step="1"]'); await f.modal.open(2); button.click();
    expect((f.modal as unknown as { state: { isDirty: boolean } }).state.isDirty).toBe(false);
    expect(f.root().querySelector<HTMLAnchorElement>('.astra-title-link')?.pathname).toBe('/anime/2');
  });

  it('hides the form on account signals and releases the view subscription', async () => {
    const f = await open(); expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(1);
    const old = f.root(); f.switchContext('two', 43);
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: 43, timestamp: new Date() });
    expect(old.isConnected).toBe(false); expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0);
    expect(f.rating.saveAndSync).not.toHaveBeenCalled();
  });

  it('checks the opening session before handling a control even without a received signal', async () => {
    const f = await open(); const old = f.root(); const button = f.input('[data-step-field="progress"][data-step="1"]');
    f.switchContext('two'); button.click(); await flush();
    expect(old.isConnected).toBe(false); expect(f.rating.saveAndSync).not.toHaveBeenCalled();
  });

  it('stops a dirty new-open request when saving the current work fails', async () => {
    const f = await open(); dirty(f); const old = f.root();
    f.rating.saveAndSync.mockRejectedValueOnce(new Error('Local save failed'));
    await f.modal.open(2);
    expect(old.isConnected).toBe(true); expect(f.rating.getMediaRatingData).toHaveBeenCalledTimes(1);
    expect(f.input('#astra-general-notes').value).toBe('Edited'); expect(f.toast.error).toHaveBeenCalled();
  });

  it('does not let an old close failure report an error on the next view', async () => {
    const f = await open(); dirty(f); let reject!: (e: Error) => void;
    f.rating.saveAndSync.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const closing = f.modal.close(); f.dispose(); await f.modal.open(2);
    reject(new Error('Old failure')); await closing;
    expect(f.root().querySelector<HTMLAnchorElement>('.astra-title-link')?.pathname).toBe('/anime/2');
    expect(f.toast.error).not.toHaveBeenCalled();
  });

  it('does not let an old close remove or mark a newly opened form as closing', async () => {
    const f = await open(); dirty(f); let finish!: (value: 'local') => void;
    f.rating.saveAndSync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const closing = f.modal.close(); f.dispose(); await f.modal.open(2);
    const next = f.root(); finish('local'); await closing; await vi.advanceTimersByTimeAsync(400);
    expect(next.isConnected).toBe(true); expect(next.classList.contains('astra-modal-overlay--closing')).toBe(false);
  });

  it('keeps edits made during an automatic close save open', async () => {
    const f = await open(); dirty(f); let finish!: (value: 'local') => void;
    f.rating.saveAndSync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const closing = f.modal.close(); dirty(f, 'New edit'); finish('local'); await closing;
    expect(f.root().isConnected).toBe(true); expect(f.root().classList.contains('astra-modal-overlay--closing')).toBe(false);
    expect(f.rating.saveAndSync).toHaveBeenCalledTimes(1);
  });

  it('removes an old save from the view before opening a different account and ignores its result', async () => {
    const f = await open(); dirty(f); let finish!: (value: 'local') => void;
    f.rating.saveAndSync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const saving = f.save(); f.switchContext('two', 43);
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: 43, timestamp: new Date() });
    finish('local'); await saving;
    expect(f.emit.mock.calls.some(call => call[0] === EVENT_TYPES.PROGRESS_UPDATED || call[0] === EVENT_TYPES.ASTRA_DATA_UPDATED)).toBe(false);
    expect(document.querySelector('.astra-modal-overlay')).toBeNull();
  });

  it('cancels a pending open on disposal before data arrives', async () => {
    const f = setup(); fixtures.push(f); let finish!: (data: IRatingInitialData) => void;
    f.rating.getMediaRatingData.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const opening = f.modal.open(1); await flush(); f.dispose();
    finish(ratingInitialResponse(ratingResponse(), 1, 42)!); await opening;
    expect(document.querySelector('.astra-modal-overlay')).toBeNull();
    expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0);
  });

  it('releases its account subscription when the initial entry cannot be loaded', async () => {
    const f = setup(); fixtures.push(f); f.rating.getMediaRatingData.mockResolvedValueOnce(null);
    await f.modal.open(1);
    expect(document.querySelector('.astra-modal-overlay')).toBeNull();
    expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0);
  });

  it('invalidates an opening request on an account signal before its response arrives', async () => {
    const f = setup(); fixtures.push(f); let finish!: (data: IRatingInitialData) => void;
    f.rating.getMediaRatingData.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const opening = f.modal.open(1); await flush(); f.switchContext('two', 43);
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: 43, timestamp: new Date() });
    finish(ratingInitialResponse(ratingResponse(), 1, 42)!); await opening;
    expect(document.querySelector('.astra-modal-overlay')).toBeNull();
    expect(f.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0);
    expect(f.rating.saveAndSync).not.toHaveBeenCalled();
  });

  it('filters inactive tabs, hidden fields and closed menu controls from the focus trap', async () => {
    const f = await open();
    const elements = (f.modal as unknown as { getFocusableElements(): HTMLElement[] }).getFocusableElements();
    expect(elements.length).toBeGreaterThan(0);
    expect(elements.some(element => element.matches('input[type="hidden"]') || element.closest('#astra-tab-journal, .astra-dropdown-menu'))).toBe(false);
  });

  it('restores the prior body overflow and opener focus after close', async () => {
    document.body.style.overflow = 'scroll';
    document.documentElement.style.overflow = 'auto';
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const f = await open();
    expect(document.body.style.overflow).toBe('hidden'); expect(document.documentElement.style.overflow).toBe('hidden');
    f.input('[data-step-field="progress"][data-step="1"]').focus(); await f.modal.close(); await vi.advanceTimersByTimeAsync(400);
    expect(document.body.style.overflow).toBe('scroll');
    expect(document.documentElement.style.overflow).toBe('auto');
    expect(document.activeElement).toBe(opener);
    document.body.style.removeProperty('overflow'); document.documentElement.style.removeProperty('overflow');
  });

  it('keeps the page locked when Quick Edit closes into the dashboard, then restores it', async () => {
    const f = await open(); const ratingRoot = f.root();
    f.overlayService.create('dashboard');
    await f.modal.close(); await vi.advanceTimersByTimeAsync(400);
    expect(ratingRoot.isConnected).toBe(false); expect(document.querySelector('#astra-overlay-dashboard')).not.toBeNull();
    expect(document.body.style.overflow).toBe('hidden'); expect(document.documentElement.style.overflow).toBe('hidden');
    f.overlayService.hide('dashboard'); await vi.advanceTimersByTimeAsync(400);
    expect(document.querySelector('.astra-modal-overlay')).toBeNull();
    expect(document.body.style.overflow).toBe(''); expect(document.documentElement.style.overflow).toBe('');
  });

  it('closes the cover portal on Escape while keeping the underlying form open', async () => {
    const f = await open(); f.input('#astra-cover').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await flush();
    expect(document.querySelector('.astra-cover-full-overlay')).toBeNull(); expect(f.root().classList.contains('astra-modal-overlay--closing')).toBe(false);
  });

  it('retains the committed draft version when the same work rerenders during its save', async () => {
    const f = await open(); dirty(f); let finish!: () => void;
    f.rating.saveAndSync.mockImplementationOnce(async draft => {
      await new Promise<void>(resolve => { finish = resolve; }); draft.updatedAt = 1234; return 'local';
    });
    const saving = f.save(); rerenderRatingModal(f.modal); finish(); await saving; await f.save();
    expect(f.rating.saveAndSync.mock.calls[1][0].updatedAt).toBe(1234);
  });

  it('does not reuse an old pending save for a newly opened work', async () => {
    const f = await open(); dirty(f); let finish!: (value: 'local') => void;
    f.rating.saveAndSync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const saving = f.save(); f.dispose(); await f.modal.open(2); dirty(f, 'Second work'); await f.save();
    expect(f.rating.saveAndSync).toHaveBeenCalledTimes(2); expect(f.rating.saveAndSync.mock.calls[1][0].mediaId).toBe(2);
    finish('local'); await saving;
  });

  it('contains an async tab-save failure and leaves the original tab and edits open', async () => {
    const f = await open(); dirty(f); f.rating.saveAndSync.mockRejectedValueOnce(new Error('Storage failure'));
    f.input('[data-tab="journal"]').click(); await flush();
    expect(f.root().querySelector('.astra-tab-content--active')?.id).toBe('astra-tab-rating');
    expect(f.input('#astra-general-notes').value).toBe('Edited'); expect(f.toast.error).toHaveBeenCalled();
  });

  it('shows Delete entry only on the Rating tab', async () => {
    const f = await open();
    expect(f.root().querySelector('#astra-delete-entry')).not.toBeNull();

    f.input('[data-tab="journal"]').click(); await flush();
    expect(f.root().querySelector('.astra-tab-content--active')?.id).toBe('astra-tab-journal');
    expect(f.root().querySelector('#astra-delete-entry')).toBeNull();

    f.input('[data-tab="rating"]').click(); await flush();
    expect(f.root().querySelector('.astra-tab-content--active')?.id).toBe('astra-tab-rating');
    expect(f.root().querySelector('#astra-delete-entry')).not.toBeNull();
  });

  it('keeps Custom Lists in a detached side window only on the Rating tab', async () => {
    const f = await open();
    const workspace = f.root().querySelector('.astra-rating-workspace')!;
    const panel = f.root().querySelector<HTMLElement>('#astra-custom-list-panel')!;
    const modal = f.root().querySelector('.astra-modal--rating')!;
    const focusable = (f.modal as unknown as { getFocusableElements(): HTMLElement[] }).getFocusableElements();

    expect(panel.parentElement).toBe(workspace);
    expect(modal.contains(panel)).toBe(false);
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(focusable).toContain(panel.querySelector('.astra-custom-list-cb'));

    f.input('[data-tab="journal"]').click(); await flush();
    expect(workspace.classList.contains('astra-rating-workspace--journal')).toBe(true);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(panel.hasAttribute('hidden')).toBe(true);
    expect((f.modal as unknown as { getFocusableElements(): HTMLElement[] }).getFocusableElements())
      .not.toContain(panel.querySelector('.astra-custom-list-cb'));

    f.input('[data-tab="rating"]').click(); await flush();
    expect(workspace.classList.contains('astra-rating-workspace--journal')).toBe(false);
    expect(panel.getAttribute('aria-hidden')).toBe('false');
    expect(panel.hasAttribute('hidden')).toBe(false);
  });

  it('keeps current tab state intact when another entry fails to load', async () => {
    const f = await open(); const old = f.root(); f.rating.getMediaRatingData.mockResolvedValueOnce(null);
    await f.modal.open(2, 'journal'); f.input('[data-tab="journal"]').click(); await flush();
    expect(old.isConnected).toBe(true); expect(old.querySelector('.astra-tab-content--active')?.id).toBe('astra-tab-journal');
  });

  it('wraps keyboard focus both ways within the active controls', async () => {
    const f = await open(); const elements = (f.modal as unknown as { getFocusableElements(): HTMLElement[] }).getFocusableElements();
    elements[0].focus(); const backwards = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    elements[0].dispatchEvent(backwards); expect(backwards.defaultPrevented).toBe(true); expect(document.activeElement).toBe(elements[elements.length - 1]);
    const forwards = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    elements[elements.length - 1].dispatchEvent(forwards); expect(forwards.defaultPrevented).toBe(true); expect(document.activeElement).toBe(elements[0]);
  });

  it('bounds huge journals and keeps page edits, dates and original episode numbers', async () => {
    const f = setup(); fixtures.push(f);
    const data = ratingInitialResponse(ratingResponse(), 1, 42)!;
    data.media.episodes = 2147483647; data.media.status = 'FINISHED'; data.media.nextAiringEpisode = null;
    f.rating.getMediaRatingData.mockResolvedValueOnce(data); await f.modal.open(1, 'journal');
    expect(f.root().querySelectorAll('.astra-ep-row')).toHaveLength(100);
    const first = f.input('[data-ep="1"].astra-ep-textarea'); first.value = 'First page edit';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    const datePicker = f.root().querySelector<HTMLElement>('[data-ep="1"].astra-ep-date-picker')!;
    datePicker.dataset.timestamp = '123456789'; datePicker.dataset.edited = '1'; // mirrors a committed picker value
    const jump = f.input('[data-astra-journal-jump]'); jump.value = '2147483647'; jump.dispatchEvent(new Event('change', { bubbles: true }));
    expect(f.root().querySelectorAll('.astra-ep-row')).toHaveLength(47);
    const last = f.input('[data-ep="2147483647"].astra-ep-textarea'); last.value = 'Last page edit';
    last.dispatchEvent(new Event('input', { bubbles: true })); await f.save();
    const notes = f.rating.saveAndSync.mock.calls[0][0].seasons[0].episodeNotes!;
    expect(notes[1]).toMatchObject({ text: 'First page edit', timestamp: 123456789 });
    expect(notes[2147483647].text).toBe('Last page edit');
    const back = f.input('[data-astra-journal-jump]'); back.value = '1'; back.dispatchEvent(new Event('change', { bubbles: true }));
    expect(f.input('[data-ep="1"].astra-ep-textarea').value).toBe('First page edit');
  });

  it('shows the lock only while an unaired journal episode is locked', async () => {
    const f = setup(); fixtures.push(f); await f.modal.open(1, 'journal');
    const airedRow = f.root().querySelector<HTMLElement>('.astra-ep-row[data-ep="4"]')!;
    const lockedRow = f.root().querySelector<HTMLElement>('.astra-ep-row[data-ep="5"]')!;
    expect(airedRow.querySelector('.astra-ep-lock-indicator')).toBeNull();
    expect(lockedRow.querySelector('.astra-ep-lock-indicator')).not.toBeNull();

    lockedRow.click(); lockedRow.click(); lockedRow.click();
    expect(lockedRow.classList.contains('astra-ep-row--unlocked')).toBe(true);
    expect(lockedRow.querySelector('.astra-ep-lock-indicator')).toBeNull();
    expect(lockedRow.querySelector('.astra-journal-tooltip')).toBeNull();
    expect(lockedRow.querySelector('.astra-ep-badge--not-aired')?.getAttribute('data-astra-tooltip'))
      .toBe('Not aired yet. Notes are unlocked; this episode remains marked N/A until your watched progress changes.');
    expect(lockedRow.querySelector<HTMLTextAreaElement>('.astra-ep-textarea')?.disabled).toBe(false);
  });

  it('releases replaced journal resources and leaves old date controls inert', async () => {
    const f = await open();
    const access = f.modal as unknown as { journalScope: { listeners: unknown[]; active: boolean }; viewScope: { listeners: unknown[] }; renderEpisodeJournal(): void };
    const parentCount = access.viewScope.listeners.length; const oldScope = access.journalScope;
    const picker = f.root().querySelector<HTMLElement>('.astra-ep-date-picker')!;
    const oldTrigger = picker.querySelector<HTMLButtonElement>('button')!;
    for (let i = 0; i < 20; i++) access.renderEpisodeJournal();
    expect(oldScope.active).toBe(false); expect(oldScope.listeners).toHaveLength(0);
    expect(access.viewScope.listeners).toHaveLength(parentCount);
    expect(access.journalScope.listeners.length).toBeLessThanOrEqual(200);
    oldTrigger.click(); expect(picker.classList.contains('active')).toBe(false);
  });

  it('preserves unsaved journal notes when progress redraws and records the new watched date', async () => {
    const f = await open(); const first = f.input('[data-ep="1"].astra-ep-textarea'); first.value = 'Unsaved text';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    f.input('[data-step-field="progress"][data-step="1"]').click();
    expect(f.input('[data-ep="1"].astra-ep-textarea').value).toBe('Unsaved text');
    await f.save();
    expect(f.rating.saveAndSync.mock.calls[0][0].seasons[0].episodeNotes![4].timestamp).toBe(Date.now());
  });

  it('keeps journal focus, selection and newer text while a save completes', async () => {
    const f = await open(); f.input('[data-tab="journal"]').click(); await vi.advanceTimersByTimeAsync(100);
    const note = f.root().querySelector<HTMLTextAreaElement>('[data-ep="1"].astra-ep-textarea')!;
    note.value = 'First draft'; note.focus(); note.setSelectionRange(2, 7);
    note.dispatchEvent(new Event('input', { bubbles: true }));
    let finish!: (result: AstraSaveResult) => void;
    f.rating.saveAndSync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const saving = f.save(); await flush();
    note.value = 'Newer draft'; note.setSelectionRange(3, 8, 'backward'); note.dispatchEvent(new Event('input', { bubbles: true }));
    finish('local'); await saving;
    expect(document.activeElement).toBe(note); expect(note.isConnected).toBe(true);
    expect(note.value).toBe('Newer draft'); expect([note.selectionStart, note.selectionEnd, note.selectionDirection]).toEqual([3, 8, 'backward']);
    expect(f.rating.saveAndSync.mock.calls[0][0].seasons[0].episodeNotes![1].text).toBe('First draft');
    await f.save(); expect(f.rating.saveAndSync.mock.calls[1][0].seasons[0].episodeNotes![1].text).toBe('Newer draft');
  });

  it('does not mark page navigation dirty or accept an invalid jump', async () => {
    const f = setup(); fixtures.push(f); const data = ratingInitialResponse(ratingResponse(), 1, 42)!;
    data.media.episodes = 201; f.rating.getMediaRatingData.mockResolvedValueOnce(data); await f.modal.open(1, 'journal');
    const jump = f.input('[data-astra-journal-jump]'); jump.value = '101'; jump.dispatchEvent(new Event('change', { bubbles: true }));
    expect((f.modal as unknown as { state: { isDirty: boolean } }).state.isDirty).toBe(false);
    expect(f.input('[data-astra-journal-jump]').value).toBe('101');
    const invalid = f.input('[data-astra-journal-jump]'); invalid.value = '202'; invalid.dispatchEvent(new Event('change', { bubbles: true }));
    expect(f.input('[data-astra-journal-jump]').value).toBe('101');
    expect(f.rating.saveAndSync).not.toHaveBeenCalled();
  });
  it('saves a dirty form when SPA navigation leaves the page', async () => {
    const f = await open(); dirty(f);
    f.bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/anime/2', previousPath: '/anime/1', timestamp: new Date() });
    await vi.advanceTimersByTimeAsync(400);
    expect(f.rating.saveAndSync).toHaveBeenCalledTimes(1);
  });

  it('switches tabs without saving a new-title draft that cannot be saved yet', async () => {
    const f = await open(); (f.modal as unknown as { needsListStatus: boolean }).needsListStatus = true; dirty(f);
    f.input('[data-tab="journal"]').click(); await flush();
    expect(f.root().querySelector('.astra-tab-content--active')?.id).toBe('astra-tab-journal');
    expect(f.rating.saveAndSync).not.toHaveBeenCalled(); expect(f.toast.error).not.toHaveBeenCalled();
  });

  it('ignores a backdrop click whose press started inside the form', async () => {
    const f = await open(); const overlay = f.root();
    f.input('#astra-general-notes').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);
    expect(overlay.isConnected).toBe(true); expect(overlay.classList.contains('astra-modal-overlay--closing')).toBe(false);
  });

  it('closes when the press and the release both land on the backdrop', async () => {
    const f = await open(); const overlay = f.root();
    overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);
    expect(overlay.isConnected).toBe(false);
  });

  it('tears down a partially rendered form and restores host scroll when rendering fails', async () => {
    const f = setup(); fixtures.push(f);
    vi.spyOn(f.modal as unknown as { attachEvents(): void }, 'attachEvents').mockImplementation(() => { throw new Error('render failed'); });
    await f.modal.open(1);
    expect(document.querySelector('.astra-modal-overlay')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden'); expect(document.documentElement.style.overflow).not.toBe('hidden');
    expect(f.toast.error).toHaveBeenCalled();
  });
});
