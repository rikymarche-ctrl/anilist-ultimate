import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse, Kind } from 'graphql';
import { GraphQLBatcher } from '@core/api/GraphQLBatcher';
import { EventBus } from '@core/events/EventBus';
import { NotificationCleanerModule } from './NotificationCleanerModule';
import { NotificationFetchService } from './services/NotificationFetchService';
import { NotificationGroupService } from './services/NotificationGroupService';
import { NotificationFilterService } from './services/NotificationFilterService';
import { validateApiRequest } from '@/api/ApiBoundary';
import { EVENT_TYPES } from '@core/events/EventTypes';
import {
  nativeActivity,
  nativeAddition as added,
  nativeChanges as changes,
  nativeForum as forum,
} from '@/test/fixtures/anilist-notifications';

const activity = (id: number, user = 'Alice', wording = 'liked your activity.', root = false) =>
  root
    ? `<a class="notification" href="/activity/${id}"><span class="details"><span>${user} ${wording}</span><span class="time">3 days ago</span></span></a>`
    : nativeActivity(id, user, wording);

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function setup(markup: string, enabled = true) {
  history.replaceState({}, '', '/notifications');
  document.body.innerHTML = `<aside><button class="reset-btn">Mark all as read</button></aside><div class="notifications">${markup}</div>`;
  const originals = [...document.querySelectorAll<HTMLElement>('.notification')];
  const entries = new Map<number, unknown>();
  const context = { sessionId: 'notifications-fixture', userId: 42 };
  let providerFails = false;
  let providerGate: Promise<void> | undefined;
  const activityGates = new Map<number, Promise<void>>();
  const responses = new Map<number, unknown>();
  const queryRaw = vi.fn(async (query: string, variables: Record<string, unknown>) => {
    validateApiRequest({ query, variables, method: 'queryRaw' });
    await providerGate;
    await Promise.all(Object.values(variables).map((id) => activityGates.get(Number(id))));
    if (providerFails) throw new Error('Offline');
    const operation = parse(query).definitions[0];
    if (operation.kind !== Kind.OPERATION_DEFINITION) throw new Error('Invalid query');
    const data: Record<string, unknown> = {};
    for (const selection of operation.selectionSet.selections) {
      if (selection.kind !== Kind.FIELD) throw new Error('Invalid field');
      const field = selection.alias?.value ?? selection.name.value;
      const id = Number(selection.alias ? variables[`${field}_id`] : variables.id);
      data[field] = responses.has(id)
        ? responses.get(id)
        : {
            __typename: 'ListActivity',
            id,
            type: id === 9 ? 'MANGA_LIST' : 'ANIME_LIST',
            status: id === 9 ? 'read chapter' : 'watched episode',
            progress: id === 11 ? '1 - 2' : String(id),
            media: {
              id: id + 100,
              type: id === 9 ? 'MANGA' : 'ANIME',
              title: { userPreferred: null, romaji: null, english: `Work ${id}` },
            },
          };
    }
    return { data };
  });
  const api = { ensureContext: async () => context, getContext: () => context, queryRaw };
  const batcher = new GraphQLBatcher(api as never);
  const fetch = new NotificationFetchService(
    batcher,
    {
      create: () => ({
        get: async (id: number) => entries.get(id),
        set: async (id: number, value: unknown) => {
          entries.set(id, structuredClone(value));
        },
        delete: async (id: number) => entries.delete(id),
        clear: async () => entries.clear(),
      }),
    } as never,
    api as never
  );
  const filter = new NotificationFilterService();
  const bus = new EventBus();
  const module = new NotificationCleanerModule(
    fetch,
    new NotificationGroupService(fetch),
    filter,
    bus,
    { get: async () => enabled, set: async () => true } as never
  );
  const internal = module as unknown as {
    toggleGrouping(): Promise<void>;
    processNotifications(): Promise<void>;
    nextEnhancementAt: number;
  };
  cleanups.push(async () => {
    await module.destroy();
    batcher.destroy();
  });
  return {
    module,
    internal,
    originals,
    queryRaw,
    fetch,
    filter,
    bus,
    respondWith: (id: number, value: unknown) => responses.set(id, value),
    pause: () => {
      let finish!: () => void;
      providerGate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      return () => {
        providerGate = undefined;
        finish();
      };
    },
    pauseActivity: (id: number) => {
      let finish!: () => void;
      activityGates.set(
        id,
        new Promise<void>((resolve) => {
          finish = resolve;
        })
      );
      return () => {
        activityGates.delete(id);
        finish();
      };
    },
    fail: (value: boolean) => {
      providerFails = value;
    },
  };
}

