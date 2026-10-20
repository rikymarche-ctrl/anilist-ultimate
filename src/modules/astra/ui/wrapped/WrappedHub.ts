/**
 * @file WrappedHub.ts
 * @description The Wrapped library in the Astra dashboard: one poster per recap, in the
 * same liquid art direction as the stories. Each poster is a black page whose giant type
 * shows a liquid painting through `mix-blend-mode: multiply`, like the story intro slides.
 */

import { html } from '@core/utils/Template';
import { seasonLabel, type SeasonalPeriod } from '../../services/SeasonalWrappedModel';
import { LIQUID_PALETTES, paintLiquid, type LiquidPalette } from './LiquidBackground';
import { SEASON_PALETTES } from './SeasonalWrappedSlides';
import { seedFrom } from './WrappedCanvas';

const FALLBACK_SIZE = { width: 720, height: 480 };
/** The painting is soft; a modest resolution keeps the one-off WebGL pass cheap. */
const MAX_PIXEL_RATIO = 1.5;

export interface WrappedHubOptions {
  year: number;
  /** Latest released broadcast season. */
  season: SeasonalPeriod;
  /** A released season the user has not opened yet. */
  seasonReady: boolean;
}

function poster(word: string): HTMLElement {
  const element = html`<div class="aw-hub-poster" aria-hidden="true"><span>${word}</span></div>`;
  element
    .querySelector('span')!
    .style.setProperty('--chars', String(Math.max(3, [...word].length)));
  return element;
}

function features(items: readonly string[]): HTMLElement {
  const list = html`<ul class="aw-hub-features"></ul>`;
  for (const item of items) list.append(html`<li>${item}</li>`);
  return list;
}

const paletteOf = new WeakMap<HTMLElement, LiquidPalette>();

function card(
  modifier: string,
  palette: LiquidPalette,
  seed: string,
  word: string,
  body: HTMLElement
): HTMLElement {
  const element = html`<article class="${`aw-hub-card aw-hub-card--${modifier}`}">
    <canvas class="aw-hub-liquid" aria-hidden="true"></canvas>
  </article>`;
  element.dataset.seed = String(seedFrom(seed));
  element.style.setProperty('--hub-glow', palette.colors[2]);
  paletteOf.set(element, palette);
  element.append(poster(word), body);
  return element;
}

export function wrappedHub(options: WrappedHubOptions): HTMLElement {
  const { year, season, seasonReady } = options;
  const yearly = html`<div class="aw-hub-body">
    <span class="aw-hub-kicker">Astra Wrapped</span>
    <h3>Your year on AniList</h3>
    <p>
      Time watched, rhythm, favourites, voice actors, studios and how your scores compare with the
      community, told as a story.
    </p>
  </div>`;
  yearly.append(
    features(['Hours & rhythm', 'Favourites', 'Voice actors', 'You vs AniList', 'Share card']),
    html`<div class="aw-hub-actions">
      <button type="button" class="aw-hub-cta" data-open-astra-wrapped>
        <i class="fa-solid fa-play" aria-hidden="true"></i> Open Astra Wrapped
      </button>
      <small>Any year, month or custom period</small>
    </div>`
  );
  const seasonal = html`<div class="aw-hub-body">
    <span class="aw-hub-kicker">Seasonal Wrapped</span>
    <h3>${seasonLabel(season)}</h3>
    <p>
      Rank the season you followed, hand out your awards and catch the leftovers that carried over.
    </p>
  </div>`;
  seasonal.append(
    features(['Ranking', 'Awards', 'Leftovers', 'Share card']),
    html`<div class="aw-hub-actions">
      <button type="button" class="aw-hub-cta" data-open-seasonal>
        <i class="fa-solid fa-play" aria-hidden="true"></i> Open Seasonal Wrapped
      </button>
      <small>A new season unlocks three days after it ends</small>
    </div>`
  );
  const seasonCard = card(
    'season',
    SEASON_PALETTES[season.season].vivid,
    `${season.year}-${season.season}`,
    season.season,
    seasonal
  );
  if (seasonReady) seasonCard.append(html`<span class="aw-hub-badge">New</span>`);
  const root = html`<div class="astra-dashboard-layout astra-recaps-layout aw-hub">
    <header class="aw-hub-head">
      <span class="aw-hub-eyebrow">Wrapped</span>
      <h2>Your stories, wrapped.</h2>
      <p>Yearly and seasonal recaps built from your AniList activity and Astra scores.</p>
    </header>
    <div class="aw-hub-grid"></div>
  </div>`;
  root
    .querySelector('.aw-hub-grid')!
    .append(
      card('year', LIQUID_PALETTES.vividNebula, String(year), String(year), yearly),
      seasonCard
    );
  return root;
}

/** Paints each poster's liquid once, at its laid-out size. Call after the hub is in the DOM. */
export function paintWrappedHub(root: HTMLElement): void {
  const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
  for (const element of root.querySelectorAll<HTMLElement>('.aw-hub-card')) {
    const canvas = element.querySelector<HTMLCanvasElement>('.aw-hub-liquid');
    const palette = paletteOf.get(element);
    const context = canvas?.getContext('2d');
    if (!canvas || !palette || !context) continue;
    const width = Math.round((element.clientWidth || FALLBACK_SIZE.width) * ratio);
    const height = Math.round((element.clientHeight || FALLBACK_SIZE.height) * ratio);
    canvas.width = width;
    canvas.height = height;
    try {
      paintLiquid(context, width, height, palette, Number(element.dataset.seed));
    } catch {
      // The poster keeps its CSS gradient fallback.
    }
  }
}
