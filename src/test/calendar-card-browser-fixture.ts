/** Actual card and DI lifecycle over synthetic preferences/services in Chromium. */
import 'reflect-metadata';
import { container } from '@core/di/container';
import { TOKENS } from '@core/di/tokens';
import { CalendarStore } from '@modules/calendar/CalendarStore';
import { AnimeCard } from '@modules/calendar/components/AnimeCard';
import { SocialRenderer } from '@modules/social/SocialRenderer';
import { AstraRatingModal } from '@modules/astra/ui/AstraRatingModal';
import { DEFAULT_CALENDAR_PREFERENCES } from '@core/constants';
import type { AnimeEntry, CardOptions } from '@core/types';

export async function runCalendarCardBrowserFixture(): Promise<string[]> {
  const checks: string[] = [];
  const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
  const until = async (predicate: () => boolean): Promise<void> => {
    const deadline = performance.now() + 4000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error('Card fixture timed out');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  const store = new CalendarStore({ get: async () => null } as never, { create: () => ({}) } as never);
  store.setState({ preferences: { ...DEFAULT_CALENDAR_PREFERENCES, socialEnabled: true, socialShowAvatars: false } });
  let context = { userId: 1, sessionId: 'card-one' };
  let marks = 0; let edits = 0; let socialOpens = 0; let fail = false;
  let release: () => void = () => {};
  let paused = true;
  const portals: AbortController[] = [];
  const onMarkWatched = async (): Promise<void> => {
    marks++;
    if (fail) { fail = false; throw new Error('Synthetic card failure'); }
    if (paused) { paused = false; await new Promise<void>(resolve => { release = resolve; }); }
  };
  const anime: AnimeEntry = { id: 1, mediaId: 10, title: 'Title', cleanTitle: '<img onerror=alert(1)>', episode: 4,
    progress: 1, totalEpisodes: 12, dayOfWeek: 'Thursday', airingAt: new Date('2026-10-08T20:00:00Z'), timeUntilAiring: 3600,
    coverImage: 'javascript:alert(1)', siteUrl: 'javascript:alert(1)' };
  const options: CardOptions = { layoutMode: 'standard', showTime: true, showEpisodeNumbers: true, timeFormat: 'release',
    fullWidthImages: false, titleAlignment: 'left', columnJustify: 'top', maxCardsPerDay: 10, openInNewTab: true, astraEnabled: true, onMarkWatched };
  const child = container.createChildContainer();
  child.registerInstance('AnimeCardProps', { anime, options });
  child.registerInstance(TOKENS.CalendarStore, store);
  child.registerInstance(TOKENS.Config, { isFeatureEnabled: () => true });
  child.registerInstance(TOKENS.ApiClient, { getContext: () => context });
  child.registerInstance(TOKENS.CalendarService, { hasAired: () => false, isAiringSoon: () => false,
    formatAiringTime: (date: Date) => date.toISOString(), formatTimeUntilAiring: (seconds: number) => `${seconds}` });
  child.registerInstance(SocialRenderer, { attachPortal: () => { const portal = new AbortController(); portals.push(portal); return portal; } } as never);
  child.registerInstance(AstraRatingModal, { open: async () => { edits++; } } as never);
  const card = child.resolve(AnimeCard);
  const parent = document.createElement('div'); document.body.append(parent);
  const originalLocation = location.pathname + location.search + location.hash;
  const originalOpen = window.open;
  const opened: { url: string; target?: string; features?: string }[] = [];
  window.open = (url, target, features) => { opened.push({ url: String(url), target, features }); return null; };
  const socialHandler = () => { socialOpens++; };
  window.addEventListener('au-open-social-sidebar', socialHandler);
  const button = (action = 'mark-watched') => card.getElement().querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  try {
    history.replaceState({}, '', '/home'); card.mount(parent);
    assert(!card.getElement().classList.contains('anime-card--error') && !card.getElement().querySelector('img')?.hasAttribute('src'), 'unsafe images must be omitted without failing the card');
    assert(card.getElement().querySelector('.anime-card__title')?.textContent === anime.cleanTitle, 'title must remain literal text');
    card.getElement().click(); assert(opened.length === 0, 'unsafe media links must not open');
    card.update({ anime: { ...anime, siteUrl: 'https://anilist.co/anime/10/title' } }); card.getElement().click();
    assert(opened[0]?.features === 'noopener,noreferrer' && opened[0].target === '_blank', 'new tabs must isolate the opener');
    const avatar = document.createElement('span'); avatar.className = 'friend-avatar'; avatar.dataset.userName = 'Name /?日本';
    const avatarChild = document.createElement('span'); avatar.append(avatarChild); card.getElement().append(avatar); avatarChild.click();
    assert(opened[1]?.url === '/user/Name%20%2F%3F%E6%97%A5%E6%9C%AC' && opened[1].features === 'noopener,noreferrer', 'avatar descendants must use an encoded profile path');
    checks.push('child DI resolves the actual card; unsafe links/images and avatar paths are handled safely');

    button().click(); button().click(); assert(marks === 1 && button().disabled, 'one view must accept only one pending mark action');
    release(); await until(() => !button().disabled);
    fail = true; button().click(); await until(() => !button().disabled);
    button().click(); await until(() => !button().disabled);
    assert(marks === 3 && !!button().querySelector('.fa-plus'), 'rejected action must restore the icon and permit retry');
    checks.push('native controls prevent duplicate pending marks and recover after rejection');

    const root = card.getElement();
    card.update({ anime: { ...anime, episode: 7, progress: 2, cleanTitle: 'Changed', coverImage: '/safe.jpg',
      siteUrl: 'https://anilist.co/anime/10/title', airingAt: new Date('2026-10-09T19:00:00Z') } });
    assert(card.getElement() === root && root.querySelector<HTMLImageElement>('img')?.src === 'https://anilist.co/safe.jpg', 'same-media updates must refresh the image without remounting');
    assert(root.querySelector('.anime-card__time')?.textContent === '2026-10-09T19:00:00.000Z', 'airing time must reflect current props');
    button().dispatchEvent(new MouseEvent('mouseenter'));
    assert(document.querySelector('.au-card-tooltip')?.textContent === '4 episodes will remain', 'tooltip must include the already aired episode from the new props');
    root.dispatchEvent(new MouseEvent('mouseleave'));
    assert(!document.querySelector('.au-card-tooltip'), 'leaving a card must remove its owned tooltip');
    checks.push('surgical updates refresh cover/time and live tooltip values on the existing root');

    const staleSocial = button('social-activity');
    store.setState({ preferences: { ...store.getState().preferences, socialShowAvatars: true } });
    assert(portals.length === 1, 'avatar preference must attach one portal'); staleSocial.click();
    assert(socialOpens === 0, 'removed social controls must be inert');
    store.setState({ preferences: { ...store.getState().preferences, socialShowAvatars: false } });
    button('social-activity').click(); assert(socialOpens === 1 && portals[0].signal.aborted, 'current delegated social control must work after portal cleanup');
    checks.push('preference changes abort the portal and replace social controls without old callbacks');

    paused = true; button().click();
    // Let the host's SVG icon renderer settle before comparing detached markup.
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const stale = button();
    card.update({ options: { ...options, layoutMode: 'compact' } }); const staleContent = stale.innerHTML;
    release(); await until(() => !button().disabled);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert(stale.innerHTML === staleContent && !button().querySelector('.fa-spinner'), 'old completion must not mutate the detached button or the new view');
    context = { userId: 2, sessionId: 'card-two' };
    const counts = { marks, edits, socialOpens, opened: opened.length };
    button().click(); button('edit-entry').click(); button('social-activity').click(); card.getElement().click();
    assert(marks === counts.marks && edits === counts.edits && socialOpens === counts.socialOpens && opened.length === counts.opened, 'a card owned by an old account must not accept actions or links');
    card.unmount();
    assert(!parent.querySelector('.anime-card') && !document.querySelector('.au-card-tooltip') && !stale.classList.contains('au-pill-pressed'), 'unmount must remove UI and pressed feedback');
    checks.push('rerender/account/unmount protect detached controls, callbacks and pressed feedback');
    return checks;
  } finally {
    release(); card.unmount(); parent.remove(); window.open = originalOpen;
    window.removeEventListener('au-open-social-sidebar', socialHandler); history.replaceState({}, '', originalLocation);
  }
}
