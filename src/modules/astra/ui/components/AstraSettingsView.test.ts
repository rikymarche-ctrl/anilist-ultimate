import { afterEach, describe, expect, it, vi } from 'vitest';
import { AstraSettingsView } from './AstraSettingsView';
import type { AstraSection } from '../../AstraInterfaces';
import { DEFAULT_SETTINGS } from '../../utils/AstraConstants';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { ApiContext } from '@core/interfaces/IApiClient';
import { AstraService } from '../../AstraService';
import { AstraRepository } from '../../store/AstraRepository';
import { container } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';

const views: AstraSettingsView[] = [];
const nativeFileReader = globalThis.FileReader;
function fixture(section: AstraSection) {
  const dashboardStore = { getState: () => ({ separateAiring: true }), setSeparateAiring: vi.fn() };
  const view = new AstraSettingsView({
    getSections: () => [section],
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    getScoringMode: () => 'detailed',
    hasFinaleSection: () => false,
  } as never, {} as never, {} as never, new EventBus(), dashboardStore as never);
  views.push(view);
  view.mount(document.body);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.unmount();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.stubGlobal('FileReader', nativeFileReader);
});

function harness(weight = 1) {
  let context: ApiContext = { sessionId: 'account-a', userId: 1 };
  const sections: AstraSection[] = [{ id: 'story', name: 'Story', weight,
    subSections: [{ id: 'plot', name: 'Plot', weight: 0.5 }] }];
  const settings = { ...DEFAULT_SETTINGS };
  const service = {
    getSections: () => structuredClone(sections), getSettings: () => ({ ...settings }), getScoringMode: () => (settings.detailedScoring === false ? 'simple' : 'detailed'), hasFinaleSection: () => false,
    updateSectionWeight: vi.fn(async (_id: string, value: number) => { await Promise.resolve(); sections[0].weight = value; }),
    updateSubSectionWeight: vi.fn(async (_id: string, _sub: string, value: number) => { await Promise.resolve(); sections[0].subSections![0].weight = value; }),
    updateSubSectionName: vi.fn(async () => {}), addSubSection: vi.fn(async () => {}), removeSubSection: vi.fn(async () => {}),
    updateSectionName: vi.fn(async () => {}), addSection: vi.fn(async () => {}), removeSection: vi.fn(async () => {}),
    updateSettings: vi.fn(async (value: Partial<typeof settings>) => { Object.assign(settings, value); }),
    syncWithAniList: vi.fn(async () => ({ added: 1, updated: 0 })), exportJSON: vi.fn(async () => '{}'),
    importJSON: vi.fn(async () => true), factoryReset: vi.fn(async () => {}),
  };
  const toast = { error: vi.fn(), success: vi.fn(), info: vi.fn() };
  const bus = new EventBus();
  let separateAiring = true;
  const dashboardStore = {
    getState: () => ({ separateAiring }),
    setSeparateAiring: vi.fn((value: boolean) => { separateAiring = value; }),
  };
  const view = new AstraSettingsView(service as never, toast as never,
    { getContext: () => context } as never, bus, dashboardStore as never);
  views.push(view);
  view.mount(document.body);
  return { view, service, toast, bus, dashboardStore, setContext: (value: ApiContext) => { context = value; } };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function click(selector: string) { document.querySelector<HTMLElement>(selector)!.click(); }
function change(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  input.value = value; input.dispatchEvent(new Event('change'));
}

describe('Astra scoring configuration', () => {
  it.each([undefined, []])('opens a valid section with subsections %j', subSections => {
    const section: AstraSection = { id: 'story', name: 'Story', weight: 1 };
    if (subSections) section.subSections = subSections;
    expect(() => fixture(section)).not.toThrow();
    expect(document.querySelector<HTMLInputElement>('.astra-section-name-input')?.value).toBe('Story');
    expect(document.querySelector('.astra-subsections-grid')).toBeNull();
  });

  it('preserves subsection names and weights when they exist', () => {
    fixture({ id: 'story', name: 'Story', weight: 1,
      subSections: [{ id: 'plot', name: 'Plot', weight: 0.5 }] });
    expect(document.querySelector<HTMLInputElement>('.astra-sub-name-input')?.value).toBe('Plot');
    expect(document.querySelector<HTMLInputElement>('.astra-sub-weight-input')?.value).toBe('0.5');
  });
});

describe('Astra configuration persistence and lifecycle', () => {
  it('places Separate Airing first in Global Preferences and updates the saved switch', () => {
    const { dashboardStore } = harness();
    const globalPreferences = document.querySelectorAll('.astra-settings-section')[0];
    const items = globalPreferences.querySelectorAll('.astra-settings-item');
    expect(items[0].textContent).toContain('Separate Airing');
    expect(items[1].textContent).toContain('Series Finale Scoring');

    const toggle = document.querySelector<HTMLElement>('#astra-separate-airing-toggle')!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    toggle.click();
    expect(dashboardStore.setSeparateAiring).toHaveBeenCalledExactlyOnceWith(false);
    expect(toggle.classList.contains('active')).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('connects the existing subsection name and weight controls to persistence', async () => {
    const { service } = harness();
    change('.astra-sub-name-input', 'New plot');
    change('.astra-sub-weight-input', '0.75');
    await flush();
    expect(service.updateSubSectionName).toHaveBeenCalledWith('story', 'plot', 'New plot');
    expect(service.updateSubSectionWeight).toHaveBeenCalledWith('story', 'plot', 0.75);
  });
  it('restores the saved section and sub-section names when a blank name is entered', async () => {
    const { service, toast } = harness();
    change('.astra-section-name-input', '   ');
    change('.astra-sub-name-input', '');
    await flush();
    expect(document.querySelector<HTMLInputElement>('.astra-section-name-input')!.value).toBe('Story');
    expect(document.querySelector<HTMLInputElement>('.astra-sub-name-input')!.value).toBe('Plot');
    expect(service.updateSectionName).not.toHaveBeenCalled();
    expect(service.updateSubSectionName).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('previous name was restored'));
  });
  it('connects add/remove subsection controls while preserving cancellation', async () => {
    const { service } = harness();
    vi.spyOn(window, 'prompt').mockReturnValueOnce('  Dialogue  ').mockReturnValueOnce(null);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    click('.astra-add-sub'); await flush();
    click('.astra-add-sub'); await flush();
    click('.astra-remove-sub'); await flush();
    expect(service.addSubSection).toHaveBeenCalledExactlyOnceWith('story', 'Dialogue');
    expect(service.removeSubSection).toHaveBeenCalledExactlyOnceWith('story', 'plot');
  });
  it('serializes rapid section increments against the committed value', async () => {
    const { service } = harness();
    click('.inc-weight'); click('.inc-weight');
    await flush();
    expect(service.updateSectionWeight.mock.calls.map(call => call[1])).toEqual([1.25, 1.5]);
    expect(document.querySelector<HTMLInputElement>('.astra-weight-input')?.value).toBe('1.5');
  });
  it('preserves a zero weight when an invalid edit is rejected', () => {
    const { service } = harness(0);
    change('.astra-weight-input', '-1');
    expect(service.updateSectionWeight).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>('.astra-weight-input')?.value).toBe('0');
  });
  it('lets a step down reach the supported zero weight', async () => {
    const { service } = harness(0.25);
    click('.dec-weight'); await flush();
    expect(service.updateSectionWeight).toHaveBeenCalledWith('story', 0);
  });
  it('does not announce a sync that finishes after closing the view', async () => {
    const { view, service, toast } = harness();
    let finish!: (result: { added: number; updated: number }) => void;
    service.syncWithAniList.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    click('#astra-sync-list'); await flush();
    view.unmount(); finish({ added: 1, updated: 0 }); await flush();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('cancels sync refresh timers when the view is unmounted', async () => {
    vi.useFakeTimers();
    const { view } = harness();
    click('#astra-sync-list'); await flush();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects old queued writes when the public account context changes', async () => {
    const { service, setContext } = harness();
    click('.inc-weight');
    setContext({ sessionId: 'account-b', userId: 2 });
    await flush();
    expect(service.updateSectionWeight).not.toHaveBeenCalled();
  });
  it('removes account subscriptions on teardown and cancels old pending sync results', async () => {
    const { view, service, toast, bus } = harness();
    let finish!: (result: { added: number; updated: number }) => void;
    service.syncWithAniList.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    click('#astra-sync-list'); await flush();
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    finish({ added: 1, updated: 0 }); await flush();
    expect(toast.success).not.toHaveBeenCalled();
    view.unmount();
    expect(bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0);
  });
  it('serializes subsection increments and rejects invalid weights', async () => {
    const { service, toast } = harness();
    change('.astra-sub-weight-input', '-1');
    expect(toast.error).toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>('.astra-sub-weight-input')?.value).toBe('0.5');
    click('.inc-sub-weight'); click('.inc-sub-weight'); await flush();
    expect(service.updateSubSectionWeight.mock.calls.map(call => call[2])).toEqual([0.75, 1]);
    expect(document.querySelector<HTMLInputElement>('.astra-sub-weight-input')?.value).toBe('1');
  });
  it('contains failed saves, restores persisted settings and accepts an explicit retry', async () => {
    const { service, toast } = harness();
    service.updateSettings.mockRejectedValueOnce(new Error('synthetic failed write'));
    const getFinaleToggle = () => document.querySelector<HTMLElement>('[data-setting="enableSeriesFinale"]')!;
    const initial = getFinaleToggle().classList.contains('active');
    getFinaleToggle().click(); await flush();
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Could not save configuration. Please try again.');
    expect(getFinaleToggle().classList.contains('active')).toBe(initial);
    getFinaleToggle().click(); await flush();
    expect(service.updateSettings).toHaveBeenCalledTimes(2);
    expect(getFinaleToggle().classList.contains('active')).toBe(!initial);
  });
  it('starts only one sync when clicked repeatedly while pending', async () => {
    const { service } = harness();
    service.syncWithAniList.mockImplementation(() => new Promise(() => {}));
    click('#astra-sync-list'); click('#astra-sync-list'); await flush();
    expect(service.syncWithAniList).toHaveBeenCalledTimes(1);
  });
});

class ControlledReader {
  static LOADING = 1;
  static instances: ControlledReader[] = [];
  readyState = 0;
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  abort = vi.fn(() => { this.readyState = 2; this.onabort?.(); });
  constructor() { ControlledReader.instances.push(this); }
  readAsText() { this.readyState = 1; }
  finish() { this.result = '{}'; this.readyState = 2; this.onload?.(); }
}
function chooseBackup(file = new File(['{}'], 'fixture.json')) {
  ControlledReader.instances = [];
  vi.stubGlobal('FileReader', ControlledReader);
  const clicks = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  click('#astra-import-json');
  const input = clicks.mock.contexts.at(-1) as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new Event('change'));
  return { input, reader: ControlledReader.instances.at(-1)! };
}

describe('Astra backup UI ownership and resources', () => {
  it('aborts a pending file read on close and cannot import its late result', async () => {
    const { view, service } = harness();
    const { reader } = chooseBackup();
    view.unmount(); reader.finish(); await flush();
    expect(reader.abort).toHaveBeenCalledTimes(1);
    expect(service.importJSON).not.toHaveBeenCalled();
    expect(document.querySelector('.astra-import-overlay')).toBeNull();
  });
  it('cancels a reader at account change and removes the obsolete picker callback', async () => {
    const { bus, service } = harness();
    const { input, reader } = chooseBackup();
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    reader.finish(); await flush();
    expect(input.onchange).toBeNull();
    expect(reader.abort).toHaveBeenCalledTimes(1);
    expect(service.importJSON).not.toHaveBeenCalled();
  });
  it('removes import overlay, animation, interval and reload timers on close', async () => {
    vi.useFakeTimers();
    const { view, service } = harness();
    const { reader } = chooseBackup(); reader.finish(); await flush();
    expect(service.importJSON).toHaveBeenCalledWith('{}');
    expect(document.querySelector('.astra-import-overlay')).not.toBeNull();
    view.unmount();
    expect(document.querySelector('.astra-import-overlay')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps committed import results from announcing or reloading another account', async () => {
    vi.useFakeTimers();
    const { service, bus, toast } = harness();
    let finish!: (value: boolean) => void;
    service.importJSON.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { reader } = chooseBackup(); reader.finish(); await flush();
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    finish(true); await flush();
    expect(toast.success).not.toHaveBeenCalled();
    expect(document.querySelector('.astra-import-overlay')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('releases failed import resources and enables retry', async () => {
    vi.useFakeTimers();
    const { service, toast } = harness();
    service.importJSON.mockResolvedValue(false);
    const { reader } = chooseBackup(); reader.finish(); await flush();
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector('.astra-import-overlay')).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Import failed: Invalid format.');
    expect(document.querySelector<HTMLButtonElement>('#astra-import-json')?.disabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reports file read errors without sending any import', async () => {
    const { service, toast } = harness();
    const { reader } = chooseBackup(); reader.readyState = 2; reader.onerror?.(); await flush();
    expect(service.importJSON).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Import failed: Could not read the file.');
    expect(document.querySelector<HTMLButtonElement>('#astra-import-json')?.disabled).toBe(false);
  });
});

describe('Astra configuration durable integration', () => {
  it('persists subsection edits and rapid increments through the real facade/repository and reloads them', async () => {
    const values = new Map<string, unknown>();
    const storage = {
      get: async (key: string) => structuredClone(values.get(key) ?? null),
      set: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); return true; },
      setMultiple: async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value));
        return true;
      },
      remove: async (key: string) => { values.delete(key); return true; },
    };
    const bus = new EventBus();
    const repository = new AstraRepository(bus, storage as never);
    await repository.init();
    await repository.updateSections([{ id: 'story', name: 'Story', weight: 1,
      subSections: [{ id: 'plot', name: 'Plot', weight: 0.5 }] }]);
    await repository.saveWork({ mediaId: 42, notes: 'Preserved note', progress: 7,
      seasons: [{ scores: { story: 8, plot: 7 } }] });
    const service = new AstraService(bus, {} as never, repository, {} as never, {} as never, {} as never);
    const dependencies = container.createChildContainer();
    dependencies.register(TOKENS.AstraService, { useValue: service });
    dependencies.register(TOKENS.ToastService, { useValue: { error: vi.fn(), info: vi.fn(), success: vi.fn() } });
    dependencies.register(TOKENS.ApiClient, { useValue: {} });
    dependencies.register(TOKENS.EventBus, { useValue: bus });
    dependencies.register(TOKENS.AstraStore, { useValue: {
      getState: () => ({ separateAiring: true }), setSeparateAiring: vi.fn(),
    } });
    const view = dependencies.resolve(AstraSettingsView);
    views.push(view); view.mount(document.body);
    change('.astra-sub-name-input', 'Dialogue');
    change('.astra-sub-weight-input', '0.75');
    click('.inc-weight'); click('.inc-weight');
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('.astra-weight-input')?.value).toBe('1.5'));
    view.unmount();
    const reopened = new AstraRepository(new EventBus(), storage as never);
    await reopened.init();
    expect(reopened.getSections()).toEqual([{ id: 'story', name: 'Story', weight: 1.5,
      subSections: [{ id: 'plot', name: 'Dialogue', weight: 0.75 }] }]);
    expect(await reopened.getFullWork(42)).toMatchObject({ notes: 'Preserved note', progress: 7,
      seasons: [{ scores: { story: 8, plot: 7 } }] });
  });
});
