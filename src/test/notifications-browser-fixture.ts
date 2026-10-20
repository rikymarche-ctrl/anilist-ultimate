import 'reflect-metadata';
import '@/styles/notification-cleaner.css';
import { GraphQLBatcher } from '@core/api/GraphQLBatcher';
import { EventBus } from '@core/events/EventBus';
import { NotificationCleanerModule } from '@/modules/notifications/NotificationCleanerModule';
import { NotificationFetchService } from '@/modules/notifications/services/NotificationFetchService';
import { NotificationGroupService } from '@/modules/notifications/services/NotificationGroupService';
import { NotificationFilterService } from '@/modules/notifications/services/NotificationFilterService';
import { nativeActivity, nativeAddition as added, nativeChanges, nativeForum as forum, nativeNotificationCSS } from './fixtures/anilist-notifications';
import { MSG } from '@shared/messages';

const assert = (value: boolean, text: string) => { if (!value) throw new Error(text); };
const until = async (predicate: () => boolean) => {
  const deadline = performance.now() + 12000;
  while (!predicate()) { if (performance.now() > deadline) throw new Error('Notification fixture timeout'); await new Promise(resolve => setTimeout(resolve, 10)); }
};
let dispose: (() => Promise<void>) | undefined;

export async function runNotificationsBrowserFixture(): Promise<string[]> {
  history.replaceState({}, '', '/notifications');
  const activity = (id: number, wording?: string) => nativeActivity(id, 'Alice', wording);
  const changes = (id: number) => nativeChanges(id, 'Manga ' + id);
  const messages = [61, 62, 63].map(id => nativeActivity(id, 'murrkino', 'sent you a message.')).join('')
    + nativeActivity(64, 'Other', 'sent you a message.');
  document.body.innerHTML = `<style>
    :root{font-size:10px;--au-primary:#3db4f2;--au-bg:#151f2e;--au-text:#bcbedc;--au-text-secondary:#94a5b5;--au-transition:120ms;--au-border:#273449;--color-foreground:21,31,46;--color-blue:61,180,242;--color-text:168,184,200;--color-text-lighter:128,147,165}
    *{box-sizing:border-box}body{background:#0b1622;color:#a8b8c8;font:14px Arial,sans-serif;margin:28px auto;max-width:680px;width:calc(100% - 32px)!important;min-width:0!important}
    body::before,body::after{display:none!important}.notifications{display:block!important;height:auto!important;overflow:visible!important;width:100%}
    h1{font-size:23px;color:#e0e8ef}.reset-btn{display:none}a{color:#3db4f2;text-decoration:none}
    .avatar,.cover{background:linear-gradient(140deg,#22475a,#407690)}.cover{background:linear-gradient(140deg,#584031,#9b7568)}.reason-text{font-size:12px;margin-top:10px}
    ${nativeNotificationCSS}
  </style><h1>Notifications</h1><button class="reset-btn">Mark all as read</button><div class="notifications">${activity(11)}${added(50, 'Single title')}${activity(7)}${activity(8)}${activity(9, 'liked your activity reply.')}${activity(10, "replied to activity you're subscribed to.")}${added(1, 'RESPAWN!!')}${added(2, 'Beyond the Clouds, Only Me Downwind')}${added(3, 'AIYOU')}${changes(20)}${changes(21)}${forum('twilight1234')}${forum('putrid4ever')}${forum('zorgolatry1')}${forum('Mixelias')}${messages}${added(40, "Wind's Anthem", false)}${added(41, 'Another title', false)}</div>`;
  const originals = [...document.querySelectorAll<HTMLElement>('.notification')];
  const reason = document.querySelector<HTMLButtonElement>('.reason')!;
  let reasonClicks = 0;
  reason.addEventListener('click', () => {
    reasonClicks++; const text = reason.previousElementSibling as HTMLElement; text.hidden = !text.hidden;
    reason.textContent = text.hidden ? 'Show reason...' : 'Hide reason...';
  });
  const status = await chrome.runtime.sendMessage({ type: MSG.AUTH_STATUS });
  const context = { sessionId: status.sessionId as string, userId: status.userId ?? null }; let reads = 0;
  let rpcDiagnostic = 'not dispatched';
  const api = { ensureContext: async () => context, getContext: () => context,
    queryRaw: async (query: string, variables: Record<string, unknown>) => {
      reads++;
      // Exercise the compiled service worker and its real API validation. The
      // smoke runner replaces only HTTP responses inside its isolated worker.
      const response = await chrome.runtime.sendMessage({ type: MSG.API_REQUEST, method: 'queryRaw', query, variables, sessionId: context.sessionId });
      rpcDiagnostic = JSON.stringify(response);
      if (!response?.success) throw new Error('Notification background query rejected');
      return response.data;
    } };
  const entries = new Map<number, unknown>(); const batcher = new GraphQLBatcher(api as never);
  const fetch = new NotificationFetchService(batcher, { create: () => ({ get: async (id: number) => entries.get(id),
    set: async (id: number, value: unknown) => { entries.set(id, structuredClone(value)); }, delete: async (id: number) => entries.delete(id), clear: async () => entries.clear() }) } as never, api as never);
  const module = new NotificationCleanerModule(fetch, new NotificationGroupService(fetch), new NotificationFilterService(), new EventBus(),
    { get: async () => true, set: async () => true } as never);
  let processingError: unknown;
  const internal = module as unknown as { toggleGrouping(): Promise<void>; processNotifications(): Promise<void>; runSafely(operation: Promise<void>): void };
  internal.runSafely = operation => { void operation.catch(error => { processingError = error; }); };
  dispose = async () => { await module.destroy(); batcher.destroy(); };
  try {
    await module.init(); await until(() => {
      if (processingError) throw processingError;
      return document.querySelectorAll('.au-activity-context').length === 8;
    });
    assert(reads === 2, 'the root error location must exclude the deleted activity and recover all valid siblings in one request');
    assert(originals[0].querySelector('.details .link .context')?.textContent === 'liked your activity:', 'ungrouped like must use a colon before its activity details');
    assert(originals[0].querySelector('.au-activity-context')?.textContent === 'watched episodes 1–2 of Re:ZERO - Starting Life in Another World- Season 4', 'ungrouped like must describe an episode range naturally');
    assert(originals[4].querySelector('.details .link .context')?.textContent === 'liked your activity reply:', 'reply-like must use a colon before its parent activity');
    assert(originals[4].querySelector('.au-activity-context')?.textContent === 'watched episode 9 of Work 9', 'reply-like must identify its parent activity');
    assert(originals[5].querySelector('.details .link .context')?.textContent === "replied to activity you're subscribed to:", 'subscribed reply must use a colon before its target');
    assert(originals[5].querySelector('.au-activity-context')?.textContent === 'watched episode 10 of Work 10', 'subscribed reply must retain its target');
    const siteAddedGroup = document.querySelector<HTMLElement>('.au-notification-group-site-added');
    const siteAddedContexts = [...(siteAddedGroup?.querySelectorAll<HTMLElement>('.au-sub-notification .details .context') ?? [])];
    assert(siteAddedContexts.length >= 3 && siteAddedContexts.every(context => getComputedStyle(context).display === 'none'), 'grouped site additions must hide the repeated added-to-site phrase');
    assert(siteAddedGroup?.querySelectorAll('.au-sub-notification .details a[href^="/anime/"]').length === siteAddedContexts.length, 'grouped site additions must keep each media title');
    assert(!originals.find(node => node.querySelector('a[href="/activity/63"]'))?.querySelector('.au-activity-context'),
      'a deleted public activity must not suppress enrichment of its neighbors');
    const checks = ['compiled worker RPC uses the root 404 location to recover eight valid activities in two HTTP requests'];
    const messageSummary = [...document.querySelectorAll<HTMLElement>('.au-virtual-notification')].find(node => node.textContent?.includes('murrkino'));
    assert(Boolean(messageSummary?.textContent?.includes('sent you 3 messages (1 private)')), 'all three messages, including the missing one, must count exactly one known private message');
    assert(Boolean(originals.find(node => node.querySelector('a[href="/activity/63"]'))?.classList.contains('au-sub-notification')),
      'the deleted message must remain in the consecutive same-user group without enrichment');
    assert(document.querySelector('[data-activity-id="64"][data-message-private="true"]')?.textContent === '(private)', 'single private messages must have a visible marker');
    checks.push('single and grouped messages retain explicit provider privacy through isolated worker requests');
    for (const summary of document.querySelectorAll<HTMLElement>('.au-virtual-notification')) summary.click();
    verifyNotificationGeometry();
    verifyActivityContextWrapping();
    checks.push('actual AniList grid/scoped styles preserve readable summaries with avatars, covers and no image');
    reason.click();
    assert(reasonClicks === 1 && reason.textContent === 'Hide reason...', 'native reason handler must survive grouping');
    checks.push('site additions/data changes and forum comment likes group without losing original media, comment or reason controls');
    const search = document.querySelector<HTMLInputElement>('.au-search-input')!;
    search.value = 'work 8'; search.dispatchEvent(new Event('input', { bubbles: true }));
    assert(!originals[3].classList.contains('au-notification-search-hidden') && originals[2].classList.contains('au-notification-search-hidden'), 'search must inspect individual grouped activities');
    search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true }));
    await internal.toggleGrouping();
    assert([...document.querySelectorAll('.notifications > .notification')].every((node, index) => node === originals[index]), 'unmerge must restore the same native nodes in order');
    assert(getComputedStyle(siteAddedContexts[0]).display !== 'none', 'unmerge must restore the original site-addition wording');
    reason.click(); assert(reasonClicks === 2, 'original handlers must still work after unmerge');
    await internal.toggleGrouping();
    document.querySelector('.notifications')!.insertAdjacentHTML('beforeend', added(42, 'New title after Load More', false));
    await internal.processNotifications();
    const summaries = [...document.querySelectorAll('.au-virtual-notification')];
    const last = summaries[summaries.length - 1];
    assert(last.querySelector('.au-activity-count')?.textContent === '3', 'pagination must rebuild accurate site groups');
    assert(document.querySelectorAll('.au-activity-context').length === 8 && reads === 2, 'regrouping must preserve contexts without new provider reads');
    assert([...document.querySelectorAll('.au-virtual-notification')].some(node => node.textContent?.includes('3 messages (1 private)')), 'unmerge, remerge and pagination must preserve the private-message count');
    checks.push('search, unmerge/remerge and Load More preserve order, native listeners, accurate counts and cached context');
    for (const summary of document.querySelectorAll<HTMLElement>('.au-virtual-notification')) if (summary.getAttribute('aria-expanded') !== 'true') summary.click();
    reason.click();
    await new Promise(resolve => setTimeout(resolve, 400)); // Capture after native expand/fade animations finish.
    verifyNotificationGeometry();
    return checks;
  } catch (error) {
    const count = document.querySelectorAll('.au-activity-context').length;
    await dispose(); dispose = undefined;
    throw Object.assign(new Error(String(error) + '; contexts=' + count + '; reads=' + reads + '; RPC=' + rpcDiagnostic), { cause: error });
  }
}

