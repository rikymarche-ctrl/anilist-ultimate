/**
 * @file ProfileCompareBrowser.ts
 * @description Searchable, sortable list of every shared and unshared title: the exact,
 * title-by-title view of AniList's own compare page, inside the story. Rows render in pages,
 * so a list of thousands stays light.
 */

import { html } from '@core/utils/Template';
import { formatNumber } from '@modules/astra/ui/wrapped/WrappedFormat';
import { coverArt } from '@modules/astra/ui/wrapped/WrappedStory';
import type { BrowserRow } from './ProfileCompareExtras';

const PAGE_SIZE = 100;

type BrowserTab = 'shared' | 'viewerOnly' | 'otherOnly';
type BrowserSort = 'gap' | 'viewer' | 'other' | 'title';

export interface BrowserData {
  media: string;
  otherName: string;
  rows: Readonly<Record<BrowserTab, readonly BrowserRow[]>>;
}

const scoreText = (score: number | null): string =>
  score === null ? '–' : score === 0 ? 'NR' : formatNumber(score, score % 1 ? 1 : 0);

export function sortBrowserRows(rows: readonly BrowserRow[], sort: BrowserSort): BrowserRow[] {
  const gap = (row: BrowserRow) =>
    row.viewerScore && row.otherScore ? Math.abs(row.viewerScore - row.otherScore) : -1;
  const compare: Record<BrowserSort, (left: BrowserRow, right: BrowserRow) => number> = {
    gap: (left, right) => gap(right) - gap(left),
    viewer: (left, right) => (right.viewerScore ?? 0) - (left.viewerScore ?? 0),
    other: (left, right) => (right.otherScore ?? 0) - (left.otherScore ?? 0),
    title: () => 0,
  };
  return [...rows].sort(
    (left, right) => compare[sort](left, right) || left.title.localeCompare(right.title)
  );
}

function rowElement(row: BrowserRow, media: string): HTMLElement {
  const element = html`<li class="versus-browse-row">
    <a class="versus-browse-title" target="_blank" rel="noopener noreferrer">${row.title}</a>
    <b class="versus-chip versus-chip--viewer">${scoreText(row.viewerScore)}</b>
    <b class="versus-chip versus-chip--other">${scoreText(row.otherScore)}</b>
  </li>`;
  element.querySelector('a')!.setAttribute('href', `https://anilist.co/${media}/${row.mediaId}`);
  element.prepend(coverArt(row.cover, row.title, 'aw-cover aw-cover--mini'));
  return element;
}

export function compareBrowser(data: BrowserData): HTMLElement {
  const root = html`<div class="versus-browse aw-glass" data-versus-browser>
    <div class="versus-browse-controls">
      <div class="versus-browse-tabs" role="tablist"></div>
      <input
        type="search"
        placeholder="Search titles"
        aria-label="Search titles"
        data-versus-search
      />
      <select aria-label="Sort titles" data-versus-sort>
        <option value="gap">Biggest gap</option>
        <option value="viewer">Your score</option>
        <option value="other">Their score</option>
        <option value="title">Title</option>
      </select>
    </div>
    <div class="versus-browse-head">
      <span>Title</span><span>You</span><span class="versus-browse-them"></span>
    </div>
    <ol class="versus-browse-list" data-versus-rows></ol>
    <button type="button" class="aw-ghost versus-browse-more" data-versus-more hidden>
      Show more
    </button>
  </div>`;
  root.querySelector('.versus-browse-them')!.textContent = data.otherName;
  const list = root.querySelector<HTMLElement>('[data-versus-rows]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-versus-more]')!;
  const search = root.querySelector<HTMLInputElement>('[data-versus-search]')!;
  const sort = root.querySelector<HTMLSelectElement>('[data-versus-sort]')!;
  const tabs: ReadonlyArray<[BrowserTab, string]> = [
    ['shared', 'Both'],
    ['viewerOnly', 'Only you'],
    ['otherOnly', `Only ${data.otherName}`],
  ];
  let tab: BrowserTab = 'shared';
  let shown = PAGE_SIZE;

  const render = () => {
    const query = search.value.trim().toLowerCase();
    const rows = sortBrowserRows(
      data.rows[tab].filter((row) => !query || row.title.toLowerCase().includes(query)),
      sort.value as BrowserSort
    );
    list.replaceChildren(...rows.slice(0, shown).map((row) => rowElement(row, data.media)));
    if (!rows.length) list.append(html`<li class="versus-browse-empty">No titles here.</li>`);
    more.hidden = rows.length <= shown;
  };
  for (const [id, label] of tabs) {
    const button = html`<button
      type="button"
      class="versus-browse-tab"
      role="tab"
      data-versus-tab="${id}"
    >
      ${`${label} · ${formatNumber(data.rows[id].length)}`}
    </button>`;
    button.setAttribute('aria-selected', String(id === tab));
    button.addEventListener('click', () => {
      tab = id;
      shown = PAGE_SIZE;
      root
        .querySelectorAll('[data-versus-tab]')
        .forEach((item) => item.setAttribute('aria-selected', String(item === button)));
      render();
    });
    root.querySelector('.versus-browse-tabs')!.append(button);
  }
  const restart = () => {
    shown = PAGE_SIZE;
    render();
  };
  search.addEventListener('input', restart);
  sort.addEventListener('change', restart);
  more.addEventListener('click', () => {
    shown += PAGE_SIZE;
    render();
  });
  render();
  return root;
}
