/** Production picker/store/CSS over deterministic data, without personal AniList access. */
import 'reflect-metadata';
import '@/styles/main.css';
import '@/styles/astra.css';
import { CustomCalendarPlanPanel } from '@/modules/calendar/components/CustomCalendarPlanPanel';
import { CalendarStore } from '@/modules/calendar/CalendarStore';

let preview: CustomCalendarPlanPanel | null = null;
function row(id: number, title: string, airing = false) {
  return {
    id: id + 100,
    mediaId: id,
    userId: 1,
    progress: id === 1 ? 2 : 0,
    status: 'CURRENT',
    media: {
      id,
      type: 'ANIME',
      status: airing ? 'RELEASING' : 'FINISHED',
      episodes: 12,
      title: { english: title, romaji: id === 1 ? 'Saibāpanku' : title, native: null },
      coverImage: { large: null, medium: null },
      siteUrl: `https://anilist.co/anime/${id}`,
      nextAiringEpisode: airing
        ? { id: id + 200, mediaId: id, episode: 3, airingAt: 1791489600, timeUntilAiring: 3600 }
        : null,
    },
  };
}
const rows = [
  row(1, 'Cyberpunk: Edgerunners'),
  row(2, 'Airing anime', true),
  row(3, 'Cowboy Bebop'),
];
function fixture(extraRows = 0) {
  let requests = 0;
  let changed = 0;
  const library = [
    ...rows,
    ...Array.from({ length: extraRows }, (_, index) => row(index + 4, `Anime ${index + 4}`)),
  ];
  const api = {
    ensureContext: async () => ({ userId: 1, sessionId: 'calendar-plans-fixture' }),
    getContext: () => ({ userId: 1, sessionId: 'calendar-plans-fixture' }),
    isAuthenticated: () => true,
    query: async (query: string) => {
      requests++;
      if (query.includes('SearchCalendarAnime')) {
        if (/mediaListEntry\s*\(/.test(query))
          throw new Error('Unsupported mediaListEntry argument');
        return {
          Page: {
            media: library
              .filter((item) => item.mediaId === 1)
              .map((item) => ({
                ...item.media,
                format: 'ONA',
                seasonYear: 2022,
                mediaListEntry: {
                  id: item.id,
                  userId: 1,
                  mediaId: item.mediaId,
                  progress: item.progress,
                  status: item.status,
                },
              })),
          },
        };
      }
      return {
        MediaListCollection: {
          user: { id: 1 },
          hasNextChunk: false,
          lists: [{ entries: library }],
        },
      };
    },
  };
  const store = new CalendarStore(
    { get: async () => null, set: async () => true } as never,
    { create: () => ({}) } as never,
    api as never
  );
  const panel = new CustomCalendarPlanPanel({
    api: api as never,
    store,
    ownerId: 1,
    onChanged: () => {
      changed++;
    },
    onClose: () => {},
  });
  return { panel, store, requests: () => requests, changed: () => changed };
}
async function until(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 4000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Calendar plan fixture timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function control<T extends HTMLElement = HTMLElement>(selector: string): T {
  return document.querySelector<T>(selector)!;
}
function input(value: string) {
  control<HTMLInputElement>('#calendar-plan-search-input').value = value;
  control('#calendar-plan-search-input').dispatchEvent(new Event('input', { bubbles: true }));
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runCalendarPlanBrowserFixture(): Promise<string[]> {
  const checks: string[] = [];
  const f = fixture();
  const previousOverflow = document.body.style.overflow;
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  try {
    f.panel.mount(document.body);
    await until(() => document.querySelectorAll('[data-media-id]').length === 3);
    const box = control('.calendar-plan-panel').getBoundingClientRect();
    assert(
      box.width > 300 && box.width <= innerWidth && box.height > 250,
      'picker must have visible native layout'
    );
    assert(
      control<HTMLButtonElement>('[data-media-id="2"]').disabled,
      'airing titles must stay visible but disabled'
    );
    assert(
      control('.calendar-plan-status').textContent?.startsWith('2 anime'),
      'the result count must exclude airing titles'
    );
    input('saibapanku');
    assert(
      document.querySelectorAll('[data-media-id]').length === 1 && f.requests() === 1,
      'alternate title filter must stay local'
    );
    checks.push(
      'native list picker renders with production CSS and filters title variants locally'
    );

    control('[data-media-id="1"]').click();
    assert(
      getComputedStyle(control('.calendar-plan-picker')).display === 'none',
      'selection must hide the picker'
    );
    assert(
      getComputedStyle(control('.calendar-plan-editor')).display !== 'none',
      'selection must reveal the editor'
    );
    control<HTMLSelectElement>('[name="day"]').value = 'Friday';
    control<HTMLInputElement>('[name="time"]').value = '21:30';
    control('.calendar-plan-save').click();
    await until(() => !document.querySelector('.calendar-plan-overlay'));
    assert(
      f.store.getCustomPlans(1)[0]?.time === '21:30' && f.changed() === 1,
      'native form must durably save once'
    );
    assert(
      f.store.getState().entries[0]?.calendarKind === 'personal',
      'saved plan must enter the actual calendar store'
    );
    assert(document.activeElement === opener, 'closing must restore focus');
    checks.push('native weekly form saves a personal entry and restores focus');

    const g = fixture();
    try {
      g.panel.mount(document.body);
      await until(() => document.querySelectorAll('[data-media-id]').length === 2);
      control('[data-source="search"]').click();
      input('Cyberp');
      await until(() => control('[data-media-id="1"]') !== null);
      assert(
        g.requests() === 2 && control('[data-media-id="1"]').textContent?.includes('Cyberpunk'),
        'partial-title suggestions must resolve after debounce'
      );
      const first = control('.calendar-plan-panel__close');
      const focusable = [
        ...document.querySelectorAll<HTMLElement>(
          '.calendar-plan-panel button:not(:disabled), .calendar-plan-panel input'
        ),
      ].filter(
        (item) =>
          item.tabIndex >= 0 && item.getClientRects().length > 0 && !item.closest('[hidden]')
      );
      const last = focusable[focusable.length - 1];
      last.focus();
      last.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      );
      assert(document.activeElement === first, 'Tab must stay inside the native dialog');
      first.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      assert(
        !document.querySelector('.calendar-plan-overlay'),
        'Escape must close the active picker'
      );
      checks.push('partial-title suggestions, focus containment and Escape work in Chromium');
    } finally {
      g.panel.close();
    }
    return checks;
  } finally {
    f.panel.close();
    opener.remove();
    document.body.style.overflow = previousOverflow;
  }
}

export async function mountCalendarPlanPreview(view: 'lists' | 'search' | 'editor'): Promise<void> {
  preview?.close();
  document.body.replaceChildren();
  const f = fixture(12);
  preview = f.panel;
  preview.mount(document.body);
  await until(() => document.querySelectorAll('[data-media-id]').length === 14);
  const results = control('.calendar-plan-results');
  assert(results.scrollHeight > results.clientHeight, 'preview must exercise an overflowing list');
  results.scrollTop = 20;
  assert(results.scrollTop > 0, 'the styled results list must remain scrollable');
  results.scrollTop = 0;
  for (const scroller of [
    results,
    control('.calendar-plan-panel'),
    control('.calendar-plan-saved__list'),
  ]) {
    assert(
      getComputedStyle(scroller, '::-webkit-scrollbar').width === '6px',
      'calendar scrollers must use the thin Astra scrollbar'
    );
    assert(
      getComputedStyle(scroller, '::-webkit-scrollbar-thumb').borderRadius === '10px',
      'calendar scrollers must share the rounded Astra thumb'
    );
    assert(
      getComputedStyle(scroller, '::-webkit-scrollbar-thumb').backgroundColor !==
        'rgba(0, 0, 0, 0)',
      'the Astra scrollbar thumb must resolve to a visible color'
    );
    assert(
      getComputedStyle(scroller, '::-webkit-scrollbar-button').display === 'none',
      'native scrollbar arrow buttons must be absent'
    );
  }
  if (view === 'search') {
    control('[data-source="search"]').click();
    input('Cyberp');
    await until(() => !!document.querySelector('[data-media-id="1"]'));
  }
  if (view === 'editor') control('[data-media-id="1"]').click();
}
