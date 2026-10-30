/** Production calendar settings/store over synthetic storage in isolated Chromium. */
import 'reflect-metadata';
import '@/styles/main.css';
import { CalendarStore } from '@modules/calendar/CalendarStore';
import { SettingsPanel } from '@modules/calendar/components/SettingsPanel';
import type { CalendarPreferences } from '@core/types';
import { ActivityRenderer } from '@modules/activity/shared/ActivityRenderer';
import type { AniListActivity } from '@modules/activity/ActivityUtils';
import { parseActivityPage } from '@modules/activity/ActivityResponse';
import { runCalendarCardBrowserFixture } from './calendar-card-browser-fixture';
import { runCalendarCacheBrowserFixture } from './calendar-cache-browser-fixture';
import { runCalendarScheduleBrowserFixture } from './calendar-schedule-browser-fixture';
import { runSyncResponseBrowserFixture } from './sync-response-browser-fixture';
import { runAstraRatingBrowserFixture } from './astra-rating-browser-fixture';
import { runAstraRatingFormBrowserFixture } from './astra-rating-form-browser-fixture';
import { runAstraRatingLifecycleBrowserFixture } from './astra-rating-lifecycle-browser-fixture';
import { runCalendarCoherenceBrowserFixture } from './calendar-coherence-browser-fixture';
import { runCalendarGridBrowserFixture } from './calendar-grid-browser-fixture';
import { runCalendarRolloverBrowserFixture } from './calendar-rollover-browser-fixture';

