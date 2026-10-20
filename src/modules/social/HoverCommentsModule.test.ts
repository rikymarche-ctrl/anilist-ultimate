import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { CommentReader } from './CommentReader';
import { CommentTooltip } from './CommentTooltip';
import { HoverCommentsModule } from './HoverCommentsModule';
import { CommentService } from './CommentService';

// Named seam for the private rescan used to simulate Vue replacing its rows.
interface HoverCommentsTestAccess {
  processPage(): Promise<void>;
}
function rescan(module: HoverCommentsModule): Promise<void> {
  return (module as unknown as HoverCommentsTestAccess).processPage();
}

vi.mock('@core/storage/StorageManager', () => ({ StorageManager: { isContextDead: () => false } }));

function nativeIcon(name = 'comment') {
  return `<span class="hover-icon clickable"><span class="hover-icon-target"><svg data-icon="${name}"><path></path></svg></span></span>`;
}
function row(name = 'Friend') {
  return `<a class="follow" href="/user/${name}/"><div class="avatar">Avatar</div><div class="name">${name}</div><div class="status">Watching</div>${nativeIcon()}${nativeIcon('heart')}</a>`;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('HoverCommentsModule native notes replacement', () => {
  let module: HoverCommentsModule;
  let bus: EventBus;
  let comments: CommentService;
  let authenticated: boolean;
  let sessionId: string;
  let query: ReturnType<typeof makeQuery>;
  function makeQuery() {
    return vi.fn(
      async (_q: string, _variables: Record<string, unknown>): Promise<unknown> => ({
        notes: 'Our notes\nFull comment',
      })
    );
  }
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/anime/1/title');
    document.body.innerHTML = `<div class="following">${row()}</div><div class="unrelated">${nativeIcon()}</div>`;
    bus = new EventBus();
    query = makeQuery();
    authenticated = true;
    sessionId = 'A';
    const api = {
      isAuthenticated: () => authenticated,
      getContext: () => ({ sessionId, userId: authenticated ? 1 : null }),
    };
    comments = new CommentService({ query } as never, api as never);
    module = new HoverCommentsModule(
      api as never,
      { info: vi.fn(), debug: vi.fn() } as never,
      bus,
      comments,
      new CommentTooltip(),
      new CommentReader()
    );
  });
  afterEach(async () => {
    await module.destroy();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });
  async function start() {
    await module.init();
    await vi.advanceTimersByTimeAsync(0);
  }
  const icon = () => document.querySelector<HTMLElement>('.anilist-comment-icon')!;

  it('replaces only the native comment control in a managed row', async () => {
    await start();
    expect(document.querySelectorAll('.anilist-comment-icon')).toHaveLength(1);
    expect(
      document
        .querySelector('.follow svg[data-icon="comment"]')!
        .closest('span.hover-icon')!
        .classList.contains('au-comment-native-suppressed')
    ).toBe(true);
    expect(
      document
        .querySelector('.follow svg[data-icon="heart"]')!
        .closest('span.hover-icon')!
        .classList.contains('au-comment-native-suppressed')
    ).toBe(false);
    expect(
      document
        .querySelector('.unrelated .hover-icon')!
        .classList.contains('au-comment-native-suppressed')
    ).toBe(false);
  });

  it('keeps hover behavior and opens the reader only on the speech bubble click', async () => {
    await start();
    const rowClick = vi.fn((event: Event) => event.preventDefault());
    document.querySelector('.follow')!.addEventListener('click', rowClick);
    document.querySelector('.comment-icon-ghost')!.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('#anilist-tooltip.visible')?.textContent).toContain('Our notes');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    document.querySelector<HTMLElement>('.avatar')!.click();
    expect(rowClick).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    rowClick.mockClear();
    icon()
      .querySelector('path')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(rowClick).not.toHaveBeenCalled();
    expect(document.querySelector('#anilist-tooltip.visible')).toBeNull();
    expect(document.querySelector('h2')?.textContent).toBe("Friend's Notes");
    expect(document.querySelector('.au-comment-reader-content')?.textContent).toBe(
      'Our notes\nFull comment'
    );
  });

  it('does not open from the ghost container or row status', async () => {
    await start();
    document.querySelector('.follow')!.addEventListener('click', (event) => event.preventDefault());
    document.querySelector<HTMLElement>('.comment-icon-ghost')!.click();
    document.querySelector<HTMLElement>('.status')!.click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(['Enter', ' '])('supports keyboard activation on the icon with %s', async (key) => {
    await start();
    icon().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('restores native controls and removes custom handlers when disabled', async () => {
    const native = document.querySelector<HTMLElement>('.follow .hover-icon')!;
    const nativeClick = vi.fn();
    native.addEventListener('click', nativeClick);
    await start();
    const oldIcon = icon();
    oldIcon.click();
    await module.destroy();
    expect(
      document.querySelector('[role="dialog"], .comment-icon-ghost, #anilist-tooltip')
    ).toBeNull();
    expect(native.classList.contains('au-comment-native-suppressed')).toBe(false);
    expect(document.querySelector('.follow')!.hasAttribute('data-au-comment-injected')).toBe(false);
    oldIcon.click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    document.querySelector('.follow')!.addEventListener('click', (event) => event.preventDefault());
    native.click();
    expect(nativeClick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await start();
    expect(document.querySelectorAll('.anilist-comment-icon')).toHaveLength(1);
    icon().click();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it('handles a cloned row without duplicated icons and restores cloned native controls on OFF', async () => {
    await start();
    const original = document.querySelector('.follow')!;
    original.replaceWith(original.cloneNode(true));
    await rescan(module);
    expect(document.querySelectorAll('.anilist-comment-icon')).toHaveLength(1);
    icon().click();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await module.destroy();
    expect(document.querySelector('.au-comment-native-suppressed')).toBeNull();
  });

  it('suppresses a native icon reintroduced into an existing row by Vue', async () => {
    await start();
    document.querySelector('.follow')!.insertAdjacentHTML('beforeend', nativeIcon());
    await rescan(module);
    expect(
      document.querySelectorAll(
        '.follow .hover-icon:not(.au-comment-native-suppressed) svg[data-icon="comment"]'
      )
    ).toHaveLength(0);
    expect(document.querySelectorAll('.anilist-comment-icon')).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('ignores old notes after navigation even when Following rows are reused', async () => {
    const first = deferred<unknown>();
    query.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ notes: 'Second media' });
    await start();
    history.replaceState({}, '', '/manga/2/other');
    bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: '/manga/2/other',
      previousPath: '/anime/1/title',
      timestamp: new Date(),
    });
    await vi.advanceTimersByTimeAsync(0);
    first.resolve({ notes: 'Wrong old notes' });
    await vi.advanceTimersByTimeAsync(0);
    icon().click();
    expect(document.querySelector('.au-comment-reader-content')?.textContent).toBe('Second media');
    expect(query.mock.calls.map((call) => call[1].mediaId)).toEqual([1, 2]);
  });

  it('closes the reader and restores controls immediately on navigation', async () => {
    await start();
    icon().click();
    history.replaceState({}, '', '/character/10/person');
    bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: '/character/10/person',
      previousPath: '/anime/1/title',
      timestamp: new Date(),
    });
    expect(
      document.querySelector('[role="dialog"], .comment-icon-ghost, .au-comment-native-suppressed')
    ).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reactivate after destroy during session initialization', async () => {
    const ready = deferred<void>();
    vi.spyOn(comments, 'init').mockReturnValueOnce(ready.promise);
    const initializing = module.init();
    await module.destroy();
    ready.resolve();
    await initializing;
    expect(query).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves native controls available if the replacement cannot fetch notes', async () => {
    query.mockRejectedValue(new Error('offline'));
    await start();
    expect(
      document.querySelector('.anilist-comment-icon, .au-comment-native-suppressed')
    ).toBeNull();
  });
  it('closes private readers and restores native controls on logout, then fetches for a new session', async () => {
    await start();
    icon().click();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    authenticated = false;
    sessionId = 'B';
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });
    await vi.advanceTimersByTimeAsync(0);
    expect(
      document.querySelector(
        '[role="dialog"], .comment-icon-ghost, #anilist-tooltip, .au-comment-native-suppressed'
      )
    ).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    authenticated = true;
    sessionId = 'C';
    query.mockResolvedValueOnce({ notes: 'New session' });
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: 1,
      timestamp: new Date(),
    });
    await vi.advanceTimersByTimeAsync(0);
    icon().click();
    expect(document.querySelector('.au-comment-reader-content')?.textContent).toBe('New session');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('discards old notes when the account changes during a request', async () => {
    const old = deferred<unknown>();
    query.mockReturnValueOnce(old.promise);
    await start();
    sessionId = 'B';
    query.mockResolvedValueOnce({ notes: 'Current session' });
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: 1,
      timestamp: new Date(),
    });
    await vi.advanceTimersByTimeAsync(0);
    old.resolve({ notes: 'Old session' });
    await vi.advanceTimersByTimeAsync(0);
    icon().click();
    expect(document.querySelector('.au-comment-reader-content')?.textContent).toBe(
      'Current session'
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not open a previously injected private note if context changes before its auth event', async () => {
    await start();
    sessionId = 'B';
    document.querySelector('.follow')!.addEventListener('click', (event) => event.preventDefault());
    icon().click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(
      document.querySelector('.au-comment-native-suppressed, .anilist-comment-icon')
    ).toBeNull();
  });

  it('clears the visible reader and retained tooltip text when a session changes silently', async () => {
    await start();
    document.querySelector('.comment-icon-ghost')!.dispatchEvent(new MouseEvent('mouseenter'));
    icon().click();
    sessionId = 'B';
    query.mockResolvedValueOnce({ notes: 'New session' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('#anilist-tooltip')?.textContent).not.toContain('Our notes');
    expect(document.body.style.overflow).toBe('');
    icon().click();
    expect(document.querySelector('.au-comment-reader-content')?.textContent).toBe('New session');
  });

  it('keeps an open reader during ordinary polling of the same row and session', async () => {
    await start();
    icon().click();
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelector('.au-comment-reader-content')?.textContent).toBe(
      'Our notes\nFull comment'
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('never remounts hidden DOM containing notes from the previous account', async () => {
    await start();
    document.querySelector('.comment-icon-ghost')!.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('#anilist-tooltip')?.textContent).toContain('Our notes');
    sessionId = 'B';
    query.mockResolvedValueOnce(null);
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: 1,
      timestamp: new Date(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('#anilist-tooltip')?.textContent).not.toContain('Our notes');
    expect(document.querySelector('.anilist-comment-icon')).toBeNull();
  });

  it('keeps native fallback available for malformed notes and retries only after the failed-lookup backoff', async () => {
    query.mockResolvedValueOnce({ notes: {} });
    await start();
    expect(
      document.querySelector('.au-comment-native-suppressed, .anilist-comment-icon')
    ).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(query).toHaveBeenCalledTimes(2);
    expect(icon()).not.toBeNull();
  });

  it('starts safely after login when mounted while disconnected and removes its auth listener on destroy', async () => {
    authenticated = false;
    await start();
    expect(query).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    authenticated = true;
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, {
      isAuthenticated: true,
      userId: 1,
      timestamp: new Date(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(icon()).not.toBeNull();
    await module.destroy();
    expect(bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED)).toBe(0);
    expect(bus.listenerCount(EVENT_TYPES.PAGE_CHANGED)).toBe(0);
  });

  it('follows a navigation during session initialization without waiting for the obsolete init', async () => {
    const ready = deferred<void>();
    vi.spyOn(comments, 'init').mockReturnValueOnce(ready.promise);
    const initial = module.init();
    history.replaceState({}, '', '/manga/2/title');
    bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: '/manga/2/title',
      previousPath: '/anime/1/title',
      timestamp: new Date(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(query.mock.calls[0][1]).toMatchObject({ mediaId: 2 });
    ready.resolve();
    await initial;
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not fetch usernames from foreign origins or media IDs outside the GraphQL Int range', async () => {
    document.querySelector<HTMLAnchorElement>('.follow')!.href = 'https://example.org/user/Friend/';
    await start();
    expect(query).not.toHaveBeenCalled();
    history.replaceState({}, '', '/anime/2147483648/title');
    bus.emit(EVENT_TYPES.PAGE_CHANGED, {
      path: location.pathname,
      previousPath: '/anime/1/title',
      timestamp: new Date(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(query).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds active requests from a long feed and stops queued reads after teardown', async () => {
    document.querySelector('.following')!.innerHTML = Array.from({ length: 30 }, (_, i) =>
      row(`Friend${i}`)
    ).join('');
    const requests: ReturnType<typeof deferred<unknown>>[] = [];
    query.mockImplementation(() => {
      const request = deferred<unknown>();
      requests.push(request);
      return request.promise;
    });
    await start();
    expect(query).toHaveBeenCalledTimes(8);
    await module.destroy();
    requests.forEach((request) => request.resolve({ notes: 'Late' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(query).toHaveBeenCalledTimes(8);
    expect(document.querySelector('.anilist-comment-icon')).toBeNull();
  });
});
