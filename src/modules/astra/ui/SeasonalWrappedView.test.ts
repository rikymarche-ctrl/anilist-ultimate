import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seasonalData, seasonalEntry } from '@/test/seasonal-wrapped-fixtures';
import { SeasonalWrappedView } from './SeasonalWrappedView';
import { SeasonalWrappedService } from '../services/SeasonalWrappedService';
import { emptySeasonalChoices, seasonKey, type SeasonalChoices, type SeasonalPeriod } from '../services/SeasonalWrappedModel';
import * as imageExport from './SeasonalWrappedImage';

const views: SeasonalWrappedView[] = [];
// latestReleasedSeason() reads the clock and triggers a release-seen save that locks the
// controls. Pin Date so the latest released season (Winter 2027) is never visited here.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2027, 5, 1, 12)); });
afterEach(() => { for (const view of views.splice(0)) view.unmount(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function fixture() {
  const data = seasonalData([seasonalEntry({ title: '<img src=x onerror=alert(1)> Safe text' }),
    seasonalEntry({ mediaId: 2, title: 'Continuing title', endDate: { year: 2026, month: 9, day: 20 } }),
    seasonalEntry({ mediaId: 3, title: 'Undated title', startedAt: null, completedAt: null }),
    seasonalEntry({ mediaId: 4, title: 'Private title', private: true })]);
  const service = { load: vi.fn(async () => data), getChoices: SeasonalWrappedService.prototype.getChoices,
    saveChoices: vi.fn(async (_data: typeof data, period: SeasonalPeriod, choices: SeasonalChoices) => {
      const saved = { ...structuredClone(choices), updatedAt: choices.updatedAt + 1 }; data.backup.seasonalWrapped ??= {};
      data.backup.seasonalWrapped[seasonKey(period)] = saved; return saved;
    }) };
  const back = vi.fn(); const view = new SeasonalWrappedView(service as never, back); views.push(view);
  const root = () => view.getElement();
  const input = (name: string) => root().querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const spring = () => { input('year').value = '2026'; input('season').value = 'SPRING'; input('season').dispatchEvent(new Event('change')); };
  const mount = async () => { view.mount(document.body); await settle(); spring(); };
  return { view, root, input, mount, service, data, back, spring };
}

describe('Seasonal Wrapped view and ownership', () => {
  it('shows concluded rankings separately from continuing titles and escapes external text', async () => {
    const f = fixture(); await f.mount();
    expect(f.root().querySelector('.seasonal-podium')!.textContent).toContain('Safe text');
    expect(f.root().querySelector('.seasonal-podium')!.textContent).not.toContain('Continuing title');
    expect(f.root().querySelector('[data-seasonal-continuing]')!.textContent).toContain('Continuing title');
    expect(f.root().querySelector('[data-seasonal-continuing] strong')!.textContent).toBe('');
    expect(f.root().querySelector('img')).toBeNull(); expect(f.root().textContent).not.toContain('Private note');
    expect(f.root().querySelector<HTMLAnchorElement>('[data-seasonal-chart]')!.href).toBe('https://anichart.net/Spring-2026');
  });
  it('saves manual awards and participation, supports undo and keeps season choices separate', async () => {
    const f = fixture(); await f.mount();
    const award = f.root().querySelector<HTMLSelectElement>('[data-award="favorite"]')!;
    award.value = '1'; award.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(f.service.saveChoices).toHaveBeenCalledOnce();
    expect(f.data.backup.seasonalWrapped?.['2026-SPRING'].awards.favorite).toBe(1);
    f.root().querySelector<HTMLInputElement>('[data-confirm="3"]')!.click(); await settle();
    expect(f.root().querySelector('[data-confirm="3"]')).toBeNull();
    expect(f.root().querySelector('[data-unconfirm="3"]')).not.toBeNull();
    f.root().querySelector<HTMLButtonElement>('[data-unconfirm="3"]')!.click(); await settle();
    expect(f.root().querySelector('[data-confirm="3"]')).not.toBeNull();
    f.input('season').value = 'SUMMER'; f.input('season').dispatchEvent(new Event('change'));
    expect(f.root().querySelector<HTMLSelectElement>('[data-award="favorite"]')!.value).toBe('');
    f.spring(); expect(f.root().querySelector<HTMLSelectElement>('[data-award="favorite"]')!.value).toBe('1');
  });
  it('keeps private titles out of displayed choices until explicitly included', async () => {
    const f = fixture(); await f.mount(); const content = () => f.root().querySelector('[data-seasonal-results]')!.textContent;
    expect(content()).not.toContain('Private title');
    f.input('private').click(); expect(content()).toContain('Private title');
    f.input('private').click(); expect(content()).not.toContain('Private title');
  });
  it('keeps failed choices available for retry without allowing an outdated export', async () => {
    const f = fixture(); await f.mount(); f.service.saveChoices.mockRejectedValueOnce(new Error('Storage'));
    const award = f.root().querySelector<HTMLSelectElement>('[data-award="favorite"]')!; award.value = '1';
    award.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(f.root().textContent).toContain('Could not confirm saved picks');
    expect(f.root().querySelector<HTMLButtonElement>('[data-seasonal-export]')!.disabled).toBe(true);
    expect(f.root().querySelector<HTMLElement>('.seasonal-save-retry')!.hidden).toBe(false);
    f.root().querySelector<HTMLButtonElement>('[data-seasonal-retry]')!.click(); await settle();
    expect(f.root().querySelector<HTMLElement>('.seasonal-save-retry')!.hidden).toBe(true);
    expect(f.data.backup.seasonalWrapped?.['2026-SPRING'].awards.favorite).toBe(1);
  });
  it('can discard unsaved edits after a conflict and re-read the season', async () => {
    const f = fixture(); await f.mount(); f.service.saveChoices.mockRejectedValueOnce(new Error('Conflict'));
    const award = f.root().querySelector<HTMLSelectElement>('[data-award="favorite"]')!; award.value = '1'; award.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    f.root().querySelector<HTMLButtonElement>('[data-seasonal-discard]')!.click();
    expect(f.root().querySelector<HTMLSelectElement>('[data-award="favorite"]')!.value).toBe('');
  });
  it('ignores late collection and choice completions after unmount', async () => {
    const f = fixture(); let finish!: (value: typeof f.data) => void;
    f.service.load.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    f.view.mount(document.body); f.view.unmount(); finish(f.data); await settle();
    expect(f.root().querySelector('.seasonal-hero')).toBeNull();
    await f.mount(); let save!: (value: SeasonalChoices) => void;
    f.service.saveChoices.mockReturnValueOnce(new Promise(resolve => { save = resolve; }));
    const award = f.root().querySelector<HTMLSelectElement>('[data-award="favorite"]')!; award.value = '1'; award.dispatchEvent(new Event('change', { bubbles: true }));
    f.view.unmount(); save(emptySeasonalChoices()); await settle(); expect(f.root().isConnected).toBe(false);
  });
  it('retires pending PNG callbacks on period change or close', async () => {
    const f = fixture(); await f.mount(); const callbacks: BlobCallback[] = [];
    vi.spyOn(imageExport, 'drawSeasonalImage').mockReturnValue({ toBlob: (callback: BlobCallback) => { callbacks.push(callback); } } as HTMLCanvasElement);
    const createObjectURL = vi.fn(); const NativeURL = URL;
    vi.stubGlobal('URL', class extends NativeURL { static createObjectURL = createObjectURL; static revokeObjectURL = vi.fn(); });
    f.root().querySelector<HTMLButtonElement>('[data-seasonal-export]')!.click();
    f.input('season').value = 'SUMMER'; f.input('season').dispatchEvent(new Event('change')); callbacks[0](new Blob());
    expect(createObjectURL).not.toHaveBeenCalled(); f.spring();
    f.root().querySelector<HTMLButtonElement>('[data-seasonal-export]')!.click(); f.view.unmount(); callbacks[1](new Blob());
    expect(createObjectURL).not.toHaveBeenCalled();
  });
  it('clears stale output for invalid years and preserves the back action', async () => {
    const f = fixture(); await f.mount(); f.input('year').value = ''; f.input('year').dispatchEvent(new Event('change'));
    expect(f.root().querySelector('.seasonal-hero')).toBeNull();
    expect(f.root().querySelector<HTMLButtonElement>('[data-seasonal-export]')!.disabled).toBe(true);
    f.root().querySelector<HTMLButtonElement>('[data-seasonal-back]')!.click(); expect(f.back).toHaveBeenCalledOnce();
  });
  it('steps between seasons from the header without reloading the list', async () => {
    const f = fixture(); await f.mount();
    f.root().querySelector<HTMLButtonElement>('[data-seasonal-step="1"]')!.click();
    expect(f.input('season').value).toBe('SUMMER');
    expect(f.root().querySelector('[data-seasonal-period-label]')!.textContent).toBe('Summer 2026');
    expect(f.root().querySelector<HTMLAnchorElement>('[data-seasonal-chart]')!.href).toBe('https://anichart.net/Summer-2026');
    f.root().querySelector<HTMLButtonElement>('[data-seasonal-step="-1"]')!.click();
    f.root().querySelector<HTMLButtonElement>('[data-seasonal-step="-1"]')!.click();
    expect(f.input('season').value).toBe('WINTER');
    f.root().querySelector<HTMLButtonElement>('[data-seasonal-step="-1"]')!.click();
    expect(f.input('year').value).toBe('2025'); expect(f.input('season').value).toBe('FALL');
    expect(f.service.load).toHaveBeenCalledOnce();
  });
  it('stays on the awards slide after a pick is saved', async () => {
    const f = fixture(); await f.mount();
    const awardsSlide = () => f.root().querySelector('[data-award="favorite"]')!.closest<HTMLElement>('.aw-slide')!;
    const index = [...f.root().querySelectorAll('.aw-slide')].indexOf(awardsSlide());
    f.root().querySelector<HTMLButtonElement>(`[data-goto="${index}"]`)!.click();
    const award = f.root().querySelector<HTMLSelectElement>('[data-award="favorite"]')!; award.value = '1';
    award.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(awardsSlide().classList.contains('is-active')).toBe(true);
    expect(f.root().querySelector('.aw-story')!.classList.contains('aw-story--static')).toBe(true);
    expect(f.root().textContent).toContain('Anime of the season');
  });
});
