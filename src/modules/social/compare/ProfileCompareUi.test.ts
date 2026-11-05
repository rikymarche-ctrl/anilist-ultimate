import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import { AstraOverlayService } from '@modules/astra/services/AstraOverlayService';
import {
  buildComparison,
  type CompareEntry,
  type CompareReport,
  type CompareUser,
} from './ProfileCompareModel';
import { ProfileCompareModule, listMediaFromPath } from './ProfileCompareModule';
import { CompareError } from './ProfileCompareService';
import { compareSlides, plotBubbles } from './ProfileCompareSlides';
import { dayText, leadText } from './ProfileCompareDeepSlides';
import { compareBrowser, sortBrowserRows } from './ProfileCompareBrowser';
import { ProfileCompareView, failureMessage } from './ProfileCompareView';

const viewer: CompareUser = { id: 1, name: 'Me', avatar: null, stats: { count: 2, minutes: 600, units: 10, volumes: 0, tags: [], studios: [], voiceActors: [], staff: [] } };
const other: CompareUser = { id: 2, name: '<b>Friend</b>', avatar: null, stats: { count: 2, minutes: 600, units: 10, volumes: 0, tags: [], studios: [], voiceActors: [], staff: [] } };

const entry = (mediaId: number, overrides: Partial<CompareEntry> = {}): CompareEntry => ({
  mediaId,
  title: `Title ${mediaId}`,
  cover: null,
  status: 'COMPLETED',
  score: 0,
  private: false,
  adult: false,
  unreleased: false,
  started: null,
  completed: null,
  genres: ['Drama'],
  repeat: 0,
  format: 'TV',
  releaseYear: 2015,
  country: 'JP',
  popularity: 100,
  ...overrides,
});

const fullReport = (): CompareReport => {
  const ids = [1, 2, 3, 4, 5, 6];
  return buildComparison('ANIME', viewer,
    other,
    ids.map((id) => entry(id, { score: id + 4, started: id * 10 })),
    [...ids.map((id) => entry(id, { score: 11 - id, started: id * 20 })), entry(7, { score: 9 })]
  );
};

const labels = (report: CompareReport) => compareSlides(report).map((slide) => slide.label);

describe('compareSlides', () => {
  it('tells the whole story when there is data for it', () => {
    const found = labels(fullReport());
    for (const label of ['Intro', 'Head to head', 'Shared titles', 'Score affinity', 'Scoring habits', 'Genres', 'Formats and decades', 'Who was first', 'All titles', 'Verdict'])
      expect(found).toContain(label);
  });

  it('keeps an honest story when nothing is shared', () => {
    const report = buildComparison('ANIME', viewer, other, [entry(1, { score: 9 })], [entry(2, { score: 8 })]);
    const found = labels(report);

    for (const label of ['Score affinity', 'You rate higher', 'They rate higher', 'Who was first']) expect(found).not.toContain(label);
    expect(found).toContain('Homework');
    expect(compareSlides(report).find((slide) => slide.label === 'Shared titles')!.element.textContent).toContain('Not a single title in common');
  });

  it('speaks manga on a manga comparison', () => {
    const report = buildComparison('MANGA', viewer, other, [entry(1, { score: 9 })], [entry(1, { score: 3 })]);
    const slides = compareSlides(report);

    expect(slides[0].element.textContent).toContain('Manga lists');
    expect(slides[1].element.textContent).toContain('Chapters');
    expect(slides.find((slide) => slide.label === 'You rate higher')!.element.querySelector<HTMLAnchorElement>('a')!.href).toContain('/manga/1');
  });

  it('shows both dates on who got there first, never just a number', () => {
    const first = compareSlides(fullReport()).find((slide) => slide.label === 'Who was first')!.element;

    expect(first.textContent).toContain(dayText(60));
    expect(first.textContent).toContain(dayText(120));
    expect(first.textContent).toContain('You were first on');
  });

  it('puts every immersive slide on a blurred panel and leaves posters alone', () => {
    for (const slide of compareSlides(fullReport())) {
      const panels = slide.element.querySelectorAll('.aw-slide-inner > .versus-panel').length;
      expect(panels).toBe(slide.mode === 'poster' ? 0 : 1);
    }
  });

  it('renders user names as text, never as markup', () => {
    const intro = compareSlides(fullReport())[0].element;

    expect(intro.querySelector('h3 b')).toBeNull();
    expect(intro.querySelector('.versus-lockup img, .versus-lockup .versus-avatar')).not.toBeNull();
    expect(intro.textContent).toContain('<b>Friend</b>');
  });

  it('links every disagreement to its AniList page', () => {
    const fights = compareSlides(fullReport()).find((slide) => slide.label === 'They rate higher' || slide.label === 'You rate higher')!;
    const link = fights.element.querySelector<HTMLAnchorElement>('[data-versus-fights] a')!;

    expect(link.href).toMatch(/^https:\/\/anilist\.co\/anime\/\d+$/);
    expect(link.rel).toContain('noopener');
  });
});

