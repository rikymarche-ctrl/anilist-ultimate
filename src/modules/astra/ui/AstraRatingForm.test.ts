import { rerenderRatingModal } from '@/test/astra-rating-fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../AstraService', () => ({ AstraService: class {} }));
import { AstraRatingModal } from './AstraRatingModal';
import { AstraOverlayService } from '../services/AstraOverlayService';
import { ratingResponse } from '@/test/astra-rating-fixtures';
import { ratingInitialResponse } from '../services/AstraRatingResponse';
import type { AstraService } from '../AstraService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { ToastService } from '@core/services/ToastService';
import { MediaListStatus } from '@/api/AnilistTypes';
import type { IAstraRatingService, AstraSaveOptions, AstraSaveResult, IRatingInitialData } from '../interfaces/IAstraRatingService';
import type { AstraWork } from '../AstraInterfaces';

const malicious = '</textarea><img data-injected src=x onerror="alert(1)">';
async function setup(
  change?: (r: ReturnType<typeof ratingResponse>) => void,
  changeData?: (data: IRatingInitialData) => void,
  finale?: { enabled: boolean; weight: number; multiplier?: number },
  existingWork?: AstraWork,
) {
  const raw = ratingResponse(); change?.(raw);
  const data = ratingInitialResponse(raw, 1, 42)!;
  changeData?.(data);
  const sections = finale ? [{ id: 'finale', name: 'Finale', weight: finale.weight }] : [{ id: 'story', name: 'Story', weight: 1 }];
  const astra = { getFullWork: async () => existingWork ? structuredClone(existingWork) : undefined,
    getWorks: () => existingWork ? [existingWork] : [],
    saveWork: vi.fn(async (work: Partial<AstraWork> & { mediaId: number }, _skipAnilist?: boolean) => ({
      ...(existingWork ? structuredClone(existingWork) : {}), ...structuredClone(work),
      ownerId: work.ownerId ?? existingWork?.ownerId ?? 42, updatedAt: (existingWork?.updatedAt ?? 0) + 1,
    } as AstraWork)),
    getSettings: () => ({ enableSeriesFinale: finale?.enabled ?? false, finaleWeightMultiplier: finale?.multiplier ?? 2 }),
    hasFinaleSection: () => Boolean(finale), getSections: () => sections,
    calcSectionScore: () => 8, calcSeasonScore: () => 8 };
  const rating = { getMediaRatingData: async () => structuredClone(data),
    deleteEntry: vi.fn(async (_mediaId: number): Promise<'synced' | 'queued'> => 'synced'),
    saveAndSync: vi.fn(async (_work: AstraWork, _extra: AstraSaveOptions): Promise<AstraSaveResult> => 'local') };
  const toast = { error: vi.fn(), info: vi.fn() };
  const modal = new AstraRatingModal(astra as unknown as AstraService, { getCurrentUserId: async () => 42 } as IApiClient,
    { emit: vi.fn() } as unknown as IEventBus, toast as unknown as ToastService,
    rating as unknown as IAstraRatingService, new AstraOverlayService());
  await modal.open(1);
  const root = document.querySelector<HTMLElement>('.astra-modal-overlay')!;
  const input = (selector: string) => root.querySelector<HTMLInputElement>(selector)!;
  const save = () => (modal as unknown as { save(): Promise<void> }).save();
  const toggle = () => rerenderRatingModal(modal);
  return { modal, rating, root, input, save, toggle, astra, toast };
}

