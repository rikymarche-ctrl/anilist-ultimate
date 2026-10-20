import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyMediaListFilters,
  readMediaListFilters,
  sameFilters,
} from './MediaListFilterControls';
import type { MediaListFilterState, RestoreRunControl } from './PageStateTypes';

const YEAR_MIN = 1950;
const YEAR_MAX = 2027;
const RUNWAY = { left: 100, width: 200 };

/** Element UI single select as AniList renders it: options stay hidden inside until first opened. */
const single = (placeholder: string, labels: string[], value = '') => `
  <div class="el-select"><div class="el-input"><input class="el-input__inner" placeholder="${placeholder}" value="${value}"></div>
    <div class="el-select-dropdown" style="display: none"><ul>${labels.map((label) => `<li class="el-select-dropdown__item"><span>${label}</span></li>`).join('')}</ul></div></div>`;

function fixture(): void {
  document.body.innerHTML = `
    <div class="medialist cards">
      <div class="filters-wrap">
        <div class="filter-mobile-wrap"><div class="el-input entry-filter"><input class="el-input__inner" placeholder="Filter"></div></div>
        <div class="filters">
          <div class="filter-group"><div class="group-header">Lists</div><span class="active">all<span class="count">3</span></span><span>Planning<span class="count">1</span></span></div>
          <div class="filter-group"><div class="group-header">Filters</div>
            ${single('Format', ['TV', 'OVA', 'Movie'])}
            ${single('Status', ['Finished', 'Releasing'])}
            <div class="el-select genres"><div class="el-select__tags"><span></span><input class="el-select__input"></div>
              <div class="el-input"><input class="el-input__inner" placeholder="Genres &amp; Tags"></div>
              <div class="el-select-dropdown" style="display: none"><ul class="genres-list"><li class="el-select-dropdown__item"><span>Action</span></li><li class="el-select-dropdown__item"><span>Drama</span></li></ul></div></div>
            ${single('Country', ['Japan', 'South Korea'])}
          </div>
          <div class="filter-group"><div class="group-header">
              Year
              </div><div class="el-slider" aria-valuemin="${YEAR_MIN}" aria-valuemax="${YEAR_MAX}"><div class="el-slider__runway"></div></div></div>
          <div class="filter-group"><div class="group-header">Sort</div>${single('Sort', ['Title', 'Score'], 'Score')}</div>
        </div>
      </div>
      <div class="lists"><div class="actions"><div class="theme-switch"><span></span> <span></span> <span class="active"></span></div></div></div>
    </div>`;
  emulateElementUi();
}

/** Minimal stand-in for the Vue/Element UI behaviour the driver relies on. */
function emulateElementUi(): void {
  for (const select of document.querySelectorAll<HTMLElement>('.el-select')) {
    const tags = select.querySelector<HTMLElement>('.el-select__tags > span');
    const input = select.querySelector<HTMLInputElement>('input.el-input__inner')!;
    select.addEventListener('click', (event) => {
      const option = (event.target as HTMLElement).closest('.el-select-dropdown__item');
      if (!option) return;
      const label = option.textContent!.trim();
      if (!tags) {
        input.value = label;
        return;
      }
      tags.insertAdjacentHTML(
        'beforeend',
        `<span class="el-tag"><span class="el-select__tags-text">${label}</span><i class="el-tag__close"></i></span>`
      );
      select.querySelector<HTMLInputElement>('.el-select__input')!.focus();
    });
    tags?.addEventListener('click', (event) =>
      (event.target as HTMLElement).closest('.el-tag__close')?.parentElement?.remove()
    );
    select.querySelector('.el-input')!.addEventListener('mouseenter', () => {
      if (!input.value || select.querySelector('.el-icon-circle-close')) return;
      const clear = document.createElement('i');
      clear.className = 'el-select__caret el-icon-circle-close';
      clear.addEventListener('click', () => {
        input.value = '';
        clear.remove();
      });
      select.querySelector('.el-input')!.append(clear);
    });
  }
  const runway = document.querySelector<HTMLElement>('.el-slider__runway')!;
  Object.defineProperty(runway, 'clientWidth', { value: RUNWAY.width, configurable: true });
  runway.getBoundingClientRect = () =>
    ({ left: RUNWAY.left, top: 0, height: 6, width: RUNWAY.width }) as DOMRect;
  runway.addEventListener('click', (event) =>
    setYear(
      Math.round(
        YEAR_MIN +
          (((event as MouseEvent).clientX - RUNWAY.left) / RUNWAY.width) * (YEAR_MAX - YEAR_MIN)
      )
    )
  );
  for (const view of document.querySelectorAll<HTMLElement>('.theme-switch > span')) {
    view.addEventListener('click', () =>
      document
        .querySelectorAll('.theme-switch > span')
        .forEach((other) => other.classList.toggle('active', other === view))
    );
  }
}

