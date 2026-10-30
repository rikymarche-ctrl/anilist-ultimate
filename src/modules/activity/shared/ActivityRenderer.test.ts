import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityRenderer, TOGGLE_LIKE_MUTATION } from './ActivityRenderer';
import type { ActivityFilterType, AniListActivity } from '../ActivityUtils';
import type { ILogger } from '@core/interfaces/ILogger';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ToastService } from '@core/services/ToastService';
import {
  NATIVE_LIST_ROW,
  NATIVE_MANGA_ROW,
  NATIVE_MESSAGE_ROW,
  NATIVE_TEXT_ROW,
} from '@/test/fixtures/anilist-activity-rows';

function makeLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    group: vi.fn(),
    groupEnd: vi.fn(),
    time: vi.fn(),
    timeEnd: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    isEnabled: () => false,
  };
}

function makeToast() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const activity = (overrides: Partial<AniListActivity> = {}): AniListActivity => ({
  id: 1,
  type: 'ANIME_LIST',
  status: 'watched episode',
  progress: '3',
  createdAt: Math.floor(Date.now() / 1000),
  user: { id: 2, name: 'Alice', avatar: { medium: 'https://example.com/avatar.png' } },
  media: {
    id: 3,
    type: 'ANIME',
    title: { romaji: 'Example' },
    coverImage: { medium: 'https://example.com/cover.png' },
  },
  replyCount: 0,
  likeCount: 0,
  ...overrides,
});

function makeApi(
  overrides: {
    isAuthenticated?: () => boolean;
    mutateOnce?: (...args: unknown[]) => Promise<unknown>;
  } = {}
) {
  return {
    isAuthenticated: () => true,
    mutate: vi.fn(() => Promise.resolve({})),
    mutateOnce: vi.fn(overrides.mutateOnce ?? (() => Promise.resolve({}))),
    ...(overrides.isAuthenticated ? { isAuthenticated: overrides.isAuthenticated } : {}),
  };
}

/** Renders one row through the production renderer and returns its container plus collaborators. */
function renderRows(
  rows: unknown[],
  options: { api?: ReturnType<typeof makeApi>; toast?: ReturnType<typeof makeToast> } = {}
) {
  const api = options.api ?? makeApi();
  const toast = options.toast ?? makeToast();
  const logger = makeLogger();
  const container = document.createElement('div');
  new ActivityRenderer(
    logger,
    api as unknown as IApiClient,
    toast as unknown as ToastService
  ).renderCustomActivities(rows, container);
  return { container, api, toast, logger };
}

function renderOne(entry: unknown, options: Parameters<typeof renderRows>[1] = {}) {
  const { container, ...rest } = renderRows([entry], options);
  return { row: container.querySelector<HTMLElement>('.au-custom-activity'), container, ...rest };
}

function nativeRows(html: string): void {
  document.body.innerHTML = html;
}