export async function runCalendarBrowserFixture(): Promise<string[]> {
  const checks: string[] = [];
  const assert = (condition: boolean, message: string): void => {
    if (!condition) throw new Error(message);
  };
  const until = async (predicate: () => boolean): Promise<void> => {
    const deadline = performance.now() + 4000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error('Calendar fixture timed out');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const writes: CalendarPreferences[] = [];
  let pause = true;
  let fail = false;
  let release!: (value: boolean) => void;
  const storage = {
    get: async () => ({ maxCardsPerDay: 20, startDay: 'today', showTime: 'invalid' }),
    set: async (_key: string, value: CalendarPreferences): Promise<boolean> => {
      writes.push({ ...value });
      if (fail) {
        fail = false;
        throw new Error('Synthetic storage failure');
      }
      if (pause) {
        pause = false;
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return true;
    },
  };
  const store = new CalendarStore(storage as never, { create: () => ({}) } as never);
  await store.init();
  let closed = 0;
  const panel = new SettingsPanel(
    {
      onClose: () => {
        closed++;
      },
    },
    store
  );
  const parent = document.createElement('div');
  document.body.append(parent);
  const previousOverflow = document.body.style.overflow;
  const previousConfirm = globalThis.confirm;
  document.body.style.overflow = 'clip';
  const input = (key: string): HTMLInputElement | HTMLSelectElement =>
    panel.getElement().querySelector(`[data-setting="${key}"]`)!;
  const change = (key: string, value: string | boolean, type = 'change'): void => {
    const control = input(key);
    if (typeof value === 'boolean') (control as HTMLInputElement).checked = value;
    else control.value = value;
    control.dispatchEvent(new Event(type, { bubbles: true }));
  };
  const feedback = (): string =>
    panel.getElement().querySelector('.settings-panel__error:not([hidden])')?.textContent || '';
  try {
    panel.mount(parent);
    const title = panel.getElement().querySelector('h2')!.getBoundingClientRect();
    const close = panel
      .getElement()
      .querySelector('.settings-panel__close')!
      .getBoundingClientRect();
    assert(
      Math.abs(title.y + title.height / 2 - close.y - close.height / 2) < 1,
      'calendar title and close button must share the vertical center'
    );
    assert(
      !panel.getElement().textContent?.includes('All changes saved'),
      'success text must be absent, including hidden layout'
    );
    const range = input('maxCardsPerDay') as HTMLInputElement;
    assert(
      range.value === '20' && range.max === '20' && input('startDay').value === 'today',
      'valid stored values must survive native range/select parsing'
    );
    assert(
      (input('showTime') as HTMLInputElement).checked,
      'invalid stored booleans must fall back to the default'
    );
    assert(
      !panel.getElement().querySelector('[onclick]'),
      'settings must have no inline event handlers'
    );
    checks.push('native settings controls preserve valid legacy values and omit inline event code');

    change('showTime', false);
    await until(() => writes.length === 1);
    change('layoutMode', 'compact');
    assert(
      writes.length === 1 && store.getState().preferences.showTime,
      'pending writes must stay ordered and uncommitted'
    );
    assert(
      !feedback().includes('All changes saved'),
      'pending storage must not be reported as saved'
    );
    release(true);
    await until(() => writes.length === 2 && store.getState().preferences.layoutMode === 'compact');
    assert(
      writes.length === 2 && !writes[1].showTime && writes[1].layoutMode === 'compact',
      'later patches must merge the confirmed earlier patch'
    );
    checks.push('rapid edits serialize and persist without success messages');

    fail = true;
    change('showTime', true);
    await until(() => feedback().includes('could not be saved'));
    assert(
      !(input('showTime') as HTMLInputElement).checked && !store.getState().preferences.showTime,
      'failed writes must restore confirmed controls and state'
    );
    change('showTime', true);
    await until(() => store.getState().preferences.showTime && feedback() === '');
    assert(store.getState().preferences.showTime, 'failed writes must permit retry');
    checks.push('storage failure restores the confirmed value and retry succeeds');

    const beforeRange = writes.length;
    change('maxCardsPerDay', '0', 'input');
    input('maxCardsPerDay').dispatchEvent(new Event('change'));
    await until(() => store.getState().preferences.maxCardsPerDay === 0);
    assert(
      writes.length === beforeRange + 1 && store.getState().preferences.maxCardsPerDay === 0,
      'range release must not duplicate the input write'
    );
    assert(
      panel.getElement().querySelector('#maxCardsPerDayValue')?.textContent === 'Unlimited',
      'zero must remain unlimited'
    );
    checks.push('native range input preserves zero without duplicate release writes');

    panel.getElement().querySelector<HTMLButtonElement>('[data-tab="system"]')!.click();
    globalThis.confirm = () => {
      throw new Error('Calendar reset must not ask for confirmation');
    };
    const oldRoot = panel.getElement();
    const beforeReset = writes.length;
    const reset = oldRoot.querySelector<HTMLButtonElement>('.settings-panel__reset-link')!;
    reset.click();
    reset.click();
    await until(() => panel.getElement() !== oldRoot);
    assert(
      writes.length === beforeReset + 1 && store.getState().preferences.layoutMode === 'standard',
      'reset must commit once and restore defaults'
    );
    assert(
      panel.getElement().querySelector('.settings-tab--active')?.getAttribute('data-tab') ===
        'system',
      'reset must preserve the selected tab'
    );
    checks.push('ordinary preference reset is single-flight and remounts the active tab');

    pause = true;
    change('showTime', false);
    await until(() => writes.length === beforeReset + 2);
    const detached = input('showTime');
    panel.getElement().querySelector<HTMLButtonElement>('.settings-panel__close')!.click();
    assert(
      document.body.style.overflow === 'clip' && closed === 1,
      'close must restore prior scroll state'
    );
    const afterClose = writes.length;
    detached.dispatchEvent(new Event('change'));
    release(true);
    await until(() => !store.getState().preferences.showTime);
    assert(
      writes.length === afterClose && !parent.querySelector('.settings-overlay'),
      'accepted write may finish without reviving a closed view'
    );
    panel.mount(parent);
    assert(
      !(input('showTime') as HTMLInputElement).checked,
      'remount must read confirmed preferences'
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    assert(
      closed === 2 && !parent.querySelector('.settings-overlay'),
      'Escape handler must close once and be removed'
    );
    checks.push('close/remount removes old controls and Escape while preserving accepted commits');

    const activity: AniListActivity = {
      id: 1,
      type: 'ANIME_LIST',
      createdAt: 1,
      replyCount: 0,
      likeCount: 0,
      user: { id: 2, name: 'Name /?x', avatar: { medium: 'javascript:alert(1)' } },
      media: {
        id: 3,
        type: 'ANIME',
        title: { romaji: 'Title' },
        coverImage: { medium: 'data:image/svg+xml,<svg/>' },
      },
    };
    const native = document.createElement('div');
    native.className = 'activity-anime';
    native.innerHTML =
      '<a class="avatar" href="/user/Other"></a><a class="name" href="/user/Other"></a><div class="status">Old activity</div><a class="cover"></a>';
    const renderer = new ActivityRenderer(
      { debug: () => {}, info: () => {} } as never,
      {
        isAuthenticated: () => true,
        mutate: () => Promise.resolve({}),
        mutateOnce: () => Promise.resolve({}),
      } as never,
      { info: () => {}, error: () => {}, warn: () => {} } as never
    );
    for (const clone of [false, true]) {
      if (clone) parent.append(native);
      const output = document.createElement('div');
      renderer.renderCustomActivities([activity], output);
      assert(
        output.querySelector<HTMLElement>('.avatar')?.style.backgroundImage === 'none' &&
          output.querySelector<HTMLElement>('.cover')?.style.backgroundImage === 'none',
        'production activity images must omit non-web schemes in both paths'
      );
    }
    checks.push(
      'production activity renderer rejects non-web images in manual and cloned native paths'
    );

    const valid = { ...activity, status: 'watched episode', progress: '3' };
    const parsed = parseActivityPage(
      { Page: { activities: [null, valid], pageInfo: { hasNextPage: true } } },
      { pageInfo: true, mediaId: 3 }
    );
    assert(
      parsed.hasNextPage && parsed.activities.length === 1,
      'nullable union rows must preserve pagination'
    );
    let rejected = false;
    try {
      parseActivityPage({ Page: { activities: [valid] } }, { mediaId: 4 });
    } catch {
      rejected = true;
    }
    assert(rejected, 'another media must not pass the requested activity identity');
    const output = document.createElement('div');
    renderer.renderCustomActivities(
      [
        { ...valid, status: {} },
        { ...valid, user: null, media: null },
      ] as unknown as AniListActivity[],
      output
    );
    assert(
      output.children.length === 1 &&
        output.querySelector('.status')?.textContent?.includes('Watched episode') === true,
      'a malformed row must not abort the valid deleted-media row'
    );
    assert(
      output.querySelector('.name')?.textContent === 'Unknown' &&
        !output.querySelector('.name')?.hasAttribute('href'),
      'unknown owner must not link to a different account'
    );
    parent.append(output);
    let retries = 0;
    renderer.showErrorMessage(output, () => {
      retries++;
    });
    const retry = output.querySelector<HTMLButtonElement>('button')!;
    retry.click();
    retry.click();
    assert(
      retries === 1 && !output.textContent?.includes('No activities found'),
      'failed requests must offer one retry, without becoming a confirmed empty feed'
    );
    checks.push(
      'activity page identity/nullability, defensive rendering and single-use error retry'
    );
    checks.push(...(await runCalendarCardBrowserFixture()));
    checks.push(...(await runCalendarRolloverBrowserFixture()));
    checks.push(...(await runCalendarCacheBrowserFixture()));
    checks.push(...(await runCalendarScheduleBrowserFixture()));
    checks.push(...(await runCalendarGridBrowserFixture()));
    checks.push(...(await runCalendarCoherenceBrowserFixture()));
    checks.push(...(await runSyncResponseBrowserFixture()));
    checks.push(...(await runAstraRatingBrowserFixture()));
    checks.push(...(await runAstraRatingFormBrowserFixture()));
    checks.push(...(await runAstraRatingLifecycleBrowserFixture()));
    return checks;
  } finally {
    panel.unmount();
    parent.remove();
    globalThis.confirm = previousConfirm;
    document.body.style.overflow = previousOverflow;
  }
}

/** Optional visual capture uses the same mounted production panel and synthetic storage. */
export async function mountCalendarSettingsPreview(): Promise<void> {
  const store = new CalendarStore(
    { get: async () => null, set: async () => true } as never,
    { create: () => ({}) } as never
  );
  await store.init();
  document.body.replaceChildren();
  const panel = new SettingsPanel({ onClose: () => panel.unmount() }, store);
  panel.mount(document.body);
  panel.getElement().querySelector<HTMLButtonElement>('[data-tab="system"]')!.click();
  // The options-page host hides its own sections; the AniList content page does not.
  panel.getElement().querySelector<HTMLElement>('.settings-section')!.style.display = 'block';
}