function setYear(year: number): void {
  const header = document.querySelectorAll('.group-header')[2] as HTMLElement;
  header.querySelector('.value')?.remove();
  if (year === YEAR_MIN) return;
  header.insertAdjacentHTML(
    'beforeend',
    `<span class="value"><i class="el-icon-circle-close"></i>${year}</span>`
  );
  header.querySelector('.el-icon-circle-close')!.addEventListener('click', () => setYear(YEAR_MIN));
}

/** Control that aborts once `budget` DOM actions have settled. */
function control(budget = Number.POSITIVE_INFINITY): RestoreRunControl & { settled: number } {
  return {
    settled: 0,
    get aborted() {
      return this.settled >= budget;
    },
    async waitUntil(predicate, timeoutMs) {
      const until = Date.now() + timeoutMs;
      while (!predicate()) {
        if (Date.now() > until) return false;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return true;
    },
    async settle() {
      this.settled++;
    },
  };
}

const defaults: MediaListFilterState = {
  view: 2,
  title: '',
  format: null,
  status: null,
  genres: [],
  country: null,
  year: null,
  sort: 'Score',
};
const target: MediaListFilterState = {
  view: 0,
  title: 'gundam',
  format: 'OVA',
  status: 'Releasing',
  genres: ['Action', 'Drama'],
  country: 'Japan',
  year: 2010,
  sort: 'Title',
};

describe('media list filter controls', () => {
  beforeEach(fixture);
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reads the state AniList shows, treating the year minimum as no filter', () => {
    expect(readMediaListFilters()).toEqual(defaults);
    setYear(2001);
    expect(readMediaListFilters()?.year).toBe(2001);
    document.body.innerHTML = '';
    expect(readMediaListFilters()).toBeNull();
  });

  it('drives every control until the sidebar reads back the target state', async () => {
    await expect(applyMediaListFilters(target, control())).resolves.toBe(true);
    expect(readMediaListFilters()).toEqual(target);
    // Pick focus left on the multi-select is released like after a user's Escape.
    expect(document.activeElement).toBe(document.body);
  });

  it('waits for tag options that arrive after the sidebar renders', async () => {
    const late = applyMediaListFilters({ ...defaults, genres: ['Mecha'] }, control());
    setTimeout(
      () =>
        document
          .querySelector('.genres-list')!
          .insertAdjacentHTML(
            'beforeend',
            '<li class="el-select-dropdown__item"><span>Mecha</span></li>'
          ),
      20
    );
    await expect(late).resolves.toBe(true);
    expect(readMediaListFilters()?.genres).toEqual(['Mecha']);
  });

  it('clears values the target does not have', async () => {
    await applyMediaListFilters(target, control());
    const cleared = { ...target, format: null, genres: ['Drama'], year: null };
    await expect(applyMediaListFilters(cleared, control())).resolves.toBe(true);
    expect(readMediaListFilters()).toEqual(cleared);
  });

  it('stops between steps once the run is aborted', async () => {
    const run = control(1);
    await expect(applyMediaListFilters(target, run)).resolves.toBe(false);
    const state = readMediaListFilters()!;
    expect(state.view).toBe(0);
    expect([state.title, state.format, state.genres.length, state.year]).toEqual([
      '',
      null,
      0,
      null,
    ]);
  });

  it('skips the year when the slider has no geometry (collapsed mobile sidebar)', async () => {
    Object.defineProperty(document.querySelector('.el-slider__runway'), 'clientWidth', {
      value: 0,
    });
    await expect(applyMediaListFilters({ ...defaults, year: 2010 }, control())).resolves.toBe(
      false
    );
    expect(readMediaListFilters()?.year).toBeNull();
  });

  it('compares states ignoring genre order', () => {
    expect(sameFilters(target, { ...target, genres: ['Drama', 'Action'] })).toBe(true);
    expect(sameFilters(target, { ...target, sort: 'Score' })).toBe(false);
    expect(sameFilters(null, null)).toBe(true);
    expect(sameFilters(target, null)).toBe(false);
  });
});