describe('notification native DOM and batched activity context', () => {
  it('recovers the root activity URL even when grouping is disabled, keeping native name/time/navigation', async () => {
    const f = setup(activity(7, 'Alice', undefined, true), false);
    await f.module.init();
    await vi.waitFor(() =>
      expect(document.querySelector('.au-activity-context')?.textContent).toContain(
        'watched episode 7 of Work 7'
      )
    );
    expect(f.originals[0].getAttribute('href')).toBe('/activity/7');
    expect(f.originals[0].textContent).toContain('Alice liked your activity.');
    expect(f.originals[0].querySelector('.time')?.textContent).toBe('3 days ago');
    expect(f.originals[0].querySelector('a')).toBeNull(); // no invalid nested anchors
    expect(document.querySelector('.au-compress-button')?.textContent).toBe('Merge Notifications');
    expect(f.queryRaw).toHaveBeenCalledOnce();
  });
  it('batches all grouped activities once and restores the same native nodes and order on unmerge', async () => {
    const f = setup([7, 8, 9, 10].map((id) => activity(id)).join(''));
    await f.module.init();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.au-activity-context')).toHaveLength(4)
    );
    expect(f.queryRaw).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('.au-virtual-notification')).toHaveLength(1);
    expect(document.querySelector('.au-compress-button')?.textContent).toBe(
      'Unmerge Notifications'
    );
    expect(
      document.querySelector<HTMLAnchorElement>('.au-sub-notification a.au-title')?.href
    ).toContain('/anime/107');
    expect(f.originals[2].querySelector<HTMLAnchorElement>('.au-title')?.getAttribute('href')).toBe(
      '/manga/109'
    );
    document.querySelector<HTMLElement>('.au-virtual-notification')!.click();
    expect(document.querySelector<HTMLElement>('.au-notification-dropdown')?.style.display).toBe(
      'block'
    );
    await f.internal.toggleGrouping();
    expect([...document.querySelectorAll('.notifications > .notification')]).toEqual(f.originals);
    expect(
      document.querySelectorAll('.au-virtual-notification,.au-notification-dropdown')
    ).toHaveLength(0);
    expect(document.querySelectorAll('.au-activity-context')).toHaveLength(4);
  });
  it('uses a colon and natural wording for episode ranges', async () => {
    const f = setup(activity(11), false);
    await f.module.init();
    await vi.waitFor(() =>
      expect(f.originals[0].querySelector('.au-activity-context')?.textContent).toBe(
        'watched episodes 1–2 of Work 11'
      )
    );
    expect(f.originals[0].querySelector('.details .link .context')?.textContent).toBe(
      'liked your activity:'
    );
  });
  it('labels each expanded group so repeated actors can collapse cleanly', async () => {
    const f = setup([7, 8].map((id) => activity(id)).join(''));
    await f.module.init();
    expect(
      document
        .querySelector('.au-notification-dropdown-inner')
        ?.classList.contains('au-notification-group-user')
    ).toBe(true);
    document.querySelector<HTMLElement>('.au-virtual-notification')!.click();
    expect(f.originals.every((node) => node.classList.contains('au-sub-notification'))).toBe(true);
  });
  it('groups consecutive additions separately from users and keeps every media link', async () => {
    const f = setup(
      activity(7) +
        added(1, 'RESPAWN!!') +
        added(2, 'Beyond the Clouds') +
        added(3, 'AIYOU') +
        activity(8)
    );
    await f.module.init();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.au-activity-context')).toHaveLength(2)
    );
    expect(document.querySelectorAll('.au-virtual-notification')).toHaveLength(1);
    expect(document.querySelector('.au-virtual-notification')?.textContent).toContain(
      '3 titles were recently added to the site'
    );
    expect(
      document.querySelectorAll('.au-sub-notification .details a[href^="/anime/"]')
    ).toHaveLength(3);
    const siteAddedGroup = document.querySelector('.au-notification-group-site-added');
    expect(siteAddedGroup?.querySelectorAll('.au-sub-notification .details .context')).toHaveLength(
      3
    );
    expect(siteAddedGroup?.querySelector('.au-sub-notification .details a')?.textContent).toBe(
      'RESPAWN!!'
    );
    expect(document.querySelector('.au-notification-summary-image.cover')).not.toBeNull();
    expect(document.querySelector('.au-notification-summary-content')?.textContent).toContain(
      '3 titles'
    );
    expect(f.originals[0].classList.contains('au-sub-notification')).toBe(false);
    expect(f.originals[4].classList.contains('au-sub-notification')).toBe(false);
  });
  it('preserves original Show/Hide reason handlers and state through grouping, searching and unmerging', async () => {
    const f = setup(changes(1, 'How Do We Relationship?') + changes(2, 'Another manga'));
    const button = f.originals[0].querySelector<HTMLButtonElement>('.reason')!;
    const nativeHandler = vi.fn(() => {
      button.textContent =
        button.textContent === 'Show reason...' ? 'Hide reason...' : 'Show reason...';
    });
    button.addEventListener('click', nativeHandler);
    await f.module.init();
    document.querySelector<HTMLElement>('.au-virtual-notification')!.click();
    button.click();
    expect(nativeHandler).toHaveBeenCalledOnce();
    expect(button.textContent).toBe('Hide reason...');
    f.filter.applySearchFilter('relationship');
    expect(
      document
        .querySelector('.au-virtual-notification')
        ?.classList.contains('au-notification-search-hidden')
    ).toBe(false);
    expect(f.originals[1].classList.contains('au-notification-search-hidden')).toBe(true);
    await f.internal.toggleGrouping();
    button.click();
    expect(nativeHandler).toHaveBeenCalledTimes(2);
    expect(button.textContent).toBe('Show reason...');
  });
  it('combines forum likes only when they target the same comment and retains all users', async () => {
    const f = setup(
      forum('twilight1234') +
        forum('putrid4ever') +
        forum('zorgolatry1') +
        forum('Mixelias') +
        forum('Other', 789)
    );
    await f.module.init();
    expect(document.querySelectorAll('.au-sub-notification')).toHaveLength(4);
    expect(document.querySelector('.au-virtual-notification')?.textContent).toContain(
      'Your forum comment received 4 likes'
    );
    expect(document.querySelector('.au-notification-summary-text')?.textContent).toContain(
      'in “life changing anime”'
    );
    expect(document.querySelectorAll('.au-sub-notification a[href^="/user/"]')).toHaveLength(4);
    expect(f.originals[4].classList.contains('au-sub-notification')).toBe(false);
    expect(f.queryRaw).not.toHaveBeenCalled();
  });
  it('connects reply-like and subscription wording to the related activity with a colon', async () => {
    const f = setup(
      activity(7, 'Frieren', 'liked your activity reply.') +
        activity(8, 'NEXXXX', "replied to activity you're subscribed to."),
      false
    );
    await f.module.init();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.au-activity-context')).toHaveLength(2)
    );
    expect(f.originals[0].querySelector('.details .link .context')?.textContent).toBe(
      'liked your activity reply:'
    );
    expect(f.originals[1].querySelector('.details .link .context')?.textContent).toBe(
      "replied to activity you're subscribed to:"
    );
    expect(f.originals[0].querySelector('.au-activity-context')?.textContent).toBe(
      'watched episode 7 of Work 7'
    );
  });
  it('regroups appended pages without stale counts, duplicate nodes or lost expanded context', async () => {
    const f = setup(activity(7) + activity(8));
    await f.module.init();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.au-activity-context')).toHaveLength(2)
    );
    document.querySelector<HTMLElement>('.au-virtual-notification')!.click();
    document.querySelector('.notifications')!.insertAdjacentHTML('beforeend', activity(9));
    await f.internal.processNotifications();
    expect(document.querySelectorAll('.au-virtual-notification')).toHaveLength(1);
    expect(document.querySelector('.au-activity-count')?.textContent).toBe('3');
    expect(document.querySelectorAll('.au-sub-notification')).toHaveLength(3);
    expect(document.querySelectorAll('.au-activity-context')).toHaveLength(3);
    expect(document.querySelector<HTMLElement>('.au-notification-dropdown')?.style.display).toBe(
      'block'
    );
    expect(f.queryRaw).toHaveBeenCalledTimes(2);
  });
  it('groups newly appended pages immediately while earlier API requests are still pending', async () => {
    const f = setup(activity(7) + activity(8));
    const release = f.pause();
    try {
      await f.module.init();
      expect(document.querySelector('.au-activity-context')).toBeNull();
      document
        .querySelector('.notifications')!
        .insertAdjacentHTML('beforeend', activity(9) + activity(10));
      // Drive the native observer, not processNotifications: this must work
      // during the first 50ms too, while every provider promise stays pending.
      await vi.waitFor(() =>
        expect(document.querySelector('.au-activity-count')?.textContent).toBe('4')
      );
      expect(document.querySelectorAll('.au-sub-notification')).toHaveLength(4);
      expect(document.querySelector('.au-activity-context')).toBeNull();
    } finally {
      release();
    }
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.au-activity-context')).toHaveLength(4)
    );
  });
  it('retries failed activity enrichment without hiding native content or hammering the API', async () => {
    const f = setup(activity(7), false);
    f.fail(true);
    await f.module.init();
    await vi.waitFor(() => expect(f.queryRaw).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 10));
    await f.internal.processNotifications();
    expect(f.queryRaw).toHaveBeenCalledOnce();
    expect(f.originals[0].textContent).toContain('liked your activity.');
    f.fail(false);
    f.internal.nextEnhancementAt = 0;
    await f.internal.processNotifications();
    expect(f.originals[0].querySelector('.au-activity-context')).not.toBeNull();
    expect(f.originals[0].querySelector('.details .link .context')?.textContent).toBe(
      'liked your activity:'
    );
  });
  it('finds media inside collapsed groups and does not close manually expanded groups on idle processing', async () => {
    const f = setup(activity(7) + activity(8));
    await f.module.init();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.au-activity-context')).toHaveLength(2)
    );
    f.filter.applySearchFilter('work 8');
    expect(document.querySelector<HTMLElement>('.au-notification-dropdown')?.style.display).toBe(
      'block'
    );
    expect(f.originals[0].classList.contains('au-notification-search-hidden')).toBe(true);
    expect(f.originals[1].classList.contains('au-notification-search-hidden')).toBe(false);
    f.filter.applySearchFilter('');
    await f.internal.processNotifications();
    expect(document.querySelector<HTMLElement>('.au-notification-dropdown')?.style.display).toBe(
      'block'
    );
  });
  it('updates grouped read state and reused activity identities without retaining stale context', async () => {
    const f = setup(activity(7) + activity(8));
    f.originals[1].classList.add('unread');
    await f.module.init();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.au-activity-context')).toHaveLength(2)
    );
    expect(document.querySelector('.au-virtual-notification')?.classList.contains('unread')).toBe(
      true
    );
    f.originals[1].classList.remove('unread');
    f.originals[0].querySelector('a[href^="/activity/"]')!.setAttribute('href', '/activity/10');
    await f.internal.processNotifications();
    expect(document.querySelector('.au-virtual-notification')?.classList.contains('unread')).toBe(
      false
    );
    expect(f.originals[0].querySelector('.au-activity-context')?.textContent).toContain('Work 10');
    expect(f.originals[0].querySelector('.au-activity-context')?.textContent).not.toContain(
      'Work 7'
    );
  });
});

