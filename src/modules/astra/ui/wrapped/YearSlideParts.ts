/**
 * @file YearSlideParts.ts
 * @description Small building blocks shared by the Astra Wrapped slide modules.
 */

import { html } from '@core/utils/Template';
import type { ReviewMediaType, ReviewTitle } from '../../services/year/YearReviewTypes';
import { formatNumber, plural } from './WrappedFormat';
import { coverArt, stagger } from './WrappedStory';

export const TYPE_NAMES: Record<ReviewMediaType, string> = { ANIME: 'Anime', MANGA: 'Manga' };

const FORMAT_NAMES: Record<string, string> = {
  TV: 'TV', TV_SHORT: 'TV short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music video',
  MANGA: 'Manga', NOVEL: 'Light novel', ONE_SHOT: 'One shot',
};
const SOURCE_NAMES: Record<string, string> = {
  ORIGINAL: 'Original', MANGA: 'Manga', LIGHT_NOVEL: 'Light novel', VISUAL_NOVEL: 'Visual novel', VIDEO_GAME: 'Video game',
  NOVEL: 'Novel', WEB_NOVEL: 'Web novel', DOUJINSHI: 'Doujinshi', ANIME: 'Anime', LIVE_ACTION: 'Live action',
  GAME: 'Game', COMIC: 'Comic', MULTIMEDIA_PROJECT: 'Multimedia project', PICTURE_BOOK: 'Picture book', OTHER: 'Other',
};
const COUNTRY_NAMES: Record<string, string> = { JP: 'Japan', KR: 'South Korea', CN: 'China', TW: 'Taiwan' };

const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
export const formatName = (value: string) => FORMAT_NAMES[value] ?? titleCase(value);
export const sourceName = (value: string) => SOURCE_NAMES[value] ?? titleCase(value);
export const countryName = (value: string) => COUNTRY_NAMES[value] ?? value;

export const unitShort = (title: Pick<ReviewTitle, 'type'>) => (title.type === 'ANIME' ? 'ep' : 'ch');
export const unitWords = (type: ReviewMediaType, units: number) =>
  type === 'ANIME' ? plural(units, 'episode') : plural(units, 'chapter');
export const scoreText = (score: number) => `★ ${formatNumber(score, score % 1 ? 1 : 0)}`;
export const hours = (minutes: number) => Math.round(minutes / 60);
export const percent = (share: number) => `${Math.round(share * 100)}%`;

/** Round person picture (voice actors, staff, fans). */
export function portrait(url: string | null, name: string, size: 'xl' | 'md' | 'sm' = 'md'): HTMLElement {
  return coverArt(url, name, `aw-cover aw-portrait aw-portrait--${size}`);
}

export interface RankItem {
  cover: string | null;
  title: string;
  caption: string;
  value: string;
}

/** Ranked rows with covers, styled like the existing top-stories list. */
export function rankList(items: readonly RankItem[], attribute: string): HTMLElement {
  const list = html`<ol class="aw-rank"></ol>`;
  list.setAttribute(attribute, '');
  items.forEach((item, index) => {
    const row = html`<li class="aw-rank-row">
      <span class="aw-rank-num">${String(index + 1).padStart(2, '0')}</span
      ><span class="aw-rank-text"><span class="aw-rank-title">${item.title}</span><small>${item.caption}</small></span
      ><b>${item.value}</b>
    </li>`;
    row.insertBefore(coverArt(item.cover, item.title, 'aw-cover aw-cover--thumb'), row.children[1]);
    list.append(stagger(row, index));
  });
  return list;
}

/** Horizontal meters (label · bar · value), widths relative to the first row. */
export function meterList(items: ReadonlyArray<{ label: string; value: number; caption: string }>): HTMLElement {
  const list = html`<ol class="aw-genre-list"></ol>`;
  const max = Math.max(1, ...items.map((item) => item.value));
  items.forEach((item, index) => {
    const row = html`<li><span>${item.label}</span><i class="aw-meter"><i></i></i><b>${item.caption}</b></li>`;
    const bar = row.querySelector<HTMLElement>('.aw-meter > i')!;
    bar.style.setProperty('--w', `${(100 * item.value) / max}%`);
    bar.style.setProperty('--i', String(index));
    list.append(stagger(row, index));
  });
  return list;
}

/** Glass panel with a small uppercase title. */
export function panel(title: string, ...children: Node[]): HTMLElement {
  const element = html`<section class="aw-glass aw-year-panel"><h4 class="aw-panel-title">${title}</h4></section>`;
  element.append(...children);
  return element;
}

/** Big number with a label, for tiles inside glass grids. */
export function tile(value: string, label: string, caption = ''): HTMLElement {
  const element = html`<div class="aw-year-tile"><strong>${value}</strong><span>${label}</span><small>${caption}</small></div>`;
  if (!caption) element.querySelector('small')!.remove();
  return element;
}

export const titleCount = (count: number) => `${formatNumber(count)} ${plural(count, 'title')}`;