export function verifyNotificationGeometry(): void {
  const summaries = [...document.querySelectorAll<HTMLElement>('.au-virtual-notification')];
  assert(summaries.length > 0, 'expected grouped summaries');
  assert(summaries.some(summary => !summary.querySelector('.au-notification-summary-image')), 'coverless summary must be tested');
  for (const summary of summaries) {
    const content = summary.querySelector<HTMLElement>('.au-notification-summary-text')!;
    const bounds = content.getBoundingClientRect(); const card = summary.getBoundingClientRect();
    assert(bounds.width > Math.min(180, Math.max(80, card.width / 2 - 50)),
      `summary text collapsed into the native image column (${Math.round(bounds.width)}px in a ${Math.round(card.width)}px card)`);
    assert(card.height < 220, 'summary must not wrap one letter per line');
    assert(bounds.right <= card.right && bounds.left >= card.left, 'summary content must stay inside its card');
    assert(content.scrollWidth <= content.clientWidth + 1, 'summary must not clip or overflow');
    assert(Math.abs(bounds.top + bounds.height / 2 - (card.top + card.height / 2)) < 5, 'summary text must be vertically centered independently of its timestamp');
  }
  for (const context of document.querySelectorAll<HTMLElement>('.au-activity-context')) {
    if (context.hidden) {
      assert(getComputedStyle(context).display === 'none' && context.dataset.messagePrivate !== 'true', 'empty public message metadata must not create a visible activity row');
      continue;
    }
    const card = context.closest<HTMLElement>('.notification')!.getBoundingClientRect(); const bounds = context.getBoundingClientRect();
    assert(bounds.width > (context.dataset.messagePrivate === 'true' ? 20 : 80) && bounds.height > 0 && bounds.right <= card.right + 1,
      `activity context must be visible inside original card (context ${Math.round(bounds.left)}–${Math.round(bounds.right)}, details ${Math.round(context.parentElement?.getBoundingClientRect().left ?? 0)}–${Math.round(context.parentElement?.getBoundingClientRect().right ?? 0)}, card right ${Math.round(card.right)})`);
  }
  for (const notification of document.querySelectorAll<HTMLElement>('.au-sub-notification')) {
    const details = notification.querySelector<HTMLElement>('.details')!;
    const card = notification.getBoundingClientRect();
    assert(details.clientWidth > 150 && card.height < 220, 'expanded original must not collapse without an image');
  }
  const repeatedActorItems = [...document.querySelectorAll<HTMLElement>('.au-notification-group-user .au-sub-notification:not(.hasMedia)')];
  assert(repeatedActorItems.length >= 4, 'same-user activity group must be expanded');
  for (const notification of repeatedActorItems) {
    const avatar = notification.querySelector<HTMLElement>('.avatar')!;
    const link = notification.querySelector<HTMLElement>('.details .link')!;
    const wording = link.querySelector<HTMLElement>('.context')!;
    assert(getComputedStyle(avatar).display === 'none', 'same-user submessages must hide the repeated profile image');
    assert(getComputedStyle(link).fontSize === '0px', 'same-user submessages must hide the repeated name');
    assert(getComputedStyle(wording).fontSize !== '0px' && wording.getBoundingClientRect().width > 80, 'activity wording must remain readable');
  }
}

