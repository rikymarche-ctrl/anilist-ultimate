/** Mounted calendar hierarchy and native DOM ownership over synthetic services. */
import '@/styles/calendar.css';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import { CalendarGrid } from '@modules/calendar/components/CalendarGrid';
import { CalendarStore } from '@modules/calendar/CalendarStore';
import { CalendarDataService } from '@modules/calendar/services/CalendarDataService';
import { EventBus } from '@core/events/EventBus';
import type { AnimeEntry } from '@core/types';
import { CalendarDomService } from '@modules/calendar/services/CalendarDomService';
import { SocialRenderer } from '@modules/social/SocialRenderer';
import { AstraRatingModal } from '@modules/astra/ui/AstraRatingModal';
import { DEFAULT_CALENDAR_PREFERENCES } from '@core/constants';
import { calendarEntry } from './calendar-fixtures';

export async function runCalendarGridBrowserFixture(): Promise<string[]> {
  const checks: string[] = [];
  const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
  const store = new CalendarStore({} as never, { create: () => ({}) } as never);
  store.setState({ entries: [calendarEntry(), calendarEntry(2), calendarEntry(3)],
    preferences: { ...DEFAULT_CALENDAR_PREFERENCES, maxCardsPerDay: 1, hideEmptyDays: true, socialEnabled: false } });
  const scope = container.createChildContainer(); scope.register(TOKENS.ComponentScope, { useFactory: child => child });
  scope.registerInstance(TOKENS.CalendarStore, store);
  scope.registerInstance(TOKENS.ApiClient, { getContext: () => ({ userId: 1, sessionId: 'grid-one' }) });
  scope.registerInstance(TOKENS.CalendarService, { hasAired: () => false, isAiringSoon: () => false,
    formatAiringTime: () => '20:00', formatTimeUntilAiring: () => 'remaining' });
  scope.registerInstance(SocialRenderer, { attachPortal: () => new AbortController() } as never);
  scope.registerInstance(AstraRatingModal, { open: async () => {} } as never);
  scope.registerInstance(TOKENS.Config, { isFeatureEnabled: () => true });
  let marks = 0; let finish!: () => void;
  const mark = () => { marks++; return new Promise<void>(resolve => { finish = resolve; }); };
  scope.registerInstance('CalendarGridProps', { onMarkWatched: mark, astraEnabled: true });
  const subscribe = store.subscribe.bind(store); let subscriptions = 0;
  store.subscribe = listener => {
    subscriptions++; const stop = subscribe(listener); let active = true;
    return () => { if (active) { active = false; subscriptions--; } stop(); };
  };
  const parent = document.createElement('div'); document.body.append(parent);
  const grid = scope.resolve(CalendarGrid);
  const dom = new CalendarDomService(scope);
  const cards = () => [...grid.getElement().querySelectorAll<HTMLElement>('.anime-card[data-media-id]')];
  const visible = () => cards().filter(card => getComputedStyle(card).display !== 'none').length;
  const toggle = () => grid.getElement().querySelector<HTMLButtonElement>('.calendar-day-column__toggle')!;
  try {
    assert(subscriptions === 0, 'construction must not activate child card subscriptions');
    grid.mount(parent); assert(cards().length === 3 && subscriptions === 4, 'received scope must resolve and mount the real hierarchy');
    checks.push('grid mounts scoped columns/cards only at mount and owns their subscriptions');

    assert(visible() === 1, 'production CSS must hide overflow cards'); toggle().click();
    assert(visible() === 3 && toggle().getAttribute('aria-expanded') === 'true', 'native toggle must expand mounted cards');
    toggle().click(); assert(visible() === 1, 'native toggle must collapse mounted cards');
    checks.push('native expand/collapse controls and production CSS reveal the intended overflow cards');

    const original = cards(); const button = original[0].querySelector<HTMLButtonElement>('[data-action="mark-watched"]')!;
    button.click(); store.updateEntry(1, { progress: 11 }); button.click();
    assert(cards().every((card, index) => card === original[index]) && marks === 1 && button.disabled,
      'progress-only updates must retain real pending card actions and roots');
    finish(); await Promise.resolve(); await Promise.resolve();
    checks.push('progress-only hierarchy updates preserve live card roots and pending action guards');

    const oldToggle = toggle(); grid.refresh(); oldToggle.click();
    assert(subscriptions === 4 && store.getState().expandedDays.size === 0, 'refresh must release old controls without accumulating subscriptions');
    checks.push('refresh replaces owned controls and leaves detached toggles inert');

    grid.unmount(); assert(subscriptions === 0, 'unmount must release every card and grid subscriber');
    store.setEntries([calendarEntry(4)]); grid.mount(parent);
    assert(cards().length === 1 && cards()[0].dataset.mediaId === '4' && subscriptions === 2, 'reopening must read the current store snapshot');
    grid.unmount(); checks.push('unmount/reopen cleans the hierarchy and renders current entries');

    parent.innerHTML = '<section class="list-preview-wrap"><div class="section-header"><h2>Airing</h2><button class="view-selector" style="display:inline-flex">View</button></div><div class="grid-wrap" style="display:grid"><div class="media-preview-card"></div></div></section>';
    const header = parent.querySelector<HTMLHeadingElement>('h2')!; const titleNode = header.firstChild;
    dom.findAiringSection = async () => header;
    let settings = 0; let newerSettings = 0;
    await dom.injectCalendar(() => { settings++; }, async () => {}, true);
    const oldSettings = parent.querySelector<HTMLButtonElement>('.calendar-header__settings')!;
    await dom.injectCalendar(() => { newerSettings++; }, async () => {}, true);
    oldSettings.click(); parent.querySelector<HTMLButtonElement>('.calendar-header__settings')!.click();
    assert(settings === 0 && newerSettings === 1, 'reinjection must bind the current settings callback and remove old controls');
    dom.showAuthPrompt(() => {}); assert(subscriptions === 0, 'auth prompt must tear down the grid hierarchy');
    dom.cleanup();
    assert(header.firstChild === titleNode && header.textContent === 'Airing'
      && parent.querySelector<HTMLElement>('.grid-wrap')!.style.display === 'grid'
      && parent.querySelector<HTMLElement>('.view-selector')!.style.display === 'inline-flex'
      && !parent.querySelector('.calendar-header__actions'), 'cleanup must restore original native nodes/styles and remove owned controls');
    checks.push('DOM reinjection/auth cleanup refreshes callbacks and restores native header nodes and styles');

    store.setEntries([]); let fail = true; let fetches = 0;
    let complete!: (entries: AnimeEntry[]) => void;
    const api = { getContext: () => ({ userId: 1, sessionId: 'grid-one' }), ensureContext: async () => ({ userId: 1, sessionId: 'grid-one' }) };
    const provider = { fetchAiringSchedule: async (): Promise<AnimeEntry[]> => {
      fetches++; if (fail) throw new Error('Synthetic provider failure: private diagnostic');
      return new Promise(resolve => { complete = resolve; });
    } };
    const data = new CalendarDataService(new EventBus(), provider as never, {} as never, store, api as never);
    grid.update({ onRetry: () => data.loadSchedule(1, true) }); grid.mount(parent);
    try { await data.loadSchedule(1, true); } catch { /* The provider failure is the fixture input. */ }
    assert(!!grid.getElement().querySelector('[role="alert"]') && !grid.getElement().textContent?.includes('private diagnostic')
      && !grid.getElement().classList.contains('calendar-grid__empty'), 'provider failure must not be presented as an empty schedule or leak diagnostics');
    checks.push('provider failures show accessible generic feedback instead of a false empty schedule');
    fail = false; const retryButton = grid.getElement().querySelector<HTMLButtonElement>('.calendar-grid__retry-btn')!;
    retryButton.click(); retryButton.click();
    for (let spin = 0; spin < 30 && !complete; spin++) await Promise.resolve();
    assert(fetches === 2 && retryButton.disabled && retryButton.getAttribute('aria-busy') === 'true', 'native retries must call the real data service exactly once while pending');
    complete([calendarEntry(7)]);
    for (let spin = 0; spin < 30 && !cards().length; spin++) await Promise.resolve();
    assert(cards().length === 1 && cards()[0].dataset.mediaId === '7' && !grid.getElement().querySelector('[role="alert"]'), 'confirmed provider recovery must clear error feedback and publish returned cards');
    checks.push('native retry uses the real data service, blocks duplicates and recovers returned episodes');
    const loadedCard = cards()[0]; fail = true;
    try { await data.loadSchedule(1, true); } catch { /* Failed refresh retains previously loaded entries. */ }
    assert(cards()[0] === loadedCard && !!grid.getElement().querySelector('[role="alert"]'), 'failed refresh must preserve mounted card identities with failure feedback');
    checks.push('provider refresh failure preserves loaded cards and labels stale data');

    grid.unmount(); const beforeInjectedRetry = fetches;
    await dom.injectCalendar(() => {}, async () => {}, true, () => true, () => data.loadSchedule(1, true));
    const injectedRetry = parent.querySelector<HTMLButtonElement>('.calendar-grid__retry-btn')!;
    injectedRetry.click();
    for (let spin = 0; spin < 30 && fetches === beforeInjectedRetry; spin++) await Promise.resolve();
    assert(fetches === beforeInjectedRetry + 1, 'injected DOM hierarchy must forward retry to the connected provider');
    dom.cleanup(); injectedRetry.click();
    assert(fetches === beforeInjectedRetry + 1, 'cleanup must disconnect old injected retry controls');
    checks.push('DOM-injected provider retry reaches the data service and detached controls remain inert');
    return checks;
  } finally { grid.unmount(); dom.cleanup(); parent.remove(); }
}