describe('Astra form consumer data preservation and safe rendering', () => {
  const modals: AstraRatingModal[] = [];
  beforeEach(() => {
    vi.useFakeTimers(); document.body.innerHTML = ''; document.body.style.overflow = ''; document.documentElement.style.overflow = '';
    Object.assign(chrome.runtime, { id: 'test' });
  });
  afterEach(async () => {
    for (const modal of modals.splice(0)) await modal.close();
    await vi.runOnlyPendingTimersAsync(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '';
    document.body.style.overflow = ''; document.documentElement.style.overflow = '';
  });
  const open = async (change?: Parameters<typeof setup>[0]) => { const value = await setup(change); modals.push(value.modal); return value; };

  it('renders and saves durable pending dates before a remote entry exists, including across a redraw', async () => {
    const f = await setup(raw => { Object.assign(raw.Media, { mediaListEntry: null }); }, data => {
      data.pendingDates = { startedAt: { year: 2027, month: null, day: 5 }, completedAt: null };
    });
    modals.push(f.modal);
    expect(f.input('#astra-start-date').value).toBe('2027');
    f.toggle();
    expect(document.querySelector<HTMLInputElement>('#astra-start-date')?.value).toBe('2027');
    document.querySelector<HTMLElement>('.astra-status-option[data-value="PLANNING"]')!.click();
    await f.save();
    expect(f.rating.saveAndSync.mock.calls[0][1]).toMatchObject({ startedAt: { year: 2027, month: null, day: 5 }, completedAt: null });
  });

  it('toggles Season Finale and Series Finale in the section title without an icon', async () => {
    const f = await setup(undefined, undefined, { enabled: true, weight: 0.5, multiplier: 3 });
    modals.push(f.modal);
    const title = f.root.querySelector<HTMLButtonElement>('[data-id="finale"] .astra-finale-title-toggle')!;
    expect(title.textContent).toBe('Season Finale');
    expect(title.getAttribute('aria-pressed')).toBe('false');
    expect(title.title).toContain('weight ×3');
    expect(f.root.querySelector('[data-id="finale"] .astra-finale-toggle')).toBeNull();
    expect(title.querySelector('i')).toBeNull();
    expect(f.root.querySelector('[data-id="finale"] .astra-weight-tag')?.textContent).toBe('w0.5');

    title.click();
    expect(title.textContent).toBe('Series Finale');
    expect(title.getAttribute('aria-pressed')).toBe('true');
    expect(f.root.querySelector('[data-id="finale"] .astra-weight-tag')?.textContent).toBe('w1.5');
    title.click();
    expect(title.textContent).toBe('Season Finale');
    expect(f.root.querySelector('[data-id="finale"] .astra-weight-tag')?.textContent).toBe('w0.5');
  });

  it('starts unlisted works at Add to List across redraws and requires an explicit status before saving', async () => {
    const f = await open(raw => { Object.assign(raw.Media, { mediaListEntry: null }); });
    expect(f.root.querySelector('#astra-status-label')?.textContent).toBe('Add to List');
    expect(f.input('#astra-status').value).toBe('');
    expect(f.root.querySelector('.astra-status-option.active')).toBeNull();
    await f.modal.close();
    expect(f.rating.saveAndSync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(350);
    await f.modal.open(1);
    expect(document.querySelector('#astra-save, #astra-nav-save')).toBeNull();
    f.toggle();
    expect(document.querySelector('#astra-status-label')?.textContent).toBe('Add to List');
    await expect(f.save()).rejects.toThrow('Choose a list status');
    expect(f.rating.saveAndSync).not.toHaveBeenCalled();
    document.querySelector<HTMLElement>('.astra-status-option[data-value="PLANNING"]')!.click();
    f.toggle();
    expect(document.querySelector('#astra-status-label')?.textContent).toBe('Planning');
    await f.save();
    expect(f.rating.saveAndSync.mock.calls[0][0].status).toBe('PLANNING');
  });

  it('uses durable queued status before asking for a status on a not-yet-created entry', async () => {
    const f = await setup(raw => { Object.assign(raw.Media, { mediaListEntry: null }); }, data => {
      data.pendingListState = { status: MediaListStatus.PLANNING, progress: 0, repeat: 2, customLists: [] };
    });
    modals.push(f.modal);
    expect(f.root.querySelector('#astra-status-label')?.textContent).toBe('Planning');
    expect(f.input('#astra-status').value).toBe(MediaListStatus.PLANNING);
    expect(f.input('#astra-progress').value).toBe('0');
    expect(f.input('#astra-repeat').value).toBe('2');
  });

  it('pulls AniList list fields into an existing Astra work before the next Quick Edit save', async () => {
    const existing: AstraWork = {
      id: 'existing', mediaId: 1, ownerId: 42, title: 'Old title', type: 'anime', status: MediaListStatus.PLANNING,
      progress: 0, customLists: [], tags: ['kept'], notes: 'Astra-only notes', updatedAt: 100,
      isPrivate: false, isHidden: false, startedAt: null, completedAt: null,
      seasons: [{ id: 's1', name: 'Season 1', scores: { story: 9 }, notes: 'Astra season notes' }],
    };
    const f = await setup(undefined, undefined, undefined, existing);
    modals.push(f.modal);

    expect(f.root.querySelector('#astra-status-label')?.textContent).toBe('Watching');
    expect(f.input('#astra-status').value).toBe('CURRENT');
    expect(f.input('#astra-progress').value).toBe('3');
    expect(f.astra.saveWork).toHaveBeenCalledTimes(1);
    expect(f.astra.saveWork.mock.calls[0][0]).toMatchObject({
      mediaId: 1, status: MediaListStatus.CURRENT, progress: 3, customLists: ['Favorites'],
      isPrivate: false, isHidden: false, startedAt: { year: 2026 },
    });
    expect(f.astra.saveWork.mock.calls[0][1]).toBe(true);
    const state = (f.modal as unknown as { state: { data: AstraWork } }).state;
    expect(state.data).toMatchObject({
      tags: ['kept'], notes: 'Astra-only notes', seasons: [{ scores: { story: 9 }, notes: 'Astra season notes' }],
    });

    f.input('#astra-progress').value = '4';
    f.input('#astra-progress').dispatchEvent(new Event('input', { bubbles: true }));
    await f.save();
    expect(f.rating.saveAndSync.mock.calls[0][0].status).toBe('CURRENT');
    expect(f.rating.saveAndSync.mock.calls[0][1].progress).toBe(4);
    const journal = f.rating.saveAndSync.mock.calls[0][0].seasons[0].episodeNotes!;
    expect(journal[4]).toEqual({ text: '', timestamp: expect.any(Number) });
    expect(journal[1]).toBeUndefined(); // Imported progress must not be backdated.
    expect(f.rating.saveAndSync.mock.calls[0][1]).not.toHaveProperty('notes');
    expect(f.rating.saveAndSync.mock.calls[0][1].syncAstraNotes).toBe(false);
  });

  it('sends an explicit Planning change without resubmitting unchanged AniList notes, including on retry', async () => {
    const f = await open();
    f.rating.saveAndSync.mockRejectedValueOnce(new Error('Queue storage failed')).mockResolvedValueOnce('synced');
    document.querySelector<HTMLElement>('.astra-status-option[data-value="PLANNING"]')!.click();

    await expect(f.save()).rejects.toThrow('Queue storage failed');
    await f.save();

    expect(f.rating.saveAndSync).toHaveBeenCalledTimes(2);
    for (const [work, extra] of f.rating.saveAndSync.mock.calls) {
      expect(work.status).toBe(MediaListStatus.PLANNING);
      expect(extra).not.toHaveProperty('notes');
      expect(extra.syncAstraNotes).toBe(false);
    }
  });

  it('selects and saves Planning after the host replaces the status icon with an SVG', async () => {
    const f = await open();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'astra-status-icon';
    f.root.querySelector('#astra-status-icon')!.replaceWith(svg);
    f.root.querySelector<HTMLElement>('.astra-status-option[data-value="PLANNING"]')!.click();
    expect(f.toast.error).not.toHaveBeenCalled();
    expect(f.root.querySelector('.astra-status-option.active')?.getAttribute('data-value')).toBe('PLANNING');
    await f.save();
    expect(f.rating.saveAndSync.mock.calls[0][0].status).toBe(MediaListStatus.PLANNING);
    expect(f.root.querySelector('#astra-status-icon')?.classList.contains('fa-clock')).toBe(true);
  });

  it('cancels deletion without saving or removing the entry', async () => {
    const f = await open(); vi.spyOn(window, 'confirm').mockReturnValue(false);
    f.root.querySelector<HTMLButtonElement>('#astra-delete-entry')!.click();
    await Promise.resolve();
    expect(f.rating.deleteEntry).not.toHaveBeenCalled();
    expect(f.rating.saveAndSync).not.toHaveBeenCalled(); expect(f.root.isConnected).toBe(true);
  });

  it.each(['synced', 'queued'] as const)('deletes an entry (%s) without auto-saving the form back into the list', async result => {
    const f = await open(); vi.spyOn(window, 'confirm').mockReturnValue(true);
    f.rating.deleteEntry.mockResolvedValue(result);
    const reload = vi.spyOn(f.modal as unknown as { reloadHost(): void }, 'reloadHost').mockImplementation(() => {});
    f.root.querySelector<HTMLElement>('.astra-status-option[data-value="PLANNING"]')!.click();
    f.root.querySelector<HTMLButtonElement>('#astra-delete-entry')!.click();
    await vi.waitFor(() => expect(f.root.isConnected).toBe(false));
    expect(f.rating.deleteEntry).toHaveBeenCalledExactlyOnceWith(1);
    expect(f.rating.saveAndSync).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(result === 'synced' ? 1 : 0);
    if (result === 'queued') expect(f.toast.info).toHaveBeenCalledWith(expect.stringContaining('Deletion queued'));
  });

  it('keeps the form and selected status editable if durable deletion cannot be accepted', async () => {
    const f = await open(); vi.spyOn(window, 'confirm').mockReturnValue(true);
    f.rating.deleteEntry.mockRejectedValueOnce(new Error('Storage failed'));
    f.root.querySelector<HTMLElement>('.astra-status-option[data-value="PLANNING"]')!.click();
    f.root.querySelector<HTMLButtonElement>('#astra-delete-entry')!.click();
    await vi.waitFor(() => expect(f.toast.error).toHaveBeenCalled());
    expect(f.root.isConnected).toBe(true); expect(f.root.inert).toBe(false);
    await f.save(); expect(f.rating.saveAndSync.mock.calls[0][0].status).toBe(MediaListStatus.PLANNING);
  });

  it('prevents editing while an accepted deletion is pending', async () => {
    const f = await setup(undefined, data => { data.pendingDeletion = true; }); modals.push(f.modal);
    expect(document.querySelector('.astra-modal-overlay')).toBeNull();
    expect(f.toast.info).toHaveBeenCalledWith(expect.stringContaining('queued for deletion'));
    expect(f.rating.saveAndSync).not.toHaveBeenCalled();
  });

  it('sends notes to AniList only when the user edits the notes field', async () => {
    const f = await open();
    const notes = f.root.querySelector<HTMLTextAreaElement>('#astra-general-notes')!;
    notes.value = 'New notes written by the user';
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    await f.save();
    expect(f.rating.saveAndSync.mock.calls[0][1].notes).toBe('New notes written by the user');
    expect(f.rating.saveAndSync.mock.calls[0][1].syncAstraNotes).toBe(true);
  });

  it('renders remote notes literally without creating elements', async () => {
    const { root, input } = await open(r => { r.Media.mediaListEntry.notes = malicious; });
    expect(root.querySelector('[data-injected]')).toBeNull();
    expect(input('#astra-general-notes').value).toBe(malicious);
  });

  it('preserves arbitrary list names as literal text and data attributes', async () => {
    const name = 'Favorites" ><img data-injected> & manga';
    const { root } = await open(r => {
      r.Viewer.mediaListOptions.animeList.customLists = [name];
      Object.assign(r.Media.mediaListEntry, { customLists: { [name]: true } });
    });
    expect(root.querySelector('[data-injected]')).toBeNull();
    expect(root.querySelector<HTMLInputElement>('.astra-custom-list-cb')?.dataset.name).toBe(name);
    expect(root.querySelector<HTMLInputElement>('.astra-custom-list-cb')?.checked).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', ''])('does not bind unsafe/empty cover %s', async cover => {
    const { root, input } = await open(r => { r.Media.coverImage.large = cover; });
    expect(root.querySelector('#astra-cover')?.hasAttribute('src')).toBe(false);
    input('#astra-cover').click();
    expect(document.querySelector('.astra-cover-full-overlay')).toBeNull();
  });

  it('binds a cover URL containing quotes without injecting HTML, also in its full view', async () => {
    const cover = 'https://example.com/medium/a" data-injected="yes.jpg';
    const { root, input } = await open(r => { r.Media.coverImage.large = cover; });
    expect(root.querySelector('[data-injected]')).toBeNull();
    input('#astra-cover').click();
    const image = document.querySelector<HTMLImageElement>('.astra-cover-full-img')!;
    expect(image.hasAttribute('data-injected')).toBe(false);
    expect(image.src).toContain('/large/');
    document.querySelector<HTMLElement>('.astra-cover-full-overlay')!.click();
  });

  it('retains lists and all unsaved quick-edit fields when the form rerenders', async () => {
    const { input, toggle, save, rating } = await open();
    input('#astra-progress').value = '0'; input('#astra-repeat').value = '2';
    input('#astra-general-notes').value = 'Edited & kept';
    input('#astra-private-cb').checked = true; input('#astra-hide-cb').checked = true;
    input('.astra-custom-list-cb').checked = false;
    input('#astra-start-date').value = '2026-02-03';
    toggle();
    const current = document.querySelector<HTMLElement>('.astra-modal-overlay')!;
    expect(current.querySelectorAll('.astra-custom-list-cb')).toHaveLength(1);
    expect(current.querySelector<HTMLInputElement>('#astra-general-notes')?.value).toBe('Edited & kept');
    expect(current.querySelector<HTMLInputElement>('#astra-progress')?.value).toBe('0');
    await save();
    expect(rating.saveAndSync.mock.calls[0][1]).toMatchObject({ progress: 0, repeat: 2, private: true, hidden: true,
      customLists: [], notes: 'Edited & kept', startedAt: { year: 2026, month: 2, day: 3 } });
  });

  it('roundtrips year-only dates through unrelated edits and saves', async () => {
    const { input, save, rating } = await open();
    input('#astra-general-notes').value = 'Other edit'; input('#astra-general-notes').dispatchEvent(new Event('input', { bubbles: true }));
    await save();
    expect(rating.saveAndSync.mock.calls[0][1].startedAt).toEqual({ year: 2026, month: null, day: null });
  });

  it('keeps a fuzzy date with no year until Clear is explicitly chosen', async () => {
    const { root, input, save, rating } = await open(r => { Object.assign(r.Media.mediaListEntry.startedAt, { year: null, month: 3, day: null }); });
    input('#astra-general-notes').dispatchEvent(new Event('input', { bubbles: true }));
    await save();
    expect(rating.saveAndSync.mock.calls[0][1].startedAt).toEqual({ year: null, month: 3, day: null });
    const picker = root.querySelector<HTMLElement>('[data-target="astra-start-date"]')!;
    picker.querySelector<HTMLButtonElement>('button')!.click();
    picker.querySelector<HTMLButtonElement>('[data-clear]')!.click();
    await save();
    expect(rating.saveAndSync.mock.calls[1][1].startedAt).toBeNull();
  });

  it.each(['2026-02-31', '2026-00-01', '2026-01-NaN', '2026-01-01-extra'])('rejects invalid entered date %s before persistence', async date => {
    const { input, save, rating } = await open();
    input('#astra-start-date').value = date; input('#astra-start-date').dispatchEvent(new Event('change', { bubbles: true }));
    await expect(save()).rejects.toThrow(/date/i);
    expect(rating.saveAndSync).not.toHaveBeenCalled();
    // Restore a valid field so lifecycle cleanup can close the view.
    input('#astra-start-date').value = '';
  });

  it('keeps DOM-only edits made during a save dirty for the next save', async () => {
    const { input, save, rating } = await open();
    input('#astra-general-notes').value = 'First'; input('#astra-general-notes').dispatchEvent(new Event('input', { bubbles: true }));
    let finish!: (result: 'local') => void;
    rating.saveAndSync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = save();
    input('#astra-general-notes').value = 'Second'; input('#astra-general-notes').dispatchEvent(new Event('input', { bubbles: true }));
    finish('local'); await pending; await save();
    expect(rating.saveAndSync).toHaveBeenCalledTimes(2);
    expect(rating.saveAndSync.mock.calls[1][1].notes).toBe('Second');
  });

  it('escapes imported section identifiers/names and episode notes without breaking score updates', async () => {
    const { modal, astra, root, toggle } = await open();
    const sectionId = 'story" ><img data-injected>';
    astra.getSections = () => [{ id: sectionId, name: '<img data-injected> Section', weight: 1 }];
    const internals = modal as unknown as { state: { data: AstraWork }; performLivePreview(): void };
    root.querySelector<HTMLTextAreaElement>('.astra-ep-textarea')!.value = malicious;
    toggle();
    const current = document.querySelector<HTMLElement>('.astra-modal-overlay')!;
    expect(current.querySelector('[data-injected]')).toBeNull();
    expect(current.querySelector<HTMLElement>('.astra-score-group')?.dataset.id).toBe(sectionId);
    expect(() => internals.performLivePreview()).not.toThrow();
    expect(current.querySelector<HTMLTextAreaElement>('.astra-ep-textarea')?.value).toBe(malicious);
    expect(root.isConnected).toBe(false);
  });

  it('uses the manga route for a manga title link', async () => {
    const { root } = await open(r => { r.Media.type = 'MANGA'; });
    expect(root.querySelector<HTMLAnchorElement>('.astra-title-link')?.pathname).toBe('/manga/1');
    expect(root.querySelector<HTMLAnchorElement>('.astra-title-link')?.rel).toContain('noopener');
  });

  it('removes its cover portal on close', async () => {
    const { modal, input } = await open();
    input('#astra-cover').click();
    expect(document.querySelector('.astra-cover-full-overlay')).not.toBeNull();
    await modal.close();
    expect(document.querySelector('.astra-cover-full-overlay')).toBeNull();
  });

  it.each(['-1', '2.5'])('does not truncate invalid repeat input %s into a save', async value => {
    const { input, save, rating } = await open();
    input('#astra-repeat').value = value; input('#astra-repeat').dispatchEvent(new Event('input', { bubbles: true }));
    await expect(save()).rejects.toThrow(/integer/);
    expect(rating.saveAndSync).not.toHaveBeenCalled(); input('#astra-repeat').value = '0';
  });

  it('does not select lists named after inherited Object properties', async () => {
    const { root } = await open(r => {
      r.Viewer.mediaListOptions.animeList.customLists = ['constructor', '__proto__', 'prototype'];
      Object.assign(r.Media.mediaListEntry, { customLists: {} });
    });
    expect(root.querySelectorAll('.astra-custom-list-cb:checked')).toHaveLength(0);
  });

  it('preserves year/month dates and uses their month in the calendar', async () => {
    const { root, input, save, rating } = await open(r => { Object.assign(r.Media.mediaListEntry.startedAt, { month: 3 }); });
    expect(input('#astra-start-date').value).toBe('2026-03');
    const picker = root.querySelector<HTMLElement>('[data-target="astra-start-date"]')!;
    picker.querySelector<HTMLButtonElement>('button')!.click();
    expect(picker.dataset.viewMonth).toBe('2');
    input('#astra-general-notes').dispatchEvent(new Event('input', { bubbles: true }));
    await save();
    expect(rating.saveAndSync.mock.calls[0][1].startedAt).toEqual({ year: 2026, month: 3, day: null });
  });

  it('allows replacing and clearing a complete date without losing the change at rerender', async () => {
    const { input, toggle, save, rating } = await open(r => { Object.assign(r.Media.mediaListEntry.startedAt, { month: 2, day: 28 }); });
    input('#astra-start-date').value = '2028-02-29'; toggle(); await save();
    expect(rating.saveAndSync.mock.calls[0][1].startedAt).toEqual({ year: 2028, month: 2, day: 29 });
    const current = document.querySelector<HTMLElement>('.astra-modal-overlay')!;
    const picker = current.querySelector<HTMLElement>('[data-target="astra-start-date"]')!;
    picker.querySelector<HTMLButtonElement>('button')!.click();
    picker.querySelector<HTMLButtonElement>('[data-clear]')!.click();
    await save(); expect(rating.saveAndSync.mock.calls[1][1].startedAt).toBeNull();
  });

  it('keeps meaningful spacing in episode notes through a mode change and save', async () => {
    const { root, toggle, save, rating } = await open();
    const text = '\n    indented note\n';
    root.querySelector<HTMLTextAreaElement>('.astra-ep-textarea')!.value = text;
    toggle(); await save();
    expect(rating.saveAndSync.mock.calls[0][0].seasons[0].episodeNotes?.[1].text).toBe(text);
  });

  it('releases the previous document handlers when the form rerenders', async () => {
    const add = vi.spyOn(document, 'addEventListener'); const remove = vi.spyOn(document, 'removeEventListener');
    const { toggle, modal } = await open(); toggle(); toggle(); await modal.close();
    for (const event of ['keydown', 'click']) {
      const callbacks = add.mock.calls.filter(call => call[0] === event).map(call => call[1]);
      for (const callback of callbacks) expect(remove.mock.calls.some(call => call[0] === event && call[1] === callback)).toBe(true);
    }
  });
  it('retains a journal calendar edit made during a pending save for the next save', async () => {
    const { root, input, save, rating, modal } = await open();
    input('#astra-general-notes').value = 'First save'; input('#astra-general-notes').dispatchEvent(new Event('input', { bubbles: true }));
    let finish!: (result: 'local') => void;
    rating.saveAndSync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = save();
    const picker = root.querySelector<HTMLElement>('[data-ep="1"].astra-ep-date-picker')!;
    picker.querySelector<HTMLButtonElement>('.astra-ep-date-trigger')!.click();
    const time = picker.querySelector<HTMLInputElement>('input[type="time"]')!; time.value = '06:12';
    const day = picker.querySelector<HTMLButtonElement>('[data-day]')!;
    const iso = day.dataset.day!; day.click();
    finish('local'); await pending;
    expect((modal as unknown as { state: { isDirty: boolean } }).state.isDirty).toBe(true);
    await save();
    const [year, month, date] = iso.split('-').map(Number);
    expect(rating.saveAndSync.mock.calls[1][0].seasons[0].episodeNotes?.[1].timestamp).toBe(new Date(year, month - 1, date, 6, 12).getTime());
  });

  it('keeps a form calendar edit during a pending save and ignores detached controls after rerender', async () => {
    const { root, input, save, rating, toggle, modal } = await open();
    input('#astra-general-notes').dispatchEvent(new Event('input', { bubbles: true }));
    let finish!: (result: 'local') => void;
    rating.saveAndSync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = save();
    const picker = root.querySelector<HTMLElement>('[data-target="astra-start-date"]')!;
    picker.querySelector<HTMLButtonElement>('.astra-dropdown-trigger')!.click();
    const day = picker.querySelector<HTMLButtonElement>('[data-day="2026-01-02"]')!; day.click();
    finish('local'); await pending;
    expect((modal as unknown as { state: { isDirty: boolean } }).state.isDirty).toBe(true);
    toggle();
    day.dataset.day = '2026-01-03'; day.click(); await save();
    expect(rating.saveAndSync.mock.calls[1][1].startedAt).toEqual({ year: 2026, month: 1, day: 2 });
  });

});