describe('plotBubbles', () => {
  const point = (viewerScore: number, otherScore: number) => ({ mediaId: 1, title: 'T', cover: null, viewerScore, otherScore });

  it('merges nearly equal pairs of scores, biggest first', () => {
    expect(plotBubbles([point(9, 8), point(8.9, 8.1), point(5, 5)])).toEqual([
      { viewerScore: 9, otherScore: 8, count: 2 },
      { viewerScore: 5, otherScore: 5, count: 1 },
    ]);
  });
});

describe('leadText', () => {
  it('uses the unit that reads best', () => {
    expect(leadText(1)).toBe('1 day');
    expect(leadText(45)).toBe('45 days');
    expect(leadText(300)).toBe('10 months');
    expect(leadText(1461)).toBe('4.0 years');
  });
});

describe('failureMessage', () => {
  it('explains a private list without blaming the reader and offers no retry', () => {
    const message = failureMessage('private', 'Friend');

    expect(message.title).toBe("Friend's list is private");
    expect(message.retry).toBeUndefined();
  });

  it('offers a retry only when trying again can help', () => {
    expect(failureMessage('unavailable', 'Friend').retry).toBe(true);
    expect(failureMessage('not-found', 'Friend').retry).toBeUndefined();
  });
});

describe('ProfileCompareView', () => {
  const data = {
    viewer,
    other,
    viewerEntries: [entry(1, { score: 9 })],
    otherEntries: [entry(1, { score: 3 })],
  };
  let host: HTMLElement;
  let view: ProfileCompareView | null;

  const open = (load: () => Promise<unknown>, close = vi.fn()) => {
    view = new ProfileCompareView({ load } as never, 'Friend', 'ANIME', close);
    view.mount(host);
    return close;
  };

  beforeEach(() => {
    host = document.body.appendChild(document.createElement('div'));
    view = null;
  });
  afterEach(() => {
    view?.unmount();
    host.remove();
  });

  it('shows the story and enables the download once loaded', async () => {
    open(async () => data);
    await vi.waitFor(() => expect(host.querySelector('.aw-story')).not.toBeNull());

    expect(host.querySelector<HTMLButtonElement>('[data-versus-export]')!.disabled).toBe(false);
  });

  it('shows the private screen with no retry', async () => {
    open(async () => {
      throw new CompareError('private');
    });
    await vi.waitFor(() => expect(host.textContent).toContain("Friend's list is private"));

    expect(host.querySelector('[data-versus-retry]')).toBeNull();
    expect(host.querySelector('.aw-story')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[data-versus-export]')!.disabled).toBe(true);
  });

  it('retries after a transport failure', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new CompareError('unavailable'))
      .mockResolvedValue(data);
    open(load);
    await vi.waitFor(() => expect(host.querySelector('[data-versus-retry]')).not.toBeNull());

    host.querySelector<HTMLButtonElement>('[data-versus-retry]')!.click();

    await vi.waitFor(() => expect(host.querySelector('.aw-story')).not.toBeNull());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('says so when one list has nothing watched', async () => {
    open(async () => ({ ...data, otherEntries: [entry(1, { status: 'PLANNING' })] }));

    await vi.waitFor(() => expect(host.textContent).toContain('Nothing to compare yet'));
    expect(host.querySelector('.aw-story')).toBeNull();
  });

  it('closes on Escape and on the close button', () => {
    const close = open(() => new Promise(() => undefined));

    host
      .querySelector('.aw-shell')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    host.querySelector<HTMLButtonElement>('[data-versus-close]')!.click();

    expect(close).toHaveBeenCalledTimes(2);
  });

  it('ignores a response that arrives after closing', async () => {
    let finish!: (value: unknown) => void;
    open(() => new Promise((resolve) => (finish = resolve)));

    view!.unmount();
    view = null;
    finish(data);
    await Promise.resolve();

    expect(host.querySelector('.aw-story')).toBeNull();
  });
});

describe('compareBrowser', () => {
  const rows = {
    shared: [
      { mediaId: 1, title: 'Alpha', cover: null, viewerScore: 9, otherScore: 8 },
      { mediaId: 2, title: 'Beta', cover: null, viewerScore: 9, otherScore: 2 },
    ],
    viewerOnly: [{ mediaId: 3, title: 'Gamma', cover: null, viewerScore: 7, otherScore: null }],
    otherOnly: [],
  };

  it('sorts by biggest gap first', () => {
    expect(sortBrowserRows(rows.shared, 'gap').map((row) => row.title)).toEqual(['Beta', 'Alpha']);
  });

  it('switches tabs and filters by search', () => {
    const root = compareBrowser({ media: 'anime', otherName: 'Friend', rows });
    const titles = () => [...root.querySelectorAll('.versus-browse-title')].map((link) => link.textContent);

    expect(titles()).toEqual(['Beta', 'Alpha']);
    const search = root.querySelector<HTMLInputElement>('[data-versus-search]')!;
    search.value = 'alp';
    search.dispatchEvent(new Event('input'));
    expect(titles()).toEqual(['Alpha']);
    search.value = '';
    root.querySelector<HTMLButtonElement>('[data-versus-tab="viewerOnly"]')!.click();
    expect(titles()).toEqual(['Gamma']);
  });
});

describe('ProfileCompareModule', () => {
  const page = (name: string, native = true) =>
    `<div class="header-wrap"><div class="banner-content"><div class="name-wrapper"><h1 class="name"> ${name} </h1></div></div></div>
     <div class="filters-wrap"><div class="filters"><div class="filter-group">Lists</div>${native ? '<a class="filter-group compare-btn">Compare with your list</a><div class="tail"></div>' : ''}</div></div>`;
  let api: { isAuthenticated: ReturnType<typeof vi.fn>; getCurrentUser: ReturnType<typeof vi.fn> };
  let service: { load: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
  let overlays: AstraOverlayService;
  let bus: EventBus;
  let module: ProfileCompareModule;

  const button = () => document.querySelector<HTMLButtonElement>('.au-astra-compare');
  const overlay = () => document.getElementById('astra-overlay-versus');

  beforeEach(() => {
    history.replaceState({}, '', '/user/Friend/animelist');
    document.body.innerHTML = page('Friend');
    api = { isAuthenticated: vi.fn(() => true), getCurrentUser: vi.fn(async () => ({ id: 1, name: 'Me' })) };
    service = { load: vi.fn(() => new Promise(() => undefined)), clear: vi.fn() };
    overlays = new AstraOverlayService();
    bus = new EventBus();
    module = new ProfileCompareModule(api as never, service as never, overlays, bus);
  });
  afterEach(async () => {
    await module.destroy();
    overlays.dispose();
    document.body.innerHTML = '';
  });

  it('recognises anime and manga list pages only', () => {
    expect(listMediaFromPath('/user/Friend/animelist/Completed')).toBe('ANIME');
    expect(listMediaFromPath('/user/Friend/mangalist')).toBe('MANGA');
    expect(listMediaFromPath('/user/Friend/')).toBeNull();
  });

  it('sits right under the native button, without loading any list', async () => {
    await module.init();

    expect(button()?.textContent).toBe('Astra compare');
    expect(document.querySelector('.compare-btn')!.nextElementSibling).toBe(button());
    expect(service.load).not.toHaveBeenCalled();
  });

  it('falls back to the end of the filters when the native button is missing', async () => {
    document.body.innerHTML = page('Friend', false);

    await module.init();

    expect(document.querySelector('.filters')!.lastElementChild).toBe(button());
  });

  it('stays out of profile overviews, your own lists and signed-out pages', async () => {
    history.replaceState({}, '', '/user/Friend/');
    await module.init();
    expect(button()).toBeNull();

    history.replaceState({}, '', '/user/Friend/animelist');
    api.getCurrentUser.mockResolvedValue({ id: 1, name: 'FRIEND' });
    bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/user/Friend/animelist', previousPath: '/', timestamp: new Date() });
    await Promise.resolve();
    expect(button()).toBeNull();
  });

  it.each([
    ['/user/Friend/animelist', 'ANIME'],
    ['/user/Friend/mangalist', 'MANGA'],
  ])('opens %s as %s, and only once', async (path, media) => {
    history.replaceState({}, '', path);
    await module.init();

    button()!.click();
    button()!.click();

    expect(overlay()?.querySelector('.versus-wrapped')).not.toBeNull();
    expect(service.load).toHaveBeenCalledTimes(1);
    expect(service.load.mock.calls[0].slice(0, 2)).toEqual(['Friend', media]);
  });

  it('closes the story at once when the page changes', async () => {
    await module.init();
    button()!.click();

    history.replaceState({}, '', '/anime/1');
    bus.emit(EVENT_TYPES.PAGE_CHANGED, { path: '/anime/1', previousPath: '/', timestamp: new Date() });

    expect(overlay()).toBeNull();
    expect(button()).toBeNull();
  });

  it('forgets cached lists and closes on an account change', async () => {
    await module.init();
    button()!.click();

    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: false, timestamp: new Date() });

    expect(service.clear).toHaveBeenCalled();
    expect(overlay()).toBeNull();
  });

  it('follows the native button when Vue adds it late', async () => {
    document.body.innerHTML = page('Friend', false);
    await module.init();

    const native = document.createElement('a');
    native.className = 'compare-btn';
    document.querySelector('.filters')!.prepend(native);

    await vi.waitFor(() => expect(native.nextElementSibling).toBe(button()));
  });
});
