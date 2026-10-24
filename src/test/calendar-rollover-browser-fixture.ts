import { CalendarService } from '@modules/calendar/CalendarService';
import { CalendarStore } from '@modules/calendar/CalendarStore';
import { AnimeCard } from '@modules/calendar/components/AnimeCard';
import { EventBus } from '@core/events/EventBus';
import { DEFAULT_CALENDAR_PREFERENCES } from '@core/constants';
import { calendarEntry } from './calendar-fixtures';
import type { CardOptions } from '@core/types';

export async function runCalendarRolloverBrowserFixture(): Promise<string[]> {
  const checks: string[] = [];
  const assert = (value: boolean, message: string) => { if (!value) throw new Error(message); };
  const originalClock = Date.now; let now = originalClock(); Date.now = () => now;
  const parent = document.createElement('div'); document.body.append(parent);
  const store = new CalendarStore({} as never, { create: () => ({}) } as never);
  store.setState({ preferences: { ...DEFAULT_CALENDAR_PREFERENCES, socialEnabled: false } });
  const service = new CalendarService({} as never, new EventBus(), {} as never, {} as never);
  const context = { userId: 1, sessionId: 'rollover' };
  const entry = { ...calendarEntry(1), episode: 4, progress: 3, totalEpisodes: 12, airingAt: new Date(now + 1000) };
  const options: CardOptions = { ...DEFAULT_CALENDAR_PREFERENCES, astraEnabled: true, onMarkWatched: async () => {} };
  const card = new AnimeCard({ anime: entry, options: { ...options, timeFormat: 'countdown' } }, store, service,
    { attachPortal: () => new AbortController() } as never, { open: async () => {} } as never, { getContext: () => context } as never,
    { isFeatureEnabled: () => true } as never);
  try {
    card.mount(parent); const root = card.getElement(); const control = root.querySelector('[data-action="mark-watched"]');
    assert(!root.classList.contains('anime-card--is-behind'), 'future episode must not appear behind');
    now += 1000; card.updateTime('countdown');
    assert(root.classList.contains('anime-card--is-behind') && root.classList.contains('anime-card--aired'), 'airing boundary must update status in place');
    assert(root.querySelector('.anime-card__episode')?.textContent === 'Ep 3/4/12', 'newly aired episode must count immediately');
    assert(getComputedStyle(root, '::before').backgroundColor === 'rgb(255, 79, 79)', 'production red stripe must become visible');
    checks.push('native clock boundary updates red production CSS, available episodes and indicator without rerender');
    card.update({ anime: { ...entry, episode: 5, progress: 4, airingAt: new Date(now + 604800000) } });
    assert(card.getElement() === root && root.querySelector('[data-action="mark-watched"]') === control, 'provider rollover must preserve the active controls');
    assert(!root.classList.contains('anime-card--is-behind') && root.querySelector('.anime-card__time')?.textContent !== '0m', 'new provider date must restart the countdown');
    checks.push('fresh provider episode restarts the countdown and preserves native controls');
    card.update({ options: { ...options, showTime: false, timeFormat: 'release' }, anime: { ...entry, airingAt: new Date(now + 1000) } });
    now += 1000; card.updateTime('release');
    assert(card.getElement().classList.contains('anime-card--is-behind') && !card.getElement().querySelector('.anime-card__time'), 'hidden/release time still needs live status');
    checks.push('release and hidden-time layouts also update airing status and progress');
    return checks;
  } finally { card.unmount(); parent.remove(); Date.now = originalClock; }
}