describe('message privacy in notifications', () => {
  const message = (id: number, isPrivate: boolean | null, text = '') => ({
    __typename: 'MessageActivity',
    id,
    type: 'MESSAGE',
    isPrivate,
    message: text,
  });
  it('renders fast batch details and private counts before a slower batch on the same page finishes', async () => {
    const f = setup(
      activity(31, 'Alice', 'sent you a message.') +
        Array.from({ length: 25 }, (_, i) => activity(i + 1)).join('')
    );
    f.respondWith(31, message(31, true));
    const release = f.pauseActivity(25);
    let summary: HTMLElement | null = null;
    try {
      await f.module.init();
      summary = document.querySelector<HTMLElement>('.au-virtual-notification')!;
      summary.click();
      const search = document.querySelector<HTMLInputElement>('.au-search-input')!;
      search.value = 'work 24';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.waitFor(() =>
        expect(summary?.textContent).toContain(
          '26 notifications: 1 private message, 25 activity likes'
        )
      );
      await vi.waitFor(() =>
        expect(f.originals[24].classList.contains('au-notification-search-hidden')).toBe(false)
      );
      expect(f.originals[25].classList.contains('au-notification-search-hidden')).toBe(true);
      expect(document.querySelectorAll('.au-activity-context')).toHaveLength(25);
      expect(f.originals[25].querySelector('.au-activity-context')).toBeNull();
      expect(summary.getAttribute('aria-expanded')).toBe('true');
    } finally {
      release();
    }
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.au-activity-context')).toHaveLength(26)
    );
    expect(document.querySelector('.au-virtual-notification')).toBe(summary);
    expect(f.queryRaw).toHaveBeenCalledTimes(2);
  });
  it('updates an existing three-message summary to include exactly one private message after the batch', async () => {
    const f = setup(
      [31, 32, 33].map((id) => activity(id, 'murrkino', 'sent you a message.')).join('')
    );
    [31, 32, 33].forEach((id) => f.respondWith(id, message(id, id === 31)));
    await f.module.init();
    const summary = document.querySelector<HTMLElement>('.au-virtual-notification')!;
    summary.click();
    await vi.waitFor(() =>
      expect(summary.textContent).toContain('sent you 3 messages (1 private)')
    );
    expect(document.querySelector('.au-virtual-notification')).toBe(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(f.originals[0].querySelector('.au-activity-context')?.textContent).toBe('(private)');
    expect(
      f.originals[1].querySelector<HTMLElement>('.au-activity-context')?.dataset.messagePrivate
    ).toBe('false');
    expect(f.queryRaw).toHaveBeenCalledOnce();
    await f.internal.processNotifications();
    expect(f.queryRaw).toHaveBeenCalledOnce();
    await f.internal.toggleGrouping();
    expect([...document.querySelectorAll('.notifications > .notification')]).toEqual(f.originals);
    expect(f.originals[0].querySelector('.au-activity-context')?.textContent).toBe('(private)');
    await f.internal.toggleGrouping();
    expect(document.querySelector('.au-virtual-notification')?.textContent).toContain(
      '3 messages (1 private)'
    );
    expect(f.queryRaw).toHaveBeenCalledOnce();
  });
  it('marks an ungrouped private message while preserving native links, listeners and timestamp', async () => {
    const f = setup(activity(31, 'murrkino', 'sent you a message.'), false);
    f.respondWith(31, message(31, true));
    const link = f.originals[0].querySelector<HTMLAnchorElement>('.link')!;
    const clicked = vi.fn((event) => event.preventDefault());
    link.addEventListener('click', clicked);
    await f.module.init();
    await vi.waitFor(() => expect(f.originals[0].textContent).toContain('(private)'));
    link.click();
    expect(clicked).toHaveBeenCalledOnce();
    expect(link.getAttribute('href')).toBe('/activity/31');
    expect(f.originals[0].querySelector('.time')?.textContent).toBe('3 days ago');
    expect(document.querySelector('.au-virtual-notification')).toBeNull();
  });
  it('labels private messages directly inside mixed notification groups without counting other activity privacy', async () => {
    const f = setup(activity(31, 'Alice', 'sent you a message.') + activity(32) + activity(33));
    f.respondWith(31, message(31, true));
    f.respondWith(32, message(32, true));
    f.respondWith(33, message(33, true));
    await f.module.init();
    await vi.waitFor(() =>
      expect(document.querySelector('.au-virtual-notification')?.textContent).toContain(
        '3 notifications: 1 private message, 2 activity likes'
      )
    );
  });
  it.each([false, null])(
    'does not infer private messages from body text when privacy is %j',
    async (isPrivate) => {
      const f = setup(
        activity(31, 'Alice', 'sent you a message.') + activity(32, 'Alice', 'sent you a message.')
      );
      [31, 32].forEach((id) => f.respondWith(id, message(id, isPrivate, 'This text says private')));
      await f.module.init();
      await vi.waitFor(() =>
        expect(document.querySelectorAll('.au-activity-context')).toHaveLength(2)
      );
      expect(document.querySelector('.au-virtual-notification')?.textContent).toContain(
        'sent you 2 messages'
      );
      expect(document.querySelector('.au-virtual-notification')?.textContent).not.toContain(
        '(1 private)'
      );
      expect(f.originals[0].querySelector('.au-activity-context')?.textContent).not.toContain(
        '(private)'
      );
    }
  );
  it('keeps a missing message with four consecutive notifications from the same user, without details or retries', async () => {
    const f = setup(
      activity(33, 'Alice', 'sent you a message.') +
        activity(7) +
        activity(31, 'Alice', 'sent you a message.') +
        activity(8) +
        activity(9)
    );
    f.respondWith(31, message(31, true));
    f.respondWith(33, null);
    await f.module.init();
    const summary = document.querySelector<HTMLElement>('.au-virtual-notification')!;
    summary.click();
    await vi.waitFor(() =>
      expect(summary.textContent).toContain(
        '5 notifications: 2 messages (1 private), 3 activity likes'
      )
    );
    expect(document.querySelector('.au-virtual-notification')).toBe(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('.au-sub-notification')).toHaveLength(5);
    expect(f.originals[0].classList.contains('au-sub-notification')).toBe(true);
    expect(f.originals[0].querySelector('.au-activity-context')).toBeNull();
    expect(f.originals[0].querySelector('.context')?.textContent).toBe('sent you a message.');
    expect(f.originals[0].querySelector('.link')?.getAttribute('href')).toBe('/activity/33');
    f.fetch.beginPage();
    f.internal.nextEnhancementAt = 0;
    await f.internal.processNotifications();
    await f.internal.toggleGrouping();
    await f.internal.toggleGrouping();
    expect(f.queryRaw).toHaveBeenCalledOnce();
    expect(document.querySelector('.au-activity-count')?.textContent).toBe('5');
    expect(f.originals[0].querySelector('.au-activity-context')).toBeNull();
  });
  it('restores a deleted message to native wording and preserves unrelated details across SPA navigation', async () => {
    const f = setup(
      activity(31, 'Alice', 'sent you a message.') +
        activity(32, 'Alice', 'sent you a message.') +
        activity(33)
    );
    f.respondWith(31, message(31, true, 'Removed body'));
    f.respondWith(32, message(32, false, 'Current body'));
    await f.module.init();
    await vi.waitFor(() =>
      expect(document.querySelector('.au-virtual-notification')?.textContent).toContain(
        '2 messages (1 private)'
      )
    );
    f.respondWith(31, null);
    history.replaceState({}, '', '/activity/31');
    f.bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: '/activity/31',
      previousPath: '/notifications',
      timestamp: new Date(),
    });
    await vi.waitFor(() => expect(document.querySelector('.au-activity-context')).toBeNull());
    history.replaceState({}, '', '/notifications');
    f.bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: '/notifications',
      previousPath: '/activity/31',
      timestamp: new Date(),
    });
    await vi.waitFor(() =>
      expect(
        f.originals[1].querySelector<HTMLElement>('.au-activity-context')?.dataset.messagePrivate
      ).toBe('false')
    );
    await vi.waitFor(() =>
      expect(document.querySelector('.au-virtual-notification')?.textContent).toContain(
        '3 notifications: 2 messages, 1 activity like'
      )
    );
    expect(f.originals[0].querySelector('.au-activity-context')).toBeNull();
    expect(f.originals[0].classList.contains('au-sub-notification')).toBe(true);
    expect(f.originals[0].querySelector('.context')?.textContent).toBe('sent you a message.');
    expect(f.originals[0].textContent).not.toContain('Removed body');
    expect(
      f.originals[1].querySelector<HTMLElement>('.au-activity-context')?.dataset.messagePrivate
    ).toBe('false');
    expect(f.originals[2].querySelector('.au-activity-context')?.textContent).toContain('Work 33');
    expect(f.queryRaw).toHaveBeenCalledTimes(2);
  });
  it('recounts appended messages and removes stale privacy when AniList reuses a native row', async () => {
    const f = setup(
      activity(31, 'Alice', 'sent you a message.') + activity(32, 'Alice', 'sent you a message.')
    );
    f.respondWith(31, message(31, true));
    f.respondWith(32, message(32, false));
    f.respondWith(33, message(33, false));
    await f.module.init();
    await vi.waitFor(() =>
      expect(document.querySelector('.au-virtual-notification')?.textContent).toContain(
        '2 messages (1 private)'
      )
    );
    document
      .querySelector('.notifications')!
      .insertAdjacentHTML('beforeend', activity(33, 'Alice', 'sent you a message.'));
    await f.internal.processNotifications();
    expect(document.querySelector('.au-virtual-notification')?.textContent).toContain(
      '3 messages (1 private)'
    );
    f.respondWith(34, message(34, false));
    f.originals[0].querySelector('.link')!.setAttribute('href', '/activity/34');
    await f.internal.processNotifications();
    expect(document.querySelector('.au-virtual-notification')?.textContent).toContain(
      'sent you 3 messages'
    );
    expect(document.querySelector('.au-virtual-notification')?.textContent).not.toContain(
      'private'
    );
    expect(
      f.originals[0].querySelector<HTMLElement>('.au-activity-context')?.dataset.activityId
    ).toBe('34');
  });
});