export function verifyActivityContextWrapping(): void {
  const candidates = [
    document.querySelector<HTMLElement>('.notifications > .notification:not(.au-virtual-notification) .details'),
    document.querySelector<HTMLElement>('.au-notification-group-user .au-sub-notification .details'),
  ].filter((details): details is HTMLElement => !!details);
  assert(candidates.length === 2, 'single and expanded activity messages must be available');
  let naturallyWrapped = false;
  for (const details of candidates) {
    const message = details.querySelector<HTMLElement>(':scope > div:first-child .link');
    const context = details.querySelector<HTMLElement>(':scope > .au-activity-context');
    assert(Boolean(message && context), 'activity message and its details must remain separate native items');
    if (!message || !context) continue;
    assert(getComputedStyle(details).display === 'flex' && getComputedStyle(details).flexWrap === 'wrap',
      'activity lines must wrap naturally as available width changes');
    assert(Number.parseFloat(getComputedStyle(details).rowGap) >= 3, 'wrapped notification rows must have a small visual gap');
    assert(context.getBoundingClientRect().width > 80, 'activity details must stay visible');
    const mediaTitle = context.querySelector<HTMLElement>('.au-title');
    if (mediaTitle) {
      assert(getComputedStyle(mediaTitle).whiteSpace === 'nowrap', 'a long media title must move as one unit instead of splitting awkwardly');
      const titleLineHeight = Number.parseFloat(getComputedStyle(mediaTitle).lineHeight);
      assert(!Number.isFinite(titleLineHeight) || mediaTitle.getBoundingClientRect().height <= titleLineHeight + 2,
        'the media title must occupy one line');
    }
    const start = details.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(details).paddingLeft);
    assert(Math.abs(message.getBoundingClientRect().left - start) < 3, 'wrapped activity text must stay aligned to the left edge');
    if (innerWidth > 500 && (!mediaTitle || (mediaTitle.textContent?.length ?? 0) < 25)) {
      assert(Math.abs(message.getBoundingClientRect().top - context.getBoundingClientRect().top) < 2,
        'activity details should continue on the same line when there is enough room');
    } else if (context.getBoundingClientRect().top > message.getBoundingClientRect().top + 2
      || context.getBoundingClientRect().height > message.getBoundingClientRect().height + 2) naturallyWrapped = true;
  }
  if (innerWidth <= 500) assert(naturallyWrapped, 'activity details must wrap naturally when the notification gets narrow');
}

