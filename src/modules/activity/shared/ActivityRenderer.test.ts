import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityRenderer } from './ActivityRenderer';
import type { ActivityFilterType, AniListActivity } from '../ActivityUtils';
import type { ILogger } from '@core/interfaces/ILogger';

function makeLogger(): ILogger {
  return {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(),
    group: vi.fn(), groupEnd: vi.fn(), time: vi.fn(), timeEnd: vi.fn(),
    enable: vi.fn(), disable: vi.fn(), isEnabled: () => false,
  };
}

const activity = (overrides: Partial<AniListActivity> = {}): AniListActivity => ({
  id: 1,
  type: 'ANIME_LIST',
  status: 'watched episode',
  progress: '3',
  createdAt: Math.floor(Date.now() / 1000),
  user: { id: 2, name: 'Alice', avatar: { medium: 'https://example.com/avatar.png' } },
  media: { id: 3, type: 'ANIME', title: { romaji: 'Example' }, coverImage: { medium: 'https://example.com/cover.png' } },
  replyCount: 0,
  likeCount: 0,
  ...overrides,
});

function render(entry: AniListActivity): HTMLElement {
  const container = document.createElement('div');
  new ActivityRenderer(makeLogger()).renderCustomActivities([entry], container);
  return container;
}

describe('ActivityRenderer safe activity rendering', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('preserves ordinary avatar and cover URLs in the fallback renderer', () => {
    const result = render(activity());
    expect(result.querySelector<HTMLElement>('.avatar')?.style.backgroundImage).toContain('https://example.com/avatar.png');
    expect(result.querySelector<HTMLElement>('.cover')?.style.backgroundImage).toContain('https://example.com/cover.png');
    expect(result.querySelector('.name')?.getAttribute('href')).toBe('/user/Alice');
  });

  it('does not interpret image URLs, names, progress or status as HTML', () => {
    const url = 'https://example.com/image.png)" onmouseover="alert(1)"><img src=x onerror=alert(1)>';
    const result = render(activity({
      user: { id: 2, name: 'Alice"><img src=x onerror=alert(1)>', avatar: { medium: url } },
      media: { id: 3, type: 'ANIME', title: { romaji: 'Safe title' }, coverImage: { medium: url } },
      status: '<img src=x onerror=alert(1)>',
      progress: '<svg onload=alert(1)>',
    }));
    expect(result.querySelector('img, svg, [onerror], [onload], [onmouseover]')).toBeNull();
    expect(result.querySelector('.status')?.textContent).toContain('<svg onload=alert(1)>');
    expect(result.querySelector('.name')?.getAttribute('href')).toBe('/user/' + encodeURIComponent('Alice"><img src=x onerror=alert(1)>'));
  });

  it('keeps malicious avatar URLs out of text activity markup', () => {
    const result = render(activity({
      type: 'TEXT', text: 'Hello <world>',
      user: { id: 2, name: 'Alice', avatar: { medium: '"><img src=x onerror=alert(1)>' } },
    }));
    expect(result.querySelector('img, [onerror]')).toBeNull();
    expect(result.querySelector('.text')?.textContent).toBe('Hello <world>');
  });

  it('quotes image URLs when updating a cloned native activity', () => {
    document.body.innerHTML = '<div class="activity-anime"><a class="avatar"></a><a class="name"></a><div class="status"></div><a class="cover"></a></div>';
    const result = render(activity({
      user: { id: 2, name: 'Alice', avatar: { medium: 'https://example.com/a(b).png' } },
    }));
    expect(result.querySelector<HTMLElement>('.avatar')?.style.backgroundImage).toContain('https://example.com/a(b).png');
    expect(result.querySelector<HTMLElement>('.cover')?.style.backgroundImage).toContain('https://example.com/cover.png');
  });
  it.each([false, true])('rejects malformed media path fields before %s template rendering', (clone) => {
    if (clone) document.body.innerHTML = '<div class="activity-anime"><div class="status"></div></div>';
    const entry = activity(); entry.media!.type = 'ANIME"><img src=x onerror=alert(1)>' as 'ANIME';
    const result = render(entry);
    expect(result.children).toHaveLength(0); expect(result.querySelector('img, [onerror]')).toBeNull();
  });

  it.each([false, true])('omits non-web images in the %s template path', (clone) => {
    if (clone) document.body.innerHTML = '<div class="activity-anime"><a class="avatar" style="background-image: url(https://old.test/a)"></a><a class="cover" style="background-image: url(https://old.test/c)"></a></div>';
    const entry = activity();
    entry.user!.avatar.medium = 'javascript:alert(1)';
    entry.media!.coverImage.medium = 'data:image/svg+xml,<svg onload="alert(1)"/>';
    const result = render(entry);
    expect(result.querySelector<HTMLElement>('.avatar')?.style.backgroundImage).toBe('none');
    expect(result.querySelector<HTMLElement>('.cover')?.style.backgroundImage).toBe('none');
  });

  it.each([false, true])('canonicalizes relative images and preserves one CSS property in the %s path', (clone) => {
    if (clone) document.body.innerHTML = '<div class="activity-anime"><a class="avatar"></a><a class="cover"></a></div>';
    const entry = activity();
    entry.user!.avatar.medium = '/file/avatar.png';
    entry.media!.coverImage.medium = 'https://example.com/c"; color:red; background-image:url(javascript:alert(1));/*';
    const result = render(entry);
    expect(result.querySelector<HTMLElement>('.avatar')?.style.backgroundImage).toContain('https://anilist.co/file/avatar.png');
    const cover = result.querySelector<HTMLElement>('.cover')!;
    expect(cover.style.backgroundImage).toContain('https://example.com/');
    expect(cover.style.color).toBe('');
    expect(cover.style.backgroundImage).toMatch(/^url\("https:\/\/example\.com\//);
  });

  it.each([false, true])('skips malformed rows without aborting valid activities in the %s path', (clone) => {
    if (clone) document.body.innerHTML = '<div class="activity-anime"><a class="avatar"></a><a class="name"></a><div class="status"></div></div>';
    const valid = activity(); const malformed = { ...activity(), status: { value: 'watched' } };
    const result = document.createElement('div');
    const renderer = new ActivityRenderer(makeLogger());
    expect(() => renderer.renderCustomActivities([malformed, valid] as AniListActivity[], result)).not.toThrow();
    expect(result.children).toHaveLength(1); expect(result.querySelector('.name')?.textContent).toBe('Alice');
  });

  it('contains ill-formed profile names and prevents coercing counts into valid activity data', () => {
    const badName = activity({ user: { id: 2, name: '\uD800', avatar: { medium: '' } } });
    expect(() => render(badName)).not.toThrow(); expect(render(badName).children).toHaveLength(0);
    expect(render(activity({ replyCount: '2' as unknown as number })).children).toHaveLength(0);
  });

  it('retains a missing owner as plain Unknown text without a profile link', () => {
    const result = render(activity({ type: 'TEXT', text: 'Hello', user: null }));
    expect(result.querySelector('.name')?.textContent).toBe('Unknown');
    expect(result.querySelector('.name')?.hasAttribute('href')).toBe(false);
    expect(result.querySelector('.avatar')?.hasAttribute('href')).toBe(false);
  });

  it.each([false, true])('renders a deleted media without retaining another entry’s title/cover in the %s path', clone => {
    if (clone) document.body.innerHTML = '<div class="activity-anime"><a class="avatar" href="/user/Other"></a><a class="name" href="/user/Other"></a><div class="status">Old title</div><a class="cover" href="/anime/99"></a></div>';
    const entry = { ...activity(), media: null, user: null } as unknown as AniListActivity;
    const output = render(entry);
    expect(output.querySelector('.status')?.textContent).toContain('watched episode');
    expect(output.querySelector('.status')?.textContent).not.toContain('Old title');
    const cover = output.querySelector<HTMLElement>('.cover'); expect(cover === null || cover.style.display === 'none').toBe(true);
    expect(output.querySelector('.name')?.hasAttribute('href')).toBe(false);
  });

  it('makes a retry single-use and inert after its error DOM is replaced', () => {
    const renderer = new ActivityRenderer(makeLogger());
    const container = document.createElement('div'); document.body.append(container);
    const retry = vi.fn(); renderer.showErrorMessage(container, retry);
    const button = container.querySelector<HTMLButtonElement>('button')!;
    expect(container.textContent).not.toContain('No activities found'); button.click(); button.click(); expect(retry).toHaveBeenCalledOnce();
    const next = vi.fn(); renderer.showErrorMessage(container, next);
    const stale = container.querySelector<HTMLButtonElement>('button')!; renderer.showLoader(container);
    stale.click(); expect(next).not.toHaveBeenCalled();
  });

});


describe('ActivityRenderer custom-list isolation and clone source', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('keeps custom-list clones out of native hide, show and filter passes', () => {
    document.body.innerHTML = '<div class="activity-feed">'
      + '<div class="activity-entry activity-anime" id="native">Native</div>'
      + '<div class="activity-entry activity-anime au-custom-activity" id="custom" style="display: block">Custom</div>'
      + '</div>';
    const renderer = new ActivityRenderer(makeLogger());
    const custom = document.getElementById('custom') as HTMLElement;

    renderer.hideNativeActivities();
    expect((document.getElementById('native') as HTMLElement).style.display).toBe('none');
    expect(custom.style.display).toBe('block');

    renderer.applyFilters(new Set<ActivityFilterType>(), '');
    expect((document.getElementById('native') as HTMLElement).classList.contains('au-activity-hidden')).toBe(true);
    expect(custom.classList.contains('au-activity-hidden')).toBe(false);
    expect(custom.style.display).toBe('block');

    renderer.showNativeActivities();
    expect(custom.style.display).toBe('block');
  });

  it('clones from a visible native row and strips hidden and liked state from the clone', () => {
    document.body.innerHTML = '<div class="activity-feed">'
      + '<div class="activity-entry activity-anime au-activity-hidden liked" data-src="hidden" style="display: none">'
      + '<div class="wrap"><div class="list"><a class="avatar"></a><a class="name">Old</a><div class="status">old</div></div>'
      + '<div class="actions"><div class="action likes liked"></div></div></div></div>'
      + '<div class="activity-entry activity-anime" data-src="visible">'
      + '<div class="wrap"><div class="list"><a class="avatar"></a><a class="name">Old</a><div class="status">old</div></div>'
      + '<div class="actions"><div class="action likes"></div></div></div></div>'
      + '</div>';
    const container = document.createElement('div');
    new ActivityRenderer(makeLogger()).renderCustomActivities([activity()], container);

    const clone = container.querySelector<HTMLElement>('.au-custom-activity')!;
    expect(clone.getAttribute('data-src')).toBe('visible');
    expect(clone.classList.contains('au-activity-hidden')).toBe(false);
    expect(clone.classList.contains('liked')).toBe(false);
    expect(clone.querySelector('.liked')).toBeNull();
    expect(clone.style.display).toBe('');
    expect(clone.querySelector('.name')?.textContent).toBe('Alice');
  });

  it('falls back to the hidden template only when no visible native row exists', () => {
    document.body.innerHTML = '<div class="activity-feed">'
      + '<div class="activity-entry activity-anime au-activity-hidden" data-src="hidden" style="display: none">'
      + '<div class="wrap"><div class="list"><a class="avatar"></a><a class="name">Old</a></div></div></div></div>';
    const container = document.createElement('div');
    new ActivityRenderer(makeLogger()).renderCustomActivities([activity()], container);
    const clone = container.querySelector<HTMLElement>('.au-custom-activity')!;
    expect(clone.getAttribute('data-src')).toBe('hidden');
    expect(clone.classList.contains('au-activity-hidden')).toBe(false);
    expect(clone.style.display).toBe('');
  });
});