describe('ActivityRenderer native-row structure', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a list row with the native structure and none of the template decorations', () => {
    nativeRows(NATIVE_LIST_ROW);
    const { row } = renderOne(
      activity({
        id: 42,
        status: 'watched episode',
        progress: '1 - 4',
        media: {
          id: 113311,
          type: 'ANIME',
          title: { romaji: 'Kakushigoto', userPreferred: 'Magic Knight Rayearth (2026)' },
          coverImage: { medium: 'https://example.com/cover.png' },
        },
      })
    );
    const el = row!;
    expect(el.classList.contains('activity-anime_list')).toBe(true);
    expect(el.classList.contains('au-custom-activity')).toBe(true);
    expect(el.classList.contains('au-astra-card')).toBe(false);
    expect(el.getAttribute('data-activity-id')).toBe('42');
    expect(el.querySelector('.status')?.textContent).toBe(
      'Watched episode 1 - 4 of Magic Knight Rayearth (2026)'
    );
    expect(el.querySelector('.status a.title')?.getAttribute('href')).toBe('/anime/113311/');
    expect(el.querySelector('.au-activity-rating, .au-pill-wrapper')).toBeNull();
    expect(el.querySelector('[data-au-media-id], [data-au-score-enhanced]')).toBeNull();
    expect(el.querySelector('.router-link-active, .router-link-exact-active')).toBeNull();
    expect(el.querySelector('.extras-dropdown:not(.au-time-spacer), .el-dropdown-menu')).toBeNull();
    expect(el.querySelectorAll('[id]')).toHaveLength(0);
  });

  it('scopes every created element with the native data-v attributes', () => {
    nativeRows(NATIVE_LIST_ROW);
    const { row } = renderOne(activity({ replyCount: 2, likeCount: 5 }));
    const el = row!;
    expect(el.getAttribute('data-v-eb51fd0e')).toBe('');
    expect(el.querySelector('.time a.au-activity-link')?.hasAttribute('data-v-0f4a73fc')).toBe(
      true
    );
    expect(el.querySelector('.time time')?.hasAttribute('data-v-0f4a73fc')).toBe(true);
    expect(el.querySelector('.status')?.hasAttribute('data-v-0f4a73fc')).toBe(true);
    expect(el.querySelector('.action.replies .count')?.hasAttribute('data-v-0f4a73fc')).toBe(true);
    expect(el.querySelector('.like-wrap .button .count')?.hasAttribute('data-v-5fb0ec91')).toBe(
      true
    );
  });

  it('keeps the manga kind as a manga_list row with the manga link', () => {
    nativeRows(NATIVE_MANGA_ROW);
    const { row } = renderOne(
      activity({
        type: 'MANGA_LIST',
        media: {
          id: 204589,
          type: 'MANGA',
          title: { romaji: 'Ije Ureodo Doelkkayo?' },
          coverImage: { medium: 'https://example.com/cover.png' },
        },
      })
    );
    expect(row!.classList.contains('activity-manga_list')).toBe(true);
    expect(row!.classList.contains('activity-anime_list')).toBe(false);
    expect(row!.querySelector('a.cover')?.getAttribute('href')).toBe('/manga/204589/');
  });

  it('builds a text row from the native text template and writes sanitized html into .markdown', () => {
    nativeRows(NATIVE_TEXT_ROW);
    const { row } = renderOne(
      activity({
        type: 'TEXT',
        media: undefined,
        html: '<p><strong>x</strong></p><img src=x onerror="alert(1)">',
      })
    );
    expect(row!.classList.contains('activity-text')).toBe(true);
    expect(row!.querySelector('.activity-markdown .markdown strong')?.textContent).toBe('x');
    expect(row!.innerHTML).not.toContain('onerror');
    expect(row!.querySelector('.name')?.textContent).toBe('Alice');
  });

  it('never renders a message row as a text template', () => {
    nativeRows(NATIVE_MESSAGE_ROW);
    const { row } = renderOne(activity({ type: 'TEXT', media: undefined, html: 'Hi' }));
    expect(row!.classList.contains('activity-message')).toBe(false);
    expect(row!.innerHTML).not.toContain('SkyBlue1012');
  });

  it('falls back to a skeleton with the same structure when no native row exists', () => {
    const { row } = renderOne(activity({ replyCount: 1 }));
    const el = row!;
    expect(el.querySelector('.wrap .list .cover')).not.toBeNull();
    expect(el.querySelector('.details .status')?.textContent).toContain('Watched episode 3 of ');
    expect(el.querySelector('.actions .action.replies i.fa-comments')).not.toBeNull();
    expect(el.querySelector('.like-wrap .button i.fa-heart')).not.toBeNull();
    expect(el.querySelector('[data-v-0f4a73fc]')).toBeNull();
  });

  it('builds a time link to the post with a machine-readable stamp', () => {
    nativeRows(NATIVE_LIST_ROW);
    const { row } = renderOne(activity({ id: 42, createdAt: 1700000000 }));
    const stamp = row!.querySelector<HTMLTimeElement>('.time a[href="/activity/42"] time')!;
    expect(stamp.getAttribute('datetime')).toBe(new Date(1700000000 * 1000).toISOString());
    expect(stamp.title).toBe(new Date(1700000000 * 1000).toLocaleString());
  });

  it('keeps an inert stand-in for the native menu so the stamp sits on the native line', () => {
    const time = renderOne(activity()).row!.querySelector('.time')!;
    const spacer = time.firstElementChild!;
    expect(spacer.matches('.extras-dropdown.el-dropdown.au-time-spacer')).toBe(true);
    expect(spacer.getAttribute('aria-hidden')).toBe('true');
    expect(spacer.querySelector('.el-dropdown-link svg.svg-inline--fa')).not.toBeNull();
    expect(spacer.querySelector('[id], ul, a')).toBeNull();
    expect(spacer.nextElementSibling?.matches('a.au-activity-link')).toBe(true);
  });

  it('shows the reply and like counts only when they are non-zero', () => {
    const empty = renderOne(activity({ replyCount: 0, likeCount: 0 })).row!;
    expect(empty.querySelector('.action.replies .count')).toBeNull();
    expect(empty.querySelector('.like-wrap .button .count')).toBeNull();
    const full = renderOne(activity({ replyCount: 4, likeCount: 9 })).row!;
    expect(full.querySelector('.action.replies .count')?.textContent).toBe('4');
    expect(full.querySelector('.like-wrap .button .count')?.textContent).toBe('9');
    expect(full.querySelector('.like-wrap .users')).not.toBeNull();
  });

  it('writes "of" only after a progress, as AniList does', () => {
    nativeRows(NATIVE_LIST_ROW);
    const completed = renderOne({
      ...activity(),
      status: 'completed',
      progress: null,
    } as unknown).row!;
    expect(
      completed.querySelector('.details .status')?.textContent?.replace(/\s+/g, ' ').trim()
    ).toBe(`Completed ${completed.querySelector('.status a.title')?.textContent}`);
    const watched = renderOne({
      ...activity(),
      status: 'watched episode',
      progress: '1 - 4',
    } as unknown).row!;
    expect(watched.querySelector('.details .status')?.textContent).toMatch(
      /^Watched episode 1 - 4 of /
    );
  });

  it('renders a deleted media without a cover link and with no stale title', () => {
    nativeRows(NATIVE_LIST_ROW);
    const { row } = renderOne({
      ...activity(),
      media: null,
      user: null,
      status: 'completed',
      progress: '',
    } as unknown);
    const el = row!;
    expect(el.querySelector('.details .status')?.textContent).toBe('Completed');
    expect(el.querySelector<HTMLElement>('a.cover')?.style.display).toBe('none');
    expect(el.querySelector('.name')?.textContent).toBe('Unknown');
    expect(el.querySelector('.name')?.hasAttribute('href')).toBe(false);
  });

  it('skips a row that fails parsing without aborting the valid rows', () => {
    nativeRows(NATIVE_LIST_ROW);
    const { container, logger } = renderRows([
      { ...activity(), status: { value: 'watched' } },
      activity({ id: 7 }),
    ]);
    expect(container.children).toHaveLength(1);
    expect(container.querySelector('.au-custom-activity')?.getAttribute('data-activity-id')).toBe(
      '7'
    );
    expect(logger.debug).toHaveBeenCalled();
  });

  it('renders an empty message for an empty feed', () => {
    const { container } = renderRows([]);
    expect(container.textContent).toContain('No activities found');
  });
});