export async function disposeNotificationsBrowserFixture(): Promise<void> { await dispose?.(); dispose = undefined; }

/** Only native HTML and native handlers; the new tab executes production dist scripts. */
export function productionNotificationDocument(): string {
  const user = 'murrkino';
  const rows = nativeActivity(63, user, 'sent you a message.') + nativeActivity(61, user, 'sent you a message.')
    + [7, 8, 11].map(id => nativeActivity(id, user)).join('');
  const nextPage = [12, 13].map(id => nativeActivity(id, user)).join('');
  return `<!doctype html><html><head><title>Production notifications fixture</title><style>
    :root{font-size:10px;--color-foreground:21,31,46;--color-blue:61,180,242;--color-text:168,184,200;--color-text-lighter:128,147,165}
    body{background:#0b1622;color:#a8b8c8;font:14px Arial;margin:30px auto;max-width:750px;width:calc(100% - 32px)!important;min-width:0!important}
    body::before,body::after{display:none!important}a{color:#3db4f2;text-decoration:none}.notifications{display:block!important}
    .avatar{background:linear-gradient(140deg,#22475a,#407690)}${nativeNotificationCSS}
  </style></head><body><button class="reset-btn">Mark all as read</button><div class="notifications">${rows}</div>
  <button id="load-more-fixture">Load more</button><script>
    document.querySelector('#load-more-fixture').addEventListener('click', function () {
      document.querySelector('.notifications').insertAdjacentHTML('beforeend', ${JSON.stringify(nextPage)}); this.disabled = true;
    });
    document.querySelector('a.link[href="/activity/63"]').addEventListener('click', function (event) {
      event.preventDefault(); this.dataset.nativeClicks = String(Number(this.dataset.nativeClicks || 0) + 1);
    });
  </script></body></html>`;
}
