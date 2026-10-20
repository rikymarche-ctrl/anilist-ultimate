import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimeCard } from './AnimeCard';
import { CalendarStore } from '../CalendarStore';
import { DEFAULT_CALENDAR_PREFERENCES } from '@core/constants';
import type { AnimeEntry, CardOptions } from '@core/types';
import type { ICalendarService } from '@core/interfaces/ICalendarService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { SocialRenderer } from '@modules/social/SocialRenderer';
import type { AstraRatingModal } from '@modules/astra/ui/AstraRatingModal';
import { formatAiringDay } from '../CalendarAiring';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function entry(patch: Partial<AnimeEntry> = {}): AnimeEntry {
  return { id: 1, mediaId: 10, title: 'Title', cleanTitle: 'Title', episode: 4,
    airingAt: new Date('2026-10-08T20:00:00Z'), timeUntilAiring: 3600, coverImage: 'https://example.com/cover.jpg',
    siteUrl: 'https://anilist.co/anime/10/title', progress: 1, totalEpisodes: 12, dayOfWeek: 'Thursday', ...patch };
}
const cards: AnimeCard[] = [];
function fixture(options: Partial<CardOptions> = {}, anime: Partial<AnimeEntry> = {}) {
  const store = new CalendarStore({ get: async () => null } as never, { create: () => ({}) } as never);
  store.setState({ preferences: { ...DEFAULT_CALENDAR_PREFERENCES, socialEnabled: true, socialShowAvatars: false } });
  const mark = vi.fn(async () => {});
  const props = { anime: entry(anime), options: { layoutMode: 'standard' as const, showTime: true, showEpisodeNumbers: true,
    timeFormat: 'release' as const, fullWidthImages: false, titleAlignment: 'left' as const, columnJustify: 'top' as const,
    maxCardsPerDay: 10, openInNewTab: true, astraEnabled: true, onMarkWatched: mark, ...options } };
  const service = { hasAired: () => false, isAiringSoon: () => false,
    formatAiringTime: (date: Date) => date.toISOString(), formatTimeUntilAiring: (seconds: number) => `remaining ${seconds}` };
  const portals: AbortController[] = [];
  const social = { attachPortal: vi.fn(() => { const controller = new AbortController(); portals.push(controller); return controller; }) };
  const rating = { open: vi.fn(async () => {}) };
  let context = { userId: 1, sessionId: 'one' };
  const api = { getContext: () => context };
  const card = new AnimeCard(props, store, service as unknown as ICalendarService, social as unknown as SocialRenderer,
    rating as unknown as AstraRatingModal, api as IApiClient);
  cards.push(card); card.mount(document.body);
  const button = (action = 'mark-watched') => card.getElement().querySelector<HTMLElement>(`[data-action="${action}"]`)!;
  return { card, store, mark, props, button, rating, social, service, portals, changeAccount: () => { context = { userId: 2, sessionId: 'two' }; } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T19:00:00Z')); history.replaceState({}, '', '/home'); });
afterEach(() => { for (const card of cards.splice(0)) card.unmount(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('AnimeCard airing time labels', () => {
  const timeText = (f: ReturnType<typeof fixture>) => f.card.getElement().querySelector('.anime-card__time')?.textContent;

  it.each(['release', 'countdown'] as const)('shows the real date for an airing a week or more away in %s mode', timeFormat => {
    const at = new Date('2026-10-15T20:00:00Z');
    const f = fixture({ timeFormat }, { airingAt: at, progress: 0 });
    expect(timeText(f)).toBe(`${formatAiringDay(at)} · ${at.toISOString()}`);
  });

  it('keeps the countdown for an airing inside the week', () => {
    const f = fixture({ timeFormat: 'countdown' }, { airingAt: new Date('2026-10-09T19:00:00Z'), progress: 0 });
    expect(timeText(f)).toBe('remaining 86400');
  });

  it('shows Aired in countdown mode once the airing time has passed instead of 0m', () => {
    const f = fixture({ timeFormat: 'countdown' }, { airingAt: new Date('2026-10-08T18:00:00Z'), progress: 0 });
    expect(timeText(f)).toBe('Aired');
  });
});

describe('AnimeCard links and surgical updates', () => {
  it('turns red and counts the newly aired episode without a progress edit or rerender', () => {
    const at = new Date('2026-10-08T20:00:00Z'); vi.setSystemTime(at.getTime() - 1000);
    const f = fixture({ timeFormat: 'countdown' }, { airingAt: at, progress: 3 });
    f.service.hasAired = () => Date.now() >= at.getTime();
    const root = f.card.getElement(); expect(root.classList.contains('anime-card--is-behind')).toBe(false);
    vi.setSystemTime(at); f.card.updateTime('countdown');
    expect(root.classList.contains('anime-card--aired')).toBe(true);
    expect(root.classList.contains('anime-card--is-behind')).toBe(true);
    expect(root.querySelector('.anime-card__episode')?.textContent).toBe('Ep 3/4/12');
    expect(root.querySelector('.behind-indicator')).not.toBeNull(); expect(f.card.getElement()).toBe(root);
  });
  it.each(['release', 'countdown'] as const)('updates status with hidden time in %s mode and restarts on a new provider date', timeFormat => {
    const at = new Date('2026-10-08T20:00:00Z'); vi.setSystemTime(at.getTime() - 1000);
    const f = fixture({ timeFormat, showTime: false }, { airingAt: at, progress: 3 });
    const root = f.card.getElement(); vi.setSystemTime(at); f.card.updateTime(timeFormat);
    expect(root.classList.contains('anime-card--is-behind')).toBe(true);
    f.card.update({ anime: entry({ episode: 5, progress: 4, airingAt: new Date(at.getTime() + 604800000) }) });
    expect(root.classList.contains('anime-card--is-behind')).toBe(false);
    expect(root.querySelector('.anime-card__episode')?.textContent).toBe('Ep 4/12');
    expect(root.querySelector('.anime-card__time')).toBeNull();
  });
  it.each(['standard', 'compact', 'extended'] as const)('retains a card with an unsafe cover in %s layout', layoutMode => {
    const { card } = fixture({ layoutMode }, { coverImage: 'javascript:alert(1)', cleanTitle: '<img onerror=alert(1)>' });
    expect(card.getElement().classList.contains('anime-card--error')).toBe(false);
    expect(card.getElement().querySelector('.anime-card__title')?.textContent).toBe('<img onerror=alert(1)>');
    expect(card.getElement().querySelector('img')?.hasAttribute('src')).not.toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script/>', 'file:///C:/private', 'https://[invalid'])('does not open an unsafe media URL: %s', siteUrl => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null); const { card } = fixture({}, { siteUrl });
    card.getElement().click(); expect(open).not.toHaveBeenCalled();
  });

  it('opens a web media link with opener isolation only for a new tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null); const f = fixture();
    f.card.getElement().click(); expect(open).toHaveBeenLastCalledWith(f.props.anime.siteUrl, '_blank', 'noopener,noreferrer');
    f.card.update({ options: { ...f.props.options, openInNewTab: false } });
    f.card.getElement().click(); expect(open).toHaveBeenLastCalledWith(f.props.anime.siteUrl, '_self');
  });

  it('encodes avatar names and recognizes clicks on their descendants', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null); const { card } = fixture();
    const avatar = document.createElement('span'); avatar.className = 'friend-avatar'; avatar.dataset.userName = 'Friend /?x#日本';
    const child = document.createElement('span'); avatar.append(child); card.getElement().append(avatar); child.click();
    expect(open).toHaveBeenCalledExactlyOnceWith('/user/Friend%20%2F%3Fx%23%E6%97%A5%E6%9C%AC', '_blank', 'noopener,noreferrer');
    avatar.dataset.userName = '\uD800'; avatar.click(); expect(open).toHaveBeenCalledTimes(1);
  });

  it('updates title, cover, time and tooltip episode values without replacing the card', () => {
    const f = fixture(); const root = f.card.getElement();
    f.card.update({ anime: entry({ episode: 7, progress: 2, cleanTitle: 'New title', coverImage: 'https://example.com/new.jpg', airingAt: new Date('2026-10-09T19:00:00Z') }) });
    expect(f.card.getElement()).toBe(root);
    expect(root.querySelector('img')?.src).toBe('https://example.com/new.jpg');
    expect(root.querySelector('img')?.alt).toBe('New title');
    expect(root.querySelector('.anime-card__time')?.textContent).toBe('2026-10-09T19:00:00.000Z');
    f.button().dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.au-card-tooltip')?.textContent).toBe('3 episodes will remain');
  });

  it('does not rewrite unchanged cover/time DOM on a progress-only update', () => {
    const f = fixture(); const root = f.card.getElement(); const observer = new MutationObserver(() => {});
    observer.observe(root.querySelector('img')!, { attributes: true });
    observer.observe(root.querySelector('.anime-card__time')!, { childList: true });
    f.card.update({ anime: { ...f.props.anime, progress: 2 } });
    expect(observer.takeRecords()).toHaveLength(0); observer.disconnect();
  });
});

describe('AnimeCard actions and lifecycle', () => {
  it('blocks repeat mark clicks while the accepted action is pending and then permits another', async () => {
    const f = fixture(); const gate = deferred(); f.mark.mockReturnValueOnce(gate.promise);
    f.button().click(); f.button().click();
    expect(f.mark).toHaveBeenCalledTimes(1); expect(f.button().querySelector('.fa-spinner')).not.toBeNull();
    gate.resolve(); await vi.advanceTimersByTimeAsync(0); f.button().click(); expect(f.mark).toHaveBeenCalledTimes(2);
  });

  it('restores the action after rejection and permits retry', async () => {
    const f = fixture(); f.mark.mockRejectedValueOnce(new Error('offline')); f.button().click(); await vi.advanceTimersByTimeAsync(0);
    expect(f.button().querySelector('.fa-plus')).not.toBeNull();
    expect((f.button() as HTMLButtonElement).disabled).toBe(false);
    f.button().click(); expect(f.mark).toHaveBeenCalledTimes(2);
  });

  it('contains rejected edit openings without leaving a tooltip or timer after unmount', async () => {
    const f = fixture(); f.rating.open.mockRejectedValueOnce(new Error('offline'));
    f.button('edit-entry').dispatchEvent(new MouseEvent('mouseenter'));
    f.button('edit-entry').click(); await vi.advanceTimersByTimeAsync(0); f.card.unmount();
    expect(f.rating.open).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector('.au-card-tooltip')).toBeNull();
  });

  it('allows icon transitions without hiding the tooltip and hides it when the root is left', () => {
    const f = fixture(); const button = f.button('edit-entry'); const icon = button.querySelector('i')!;
    button.dispatchEvent(new MouseEvent('mouseenter', { relatedTarget: document.body }));
    icon.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: button }));
    expect(document.querySelector('.au-card-tooltip')?.textContent).toBe('Quick edit');
    f.card.getElement().dispatchEvent(new MouseEvent('mouseleave'));
    expect(document.querySelector('.au-card-tooltip')).toBeNull();
  });

  it('clears pressed timers and old controls when unmounted', () => {
    const f = fixture(); f.button('edit-entry').click(); expect(vi.getTimerCount()).toBeGreaterThan(0);
    const old = f.button('edit-entry'); f.card.unmount(); expect(vi.getTimerCount()).toBe(0);
    old.click(); expect(f.rating.open).toHaveBeenCalledTimes(1);
    expect(old.classList.contains('au-pill-pressed')).toBe(false);
  });

  it('does not alter detached old controls when an accepted action finishes after rerender', async () => {
    const f = fixture(); const gate = deferred(); f.mark.mockReturnValueOnce(gate.promise);
    const old = f.button(); old.click(); f.card.update({ options: { ...f.props.options, layoutMode: 'compact' } });
    const oldContent = old.innerHTML; gate.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(old.innerHTML).toBe(oldContent); expect(f.button().querySelector('.fa-spinner')).toBeNull();
  });

  it('cannot clear a new view’s pending operation when the old one resolves', async () => {
    const f = fixture(); const old = deferred(); const current = deferred();
    f.mark.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    f.button().click(); f.card.unmount(); f.card.mount(document.body); f.button().click();
    old.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(f.button().querySelector('.fa-spinner')).not.toBeNull();
    f.button().click(); expect(f.mark).toHaveBeenCalledTimes(2);
    current.resolve(); await vi.advanceTimersByTimeAsync(0); expect(f.button().querySelector('.fa-plus')).not.toBeNull();
  });

  it('does not accept actions, links or completion UI from a previous account', async () => {
    const f = fixture(); const gate = deferred(); f.mark.mockReturnValueOnce(gate.promise);
    const open = vi.spyOn(window, 'open').mockReturnValue(null); const social = vi.fn(); window.addEventListener('au-open-social-sidebar', social);
    try {
      f.button().click(); const content = f.button().innerHTML; f.changeAccount(); gate.resolve(); await vi.advanceTimersByTimeAsync(0);
      expect(f.button().innerHTML).toBe(content);
      f.button().click(); f.button('edit-entry').click(); f.button('social-activity').click(); f.card.getElement().click();
      expect(f.mark).toHaveBeenCalledTimes(1); expect(f.rating.open).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(social).not.toHaveBeenCalled();
    } finally { window.removeEventListener('au-open-social-sidebar', social); }
  });

  it('keeps another card’s active tooltip when the first card unmounts', () => {
    const a = fixture(); const b = fixture({}, { mediaId: 20 });
    a.button('edit-entry').dispatchEvent(new MouseEvent('mouseenter')); b.button('social-activity').dispatchEvent(new MouseEvent('mouseenter'));
    a.card.unmount(); expect([...document.querySelectorAll<HTMLElement>('.au-card-tooltip')].some(tip => tip.textContent === 'Social Activity' && tip.style.display !== 'none')).toBe(true);
    b.card.unmount(); expect(document.querySelector('.au-card-tooltip')).toBeNull();
  });

  it('ignores removed social buttons while the delegated replacement still works', () => {
    const f = fixture(); const old = f.button('social-activity'); const handler = vi.fn(); window.addEventListener('au-open-social-sidebar', handler);
    try {
      f.store.setState({ preferences: { ...f.store.getState().preferences, socialShowAvatars: true } });
      old.click(); expect(handler).not.toHaveBeenCalled();
      f.store.setState({ preferences: { ...f.store.getState().preferences, socialShowAvatars: false } });
      f.button('social-activity').click(); expect(handler).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener('au-open-social-sidebar', handler); }
  });

  it('attaches no portal on an unmounted update and owns one per mounted view', () => {
    const f = fixture(); f.card.unmount();
    f.store.setState({ preferences: { ...f.store.getState().preferences, socialShowAvatars: true } });
    f.card.update({ anime: entry({ friendActivity: [] }) }); expect(f.social.attachPortal).not.toHaveBeenCalled();
    f.card.mount(document.body); expect(f.social.attachPortal).toHaveBeenCalledTimes(1);
    f.card.update({ options: { ...f.props.options, layoutMode: 'extended' } });
    expect(f.portals[0].signal.aborted).toBe(true); expect(f.social.attachPortal).toHaveBeenCalledTimes(2);
    f.card.unmount(); expect(f.portals[1].signal.aborted).toBe(true);
  });
});