describe('ActivityRenderer actions and navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the post in-app when a reply control is activated', () => {
    const push = vi.spyOn(history, 'pushState');
    const onPop = vi.fn();
    window.addEventListener('popstate', onPop);
    const { row } = renderOne(activity({ id: 9 }));
    row!.querySelector<HTMLElement>('.action.replies')!.click();
    expect(push).toHaveBeenCalledWith(null, '', '/activity/9');
    expect(onPop).toHaveBeenCalledTimes(1);
    window.removeEventListener('popstate', onPop);
  });

  it('opens the post when Enter is pressed on the reply control', () => {
    const push = vi.spyOn(history, 'pushState');
    const { row } = renderOne(activity({ id: 11 }));
    const replies = row!.querySelector<HTMLElement>('.action.replies')!;
    replies.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    expect(push).toHaveBeenCalledWith(null, '', '/activity/11');
  });

  it('toggles a like optimistically and applies the server confirmation via mutateOnce', async () => {
    const api = makeApi({
      mutateOnce: () => Promise.resolve({ ToggleLikeV2: { id: 1, isLiked: true, likeCount: 7 } }),
    });
    const { row } = renderOne(activity({ likeCount: 6 }), { api });
    const button = row!.querySelector<HTMLElement>('.like-wrap .button')!;
    button.click();
    expect(button.classList.contains('liked')).toBe(true);
    expect(button.querySelector('.count')?.textContent).toBe('7');
    expect(api.mutateOnce).toHaveBeenCalledWith(TOGGLE_LIKE_MUTATION, { id: 1 });
    expect(api.mutate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
    expect(button.querySelector('.count')?.textContent).toBe('7');
  });

  it('ignores a second click while a like request is pending', () => {
    const api = makeApi({ mutateOnce: () => new Promise(() => undefined) });
    const { row } = renderOne(activity({ likeCount: 1 }), { api });
    const button = row!.querySelector<HTMLElement>('.like-wrap .button')!;
    button.click();
    button.click();
    expect(api.mutateOnce).toHaveBeenCalledTimes(1);
  });

  it('restores the previous like state and reports the failure when the mutation is rejected', async () => {
    const api = makeApi({ mutateOnce: () => Promise.reject(new Error('network')) });
    const toast = makeToast();
    const { row, logger } = renderOne(activity({ likeCount: 2, isLiked: false }), { api, toast });
    const button = row!.querySelector<HTMLElement>('.like-wrap .button')!;
    button.click();
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not update the like. Try again.')
    );
    expect(button.classList.contains('liked')).toBe(false);
    expect(button.querySelector('.count')?.textContent).toBe('2');
    expect(logger.error).toHaveBeenCalled();
  });

  it('rolls back when the server response does not confirm the activity', async () => {
    const api = makeApi({
      mutateOnce: () => Promise.resolve({ ToggleLikeV2: { id: 999, isLiked: true, likeCount: 1 } }),
    });
    const toast = makeToast();
    const { row } = renderOne(activity({ likeCount: 0, isLiked: false }), { api, toast });
    row!.querySelector<HTMLElement>('.like-wrap .button')!.click();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(row!.querySelector('.like-wrap .button')!.classList.contains('liked')).toBe(false);
  });

  it('shows a toast and sends no mutation or navigation when the user is signed out', () => {
    const api = makeApi({ isAuthenticated: () => false });
    const toast = makeToast();
    const push = vi.spyOn(history, 'pushState');
    const { row } = renderOne(activity(), { api, toast });
    row!.querySelector<HTMLElement>('.like-wrap .button')!.click();
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('extension popup'));
    expect(api.mutateOnce).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(location.pathname).not.toBe('/login');
  });
});

