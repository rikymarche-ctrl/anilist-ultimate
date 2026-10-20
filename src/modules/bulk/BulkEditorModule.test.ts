import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { BulkEditorModule } from './BulkEditorModule';
import type { BulkSnapshot } from './BulkEditorService';

const snapshot = (): BulkSnapshot => ({
  context: { sessionId: 'a', userId: 10 },
  ownerId: 10,
  ownerName: 'ExAstra',
  type: 'ANIME',
  lists: ['Priority', 'Seasonal'],
  entries: new Map(
    [1, 2, 3].map((id) => [id, { id: id + 100, mediaId: id, status: 'PLANNING', customLists: [] }])
  ),
});
const row = (id: number, type = 'anime', extra = '') =>
  `<div class="entry row" ${extra}><a class="title" href="/${type}/${id}/Title">Title ${id}</a><span class="progress">0/12</span></div>`;
const layout = () =>
  `<div class="medialist"><div class="filters-wrap"></div><div class="lists"><div class="list-entries">${row(1)}${row(2)}${row(1)}${row(3, 'anime', 'style="display:none"')}</div></div></div>`;
function click(text: string) {
  const target = [...document.querySelectorAll<HTMLButtonElement>('.au-bulk-toolbar button')].find(
    (node) => node.textContent === text
  );
  expect(target, text).toBeTruthy();
  target!.click();
}
function choose(id = 1) {
  document.querySelector<HTMLInputElement>(`.au-bulk-check[value="${id}"]`)!.click();
}
function setList(name: string, value: string) {
  const select = document.querySelector<HTMLSelectElement>(`[aria-label="Custom list: ${name}"]`)!;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
function stopButton() {
  return [...document.querySelectorAll<HTMLButtonElement>('.au-bulk-toolbar button')].find(
    (node) => node.textContent === 'Stop'
  )!;
}
function applyButton() {
  return document.querySelector<HTMLButtonElement>('button[type=submit]')!;
}
function swallowNavigation() {
  document.addEventListener('click', (event) => event.preventDefault(), { once: true });
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
async function hold() {
  const target = document.querySelector<HTMLElement>('.entry .title')!;
  vi.useFakeTimers();
  try {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await vi.advanceTimersByTimeAsync(500);
    window.dispatchEvent(new Event('pointerup'));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  } finally {
    vi.useRealTimers();
  }
}

describe('bulk editor list integration', () => {
  const instances: BulkEditorModule[] = [];
  beforeEach(() => {
    history.replaceState({}, '', '/user/ExAstra/animelist');
    document.body.innerHTML = layout();
  });
  afterEach(async () => {
    for (const module of instances.splice(0)) await module.destroy();
    document.body.replaceChildren();
    history.replaceState({}, '', '/');
  });
  function fixture() {
    const bus = new EventBus();
    let observe = () => {};
    const observer = {
      register: vi.fn((_name, callback) => {
        observe = callback;
      }),
      unregister: vi.fn(),
    };
    const service = {
      load: vi.fn(async () => snapshot()),
      viewerName: vi.fn(async (): Promise<string | null> => 'ExAstra'),
      apply: vi.fn(async (_snapshot, selected: number[], _edit, _active, saved, _stop: () => boolean) => {
        for (const [index, id] of selected.entries()) saved(id, index + 1, selected.length);
        return { saved: selected, remaining: [], failed: null };
      }),
    };
    const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const module = new BulkEditorModule(service as never, observer as never, bus, toast as never);
    instances.push(module);
    return { module, service, bus, observer, observe: () => observe(), toast };
  }
  async function open() {
    const f = fixture();
    await f.module.init();
    await settle();
    await hold();
    await settle();
    click('Clear selection');
    return f;
  }

  it('loads lazily, enables checkboxes and synchronizes duplicates without opening native editors', async () => {
    const f = fixture();
    await f.module.init();
    expect(f.service.load).not.toHaveBeenCalled();
    expect(document.querySelector('.au-bulk-toolbar')).toBeNull();
    const native = vi.fn();
    document.querySelector('.entry')!.addEventListener('click', native);
    await settle();
    await hold();
    await settle();
    expect(document.querySelectorAll('.au-bulk-check')).toHaveLength(4);
    expect(document.querySelector<HTMLInputElement>('.au-bulk-check')!.disabled).toBe(false);
    expect(native).not.toHaveBeenCalled();
    expect(document.querySelector('strong')!.textContent).toBe('1 selected');
    expect(
      [...document.querySelectorAll<HTMLInputElement>('.au-bulk-check[value="1"]')].every(
        (input) => input.checked
      )
    ).toBe(true);
  });
  it('selects unique displayed entries, excluding hidden rows, and clears selection', async () => {
    await open();
    click('Select visible');
    expect(document.querySelector('strong')!.textContent).toBe('2 selected');
    expect(document.querySelector<HTMLInputElement>('.au-bulk-check[value="3"]')!.checked).toBe(
      false
    );
    click('Clear selection');
    expect(document.querySelector('strong')!.textContent).toBe('0 selected');
  });
  it('decorates newly loaded/recycled rows and preserves selections through filters', async () => {
    const f = await open();
    choose();
    const entries = document.querySelector('.list-entries')!;
    entries.innerHTML = row(2);
    f.observe();
    expect(document.querySelector('strong')!.textContent).toBe('1 selected');
    click('Edit selected');
    expect(document.querySelector('[data-bulk-preview]')!.textContent).toContain('hidden');
    entries.insertAdjacentHTML('beforeend', row(1));
    f.observe();
    expect(document.querySelector<HTMLInputElement>('.au-bulk-check[value="1"]')!.checked).toBe(
      true
    );
    const second = document.querySelector<HTMLElement>('.entry')!;
    second.querySelector('a')!.href = '/anime/3';
    f.observe();
    expect(second.querySelector<HTMLInputElement>('input')!.value).toBe('3');
  });
  it('keeps applying disabled until a field changes and sends only explicit edits', async () => {
    const f = await open();
    choose();
    click('Edit selected');
    const submit = document.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(submit.disabled).toBe(true);
    const list = document.querySelector<HTMLSelectElement>('[aria-label="Custom list: Priority"]')!;
    list.value = 'add';
    list.dispatchEvent(new Event('change', { bubbles: true }));
    expect(submit.disabled).toBe(false);
    submit.click();
    await settle();
    expect(f.service.apply).not.toHaveBeenCalled();
    expect(submit.textContent).toContain('Confirm');
    submit.click();
    await settle();
    expect(f.service.apply.mock.calls[0][1]).toEqual([1]);
    expect(f.service.apply.mock.calls[0][2]).toEqual({ lists: { Priority: 'add' } });
    expect(document.querySelector('strong')!.textContent).toBe('0 selected');
    expect(document.querySelector('[role=status]')!.textContent).toContain('1 entries saved');
  });
  it('retains unconfirmed selections on partial failure and offers a refresh', async () => {
    const f = await open();
    click('Select visible');
    click('Edit selected');
    f.service.apply.mockImplementation(async (_snapshot, _selected, _edit, _active, saved) => {
      saved(1, 1, 2);
      return { saved: [1], failed: 2, remaining: [2] } as never;
    });
    const status = document.querySelector<HTMLSelectElement>('[aria-label=Status]')!;
    status.value = 'CURRENT';
    status.dispatchEvent(new Event('change', { bubbles: true }));
    applyButton().click();
    applyButton().click();
    await settle();
    expect(document.querySelector('strong')!.textContent).toBe('1 selected');
    expect(document.querySelector('[role=status]')!.textContent).toContain(
      'may already have reached AniList'
    );
    expect(
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Reload page'
      )
    ).toBe(true);
  });
  it('removes controls on foreign profiles and ignores late reads', async () => {
    const f = fixture();
    let resolve!: (value: BulkSnapshot) => void;
    f.service.load.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    await f.module.init();
    await settle();
    await hold();
    history.replaceState({}, '', '/user/Other/animelist');
    f.bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: location.pathname,
      previousPath: '/user/ExAstra/animelist',
      timestamp: new Date(),
    });
    resolve(snapshot());
    await settle();
    expect(document.querySelector('.au-bulk-toolbar')).toBeNull();
    expect(document.querySelector('.au-bulk-check')).toBeNull();
  });
  it('resets on account changes and leaves retained detached controls inert', async () => {
    const f = await open();
    choose();
    click('Edit selected');
    const old = document.querySelector('form')!;
    f.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    expect(document.querySelector('.au-bulk-check')).toBeNull();
    await hold();
    await settle();
    old.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(f.service.apply).not.toHaveBeenCalled();
  });
  it('remounts after native root replacement and cleans up without disturbing native nodes', async () => {
    const f = await open();
    const previous = document.querySelector('.medialist')!;
    previous.outerHTML = layout();
    f.observe();
    expect(document.querySelector('.au-bulk-toolbar')).toBeNull();
    await settle();
    await hold();
    await settle();
    await f.module.destroy();
    expect(document.querySelector('.au-bulk-toolbar')).toBeNull();
    expect(document.querySelector('.au-bulk-check')).toBeNull();
    expect(document.querySelectorAll('.entry')).toHaveLength(4);
    expect(document.querySelector('.au-bulk-row')).toBeNull();
  });
  it('shows retry on a failed read and never mutates automatically', async () => {
    const f = fixture();
    f.service.load.mockRejectedValueOnce(new Error('offline'));
    await f.module.init();
    await settle();
    await hold();
    await settle();
    expect(document.querySelector('[role=status]')!.textContent).toContain('Could not load');
    click('Retry');
    await settle();
    expect(document.querySelectorAll('.au-bulk-check')).toHaveLength(4);
    expect(f.service.apply).not.toHaveBeenCalled();
  });
  it("does not create controls on other users' lists", async () => {
    history.replaceState({}, '', '/user/Other/mangalist');
    const f = fixture();
    await f.module.init();
    expect(document.querySelector('.au-bulk-toolbar')).toBeNull();
    expect(f.service.load).not.toHaveBeenCalled();
  });
  it('requires a second Apply click before any write starts', async () => {
    const f = await open();
    choose();
    click('Edit selected');
    setList('Priority', 'add');
    applyButton().click();
    await settle();
    expect(f.service.apply).not.toHaveBeenCalled();
    expect(applyButton().textContent).toBe('Confirm: add to Priority for 1 entries');
    applyButton().click();
    await settle();
    expect(f.service.apply).toHaveBeenCalledTimes(1);
  });
  it('drops an unconfirmed Apply after a few seconds', async () => {
    const f = await open();
    choose();
    click('Edit selected');
    setList('Priority', 'add');
    vi.useFakeTimers();
    try {
      applyButton().click();
      expect(applyButton().textContent).toContain('Confirm');
      vi.advanceTimersByTime(5000);
    } finally {
      vi.useRealTimers();
    }
    expect(applyButton().textContent).toBe('Apply to 1 entries');
    expect(f.service.apply).not.toHaveBeenCalled();
  });
  it('resets a pending confirmation when the chosen edit changes', async () => {
    const f = await open();
    choose();
    click('Edit selected');
    setList('Priority', 'add');
    applyButton().click();
    setList('Priority', 'remove');
    expect(applyButton().textContent).toBe('Apply to 1 entries');
    applyButton().click();
    await settle();
    expect(f.service.apply).not.toHaveBeenCalled();
    expect(applyButton().textContent).toBe('Confirm: remove from Priority for 1 entries');
  });
  it('offers Stop only while saving and ends the run after the current request', async () => {
    const f = await open();
    choose(1);
    choose(2);
    click('Edit selected');
    const status = document.querySelector<HTMLSelectElement>('[aria-label=Status]')!;
    status.value = 'CURRENT';
    status.dispatchEvent(new Event('change', { bubbles: true }));
    expect(stopButton().disabled).toBe(true);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.service.apply.mockImplementationOnce((async (
      _snapshot: unknown,
      selected: number[],
      _edit: unknown,
      _active: unknown,
      _saved: unknown,
      stop: () => boolean
    ) => {
      await gate;
      return stop()
        ? { saved: [], failed: null, remaining: selected, reason: 'stopped' }
        : { saved: selected, failed: null, remaining: [] };
    }) as never);
    applyButton().click();
    applyButton().click();
    await settle();
    expect(stopButton().disabled).toBe(false);
    click('Stop');
    expect(stopButton().disabled).toBe(true);
    release();
    await settle();
    expect(f.toast.warn).toHaveBeenCalledWith('Bulk edit stopped: 0 of 2 saved.', { duration: 0 });
    expect(document.querySelector('[role=status]')!.textContent).toContain('Stopped: 0 of 2');
  });
  it('summarises an interrupted save in a persistent toast after leaving the page', async () => {
    const f = await open();
    choose(1);
    choose(2);
    click('Edit selected');
    setList('Priority', 'add');
    f.service.apply.mockImplementationOnce((async (
      _snapshot: unknown,
      _selected: unknown,
      _edit: unknown,
      _active: unknown,
      saved: (id: number, done: number, total: number) => void
    ) => {
      saved(1, 1, 2);
      history.replaceState({}, '', '/user/Other/animelist');
      f.bus.emit(EVENT_TYPES.PAGE_CHANGED, {
        path: location.pathname,
        previousPath: '/user/ExAstra/animelist',
        timestamp: new Date(),
      });
      return { saved: [1], failed: 2, remaining: [2] };
    }) as never);
    applyButton().click();
    applyButton().click();
    await settle();
    expect(f.toast.warn).toHaveBeenCalledWith('Bulk edit interrupted: 1 of 2 saved.', {
      duration: 0,
    });
  });
  it('explains a queue pause without suggesting a connection failure', async () => {
    const f = await open();
    click('Select visible');
    click('Edit selected');
    setList('Priority', 'add');
    f.service.apply.mockImplementationOnce((async (
      _snapshot: unknown,
      _selected: unknown,
      _edit: unknown,
      _active: unknown,
      saved: (id: number, done: number, total: number) => void
    ) => {
      saved(1, 1, 2);
      return { saved: [1], failed: 2, remaining: [2], reason: 'queue' };
    }) as never);
    applyButton().click();
    applyButton().click();
    await settle();
    const text = document.querySelector('[role=status]')!.textContent!;
    expect(text).toContain('Paused: other Astra changes are syncing. Retry in a moment.');
    expect(text).not.toContain('Check your connection');
  });
  it("activates on the signed-in viewer's own list under any username", async () => {
    history.replaceState({}, '', '/user/Riccardo/animelist');
    const f = fixture();
    f.service.viewerName.mockResolvedValue('riccardo');
    await f.module.init();
    await settle();
    await hold();
    await settle();
    expect(document.querySelectorAll('.au-bulk-check')).toHaveLength(4);
  });
  it("stays inactive on another user's list", async () => {
    history.replaceState({}, '', '/user/Other/animelist');
    const f = fixture();
    await f.module.init();
    await settle();
    swallowNavigation();
    await hold();
    await settle();
    expect(document.querySelector('.au-bulk-toolbar')).toBeNull();
    expect(document.querySelector('.au-bulk-check')).toBeNull();
    expect(f.service.load).not.toHaveBeenCalled();
  });
  it('stays inactive for signed-out visitors', async () => {
    const f = fixture();
    f.service.viewerName.mockResolvedValue(null);
    await f.module.init();
    await settle();
    swallowNavigation();
    await hold();
    await settle();
    expect(document.querySelector('.au-bulk-toolbar')).toBeNull();
    expect(f.service.load).not.toHaveBeenCalled();
  });
});
