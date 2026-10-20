import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './SettingsPanel';
import { CalendarStore } from '../CalendarStore';
import { DEFAULT_CALENDAR_PREFERENCES } from '@core/constants';
import type { CalendarPreferences } from '@core/types';

function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const panels: SettingsPanel[] = [];
function fixture() {
  let preferences: CalendarPreferences = { ...DEFAULT_CALENDAR_PREFERENCES };
  const store = {
    getState: () => ({ preferences }),
    savePreferences: vi.fn(async (patch: Partial<CalendarPreferences>): Promise<void> => { preferences = { ...preferences, ...patch }; }),
    resetPreferences: vi.fn(async (): Promise<void> => { preferences = { ...DEFAULT_CALENDAR_PREFERENCES }; }),
  };
  const onClose = vi.fn(); const panel = new SettingsPanel({ onClose }, store as never); panels.push(panel); panel.mount(document.body);
  return { panel, store, onClose, root: () => panel.getElement() };
}
function change(root: HTMLElement, setting: string, value: string | boolean, event = 'change') {
  const input = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-setting="${setting}"]`)!;
  if (typeof value === 'boolean') (input as HTMLInputElement).checked = value;
  else input.value = value;
  input.dispatchEvent(new Event(event, { bubbles: true }));
  return input;
}
const visibleIndicator = (root: HTMLElement) => root.querySelector('.settings-panel__error:not([hidden])');

beforeEach(() => { vi.useFakeTimers(); document.body.replaceChildren(); document.body.style.overflow = ''; });
afterEach(() => { panels.splice(0).forEach(panel => panel.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); document.body.style.overflow = ''; });

describe('calendar settings lifetime and save feedback', () => {
  it('keeps successful saves silent and restores a failed input so it can be retried', async () => {
    const f = fixture(); const pending = deferred(); f.store.savePreferences.mockReturnValueOnce(pending.promise);
    const input = change(f.root(), 'showTime', false) as HTMLInputElement;
    expect(visibleIndicator(f.root())).toBeNull();
    expect(f.root().querySelector('.settings-panel__header')?.textContent).not.toContain('All changes saved');
    pending.reject(new Error('disk failed'));
    await vi.waitFor(() => expect(visibleIndicator(f.root())?.textContent).toContain('could not be saved'));
    expect(input.checked).toBe(true);
    expect(f.root().querySelector<HTMLElement>('#time-format-field')?.style.display).toBe('block');
    change(f.root(), 'showTime', false);
    await vi.waitFor(() => expect(visibleIndicator(f.root())).toBeNull());
    expect(f.store.savePreferences).toHaveBeenCalledTimes(2);
  });

  it('does not restore a failed older value over a later edit of the same setting', async () => {
    const f = fixture(); const first = deferred(); const second = deferred();
    f.store.savePreferences.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    change(f.root(), 'maxCardsPerDay', '2', 'input');
    const input = change(f.root(), 'maxCardsPerDay', '5', 'input');
    first.reject(new Error('first failed'));
    await vi.waitFor(() => expect(f.store.savePreferences).toHaveBeenCalledTimes(2));
    expect(input.value).toBe('5');
    expect(f.root().querySelector('#maxCardsPerDayValue')?.textContent).toBe('5');
    second.resolve();
    await vi.waitFor(() => expect(visibleIndicator(f.root())?.textContent).toContain('could not be saved'));
  });

  it('ignores a completion from an earlier mount without feedback timers', async () => {
    const f = fixture(); change(f.root(), 'showTime', false);
    await vi.waitFor(() => expect(visibleIndicator(f.root())).toBeNull());
    expect(vi.getTimerCount()).toBe(0);
    const pending = deferred(); f.store.savePreferences.mockReturnValueOnce(pending.promise);
    change(f.root(), 'showTime', true); f.panel.unmount();
    expect(vi.getTimerCount()).toBe(0);
    f.panel.mount(document.body); pending.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(visibleIndicator(f.root())).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });

  it('restores the previous scroll style, removes Escape and closes only once', () => {
    document.body.style.overflow = 'clip'; const f = fixture();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(f.onClose).toHaveBeenCalledTimes(1); expect(document.body.style.overflow).toBe('clip');
  });

  it('preserves a scroll style installed by another owner while open', () => {
    const f = fixture(); document.body.style.overflow = 'scroll'; f.panel.unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('ignores setting names or enum values that do not match the preference contract', () => {
    const f = fixture(); const input = f.root().querySelector<HTMLInputElement>('[data-setting="showTime"]')!;
    input.dataset.setting = '__proto__'; input.dispatchEvent(new Event('change'));
    const select = f.root().querySelector<HTMLSelectElement>('[data-setting="layoutMode"]')!;
    select.append(new Option('bad', 'invalid')); select.value = 'invalid'; select.dispatchEvent(new Event('change'));
    expect(f.store.savePreferences).not.toHaveBeenCalled();
  });

  it('owns reload through a listener instead of an inline attribute and removes it on unmount', () => {
    const f = fixture(); const reload = vi.fn(); const nativeWindow = window;
    vi.stubGlobal('window', new Proxy(nativeWindow, { get(target, key) { return key === 'location' ? { reload } : Reflect.get(target, key, target); } }));
    const button = f.root().querySelector<HTMLButtonElement>('.settings-field__button')!;
    expect(button.hasAttribute('onclick')).toBe(false); button.click(); expect(reload).toHaveBeenCalledTimes(1);
    f.panel.unmount(); button.click(); expect(reload).toHaveBeenCalledTimes(1);
  });

  it('contains a failed reset and blocks duplicates until completion, then permits retry', async () => {
    const f = fixture(); const pending = deferred(); vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    f.store.resetPreferences.mockReturnValueOnce(pending.promise);
    const reset = f.root().querySelector<HTMLButtonElement>('.settings-panel__reset-link')!;
    reset.click(); reset.click(); expect(f.store.resetPreferences).toHaveBeenCalledTimes(1);
    pending.reject(new Error('reset failed'));
    await vi.waitFor(() => expect(visibleIndicator(f.root())?.textContent).toContain('could not be saved'));
    reset.click(); await vi.waitFor(() => expect(f.store.resetPreferences).toHaveBeenCalledTimes(2));
    expect(f.root().isConnected).toBe(true);
  });

  it('resets preferences without a confirmation dialog and leaves detached controls inert', async () => {
    const f = fixture(); const dialog = vi.spyOn(globalThis, 'confirm');
    const reset = f.root().querySelector<HTMLButtonElement>('.settings-panel__reset-link')!;
    expect(f.root().textContent).not.toContain('Danger Zone');
    expect(reset.classList.contains('settings-field__button')).toBe(true);
    reset.click(); await vi.waitFor(() => expect(f.store.resetPreferences).toHaveBeenCalledTimes(1));
    expect(dialog).not.toHaveBeenCalled();
    f.panel.unmount(); reset.click();
    expect(f.store.resetPreferences).toHaveBeenCalledTimes(1);
  });

  it('persists a change with the real store even after the panel closes, without reviving its UI', async () => {
    let resolve!: (value: boolean) => void;
    const write = new Promise<boolean>(yes => { resolve = yes; });
    const storage = { get: vi.fn(async () => null), set: vi.fn(() => write) };
    const store = new CalendarStore(storage as never, { create: () => ({}) } as never); await store.init();
    const panel = new SettingsPanel({ onClose: vi.fn() }, store); panels.push(panel); panel.mount(document.body);
    const root = panel.getElement(); change(root, 'showTime', false);
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1)); panel.unmount(); resolve(true);
    await vi.waitFor(() => expect(store.getState().preferences.showTime).toBe(false));
    expect(root.isConnected).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });

  it('remounts confirmed preferences instead of unsaved controls and preserves valid older limits', async () => {
    const f = fixture(); const pending = deferred(); f.store.savePreferences.mockReturnValueOnce(pending.promise);
    change(f.root(), 'showTime', false); f.panel.unmount();
    await f.store.savePreferences({ maxCardsPerDay: 20 }); f.panel.mount(document.body);
    expect(f.root().querySelector<HTMLInputElement>('[data-setting="showTime"]')?.checked).toBe(true);
    const range = f.root().querySelector<HTMLInputElement>('[data-setting="maxCardsPerDay"]')!;
    expect(range.max).toBe('20'); expect(range.value).toBe('20');
    expect(f.root().querySelector('#maxCardsPerDayValue')?.textContent).toBe('20');
    pending.reject(new Error('old write failed')); await Promise.resolve(); await Promise.resolve();
    expect(visibleIndicator(f.root())).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });

  it('saves a range only on input, keeps zero and avoids a duplicate write on release', async () => {
    const f = fixture(); const range = change(f.root(), 'maxCardsPerDay', '0', 'input');
    range.dispatchEvent(new Event('change'));
    expect(f.store.savePreferences).toHaveBeenCalledExactlyOnceWith({ maxCardsPerDay: 0 });
    expect(f.root().querySelector('#maxCardsPerDayValue')?.textContent).toBe('Unlimited');
    await vi.waitFor(() => expect(visibleIndicator(f.root())).toBeNull());
  });
});