describe('ActivityRenderer link interception', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes a same-origin link click inside the feed through the app router', () => {
    const push = vi.spyOn(history, 'pushState');
    const { container } = renderOne(activity());
    const name = container.querySelector<HTMLAnchorElement>('a.name')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    name.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(push).toHaveBeenCalledWith(null, '', '/user/Alice/');
  });

  it('leaves modified clicks to the browser', () => {
    const push = vi.spyOn(history, 'pushState');
    const { container } = renderOne(activity());
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    container.querySelector<HTMLAnchorElement>('a.name')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('leaves external links to the browser', () => {
    const push = vi.spyOn(history, 'pushState');
    const { container } = renderOne(activity());
    const external = document.createElement('a');
    external.href = 'https://example.com/page';
    container.append(external);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    external.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});

describe('ActivityRenderer custom-list isolation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps custom-list clones out of native hide, show and filter passes', () => {
    document.body.innerHTML =
      '<div class="activity-feed">' +
      '<div class="activity-entry activity-anime" id="native">Native</div>' +
      '<div class="activity-entry activity-anime au-custom-activity" id="custom" style="display: block">Custom</div>' +
      '</div>';
    const renderer = new ActivityRenderer(makeLogger(), makeApi() as never, makeToast() as never);
    const custom = document.getElementById('custom') as HTMLElement;

    renderer.hideNativeActivities();
    expect((document.getElementById('native') as HTMLElement).style.display).toBe('none');
    expect(custom.style.display).toBe('block');

    renderer.applyFilters(new Set<ActivityFilterType>(), '');
    expect(
      (document.getElementById('native') as HTMLElement).classList.contains('au-activity-hidden')
    ).toBe(true);
    expect(custom.classList.contains('au-activity-hidden')).toBe(false);
    expect(custom.style.display).toBe('block');
  });
});
