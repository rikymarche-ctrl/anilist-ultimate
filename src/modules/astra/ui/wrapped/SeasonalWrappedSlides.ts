/**
 * @file SeasonalWrappedSlides.ts
 * @description Story slides for Seasonal Wrapped. Keeps the hooks the view and its tests rely on
 * (.seasonal-hero, .seasonal-podium, [data-award], [data-confirm], [data-seasonal-continuing], ...).
 *
 * Each season has its own liquid: winter ocean, spring rose, summer lagoon, fall ember.
 * Intro and the season tally are posters; rankings, picks and lists are immersive.
 */

import { html } from '@core/utils/Template';
import { parseWebUrl } from '@core/utils/WebUrl';
import {
  SEASONAL_AWARDS,
  seasonBounds,
  seasonLabel,
  type BroadcastSeason,
  type SeasonalAward,
  type SeasonalChoices,
  type SeasonalReport,
  type SeasonalTitle,
} from '../../services/SeasonalWrappedModel';
import { LIQUID_PALETTES, type LiquidPalette } from './LiquidBackground';
import { genreRadar } from './WrappedCharts';
import { formatNumber, formatRange, plural } from './WrappedFormat';
import {
  cardPreview,
  counter,
  coverArt,
  displayNumber,
  eyebrow,
  inner,
  kicker,
  marquee,
  pills,
  previewOnce,
  rise,
  slideShell,
  stagger,
  type WrappedSlide,
} from './WrappedStory';

export interface SeasonPalettes {
  /** Fills poster typography. */
  readonly vivid: LiquidPalette;
  /** Main backdrop. */
  readonly deep: LiquidPalette;
  /** Alternating backdrop for variety between immersive slides. */
  readonly alt: LiquidPalette;
}

export const SEASON_PALETTES: Record<BroadcastSeason, SeasonPalettes> = {
  WINTER: {
    vivid: LIQUID_PALETTES.vividOcean,
    deep: LIQUID_PALETTES.ocean,
    alt: LIQUID_PALETTES.nebula,
  },
  SPRING: {
    vivid: LIQUID_PALETTES.vividRose,
    deep: LIQUID_PALETTES.rose,
    alt: LIQUID_PALETTES.violet,
  },
  SUMMER: {
    vivid: LIQUID_PALETTES.vividLagoon,
    deep: LIQUID_PALETTES.lagoon,
    alt: LIQUID_PALETTES.ocean,
  },
  FALL: {
    vivid: LIQUID_PALETTES.vividEmber,
    deep: LIQUID_PALETTES.ember,
    alt: LIQUID_PALETTES.lava,
  },
};

const AWARD_ICONS: Record<SeasonalAward, string> = {
  favorite: 'fa-crown',
  surprise: 'fa-bolt',
  disappointment: 'fa-heart-crack',
  discovery: 'fa-compass',
};
const PODIUM_SIZE = 3;
const RADAR_GENRES = 6;

type SlideDraft = Omit<WrappedSlide, 'palette'>;

export interface SeasonalSlideOptions {
  /** Renders the share card for the summary preview. */
  preview?: () => HTMLCanvasElement;
}

const anilistUrl = (title: SeasonalTitle) => `https://anilist.co/anime/${title.mediaId}`;
const statusText = (title: SeasonalTitle) => title.status.toLowerCase().replace('_', ' ');
const originText = (title: SeasonalTitle) =>
  title.leftover && title.origin ? `Leftover · ${seasonLabel(title.origin)}` : 'New this season';

export function seasonalSlides(
  report: SeasonalReport,
  choices: SeasonalChoices,
  options: SeasonalSlideOptions = {}
): WrappedSlide[] {
  const drafts: SlideDraft[] = [introSlide(report), tallySlide(report)];
  const spotlight = spotlightSlide(report);
  if (spotlight) drafts.push(spotlight);
  drafts.push(
    rankingSlide(report, choices),
    picksSlide(report, choices),
    librarySlide(report, choices),
    continuingSlide(report, choices)
  );
  if (report.uncertain.length) drafts.push(uncertainSlide(report, choices));
  drafts.push(summarySlide(report, options));
  const palettes = SEASON_PALETTES[report.period.season];
  let immersive = 0;
  return drafts.map((draft) => ({
    ...draft,
    palette:
      draft.mode === 'poster' ? palettes.vivid : immersive++ % 2 ? palettes.alt : palettes.deep,
  }));
}

/** Podium card with optional cover; the score is always present for ranked titles. */
export function titleCard(title: SeasonalTitle, rank: number): HTMLElement {
  const card = html`<article class="seasonal-podium-card">
    <div class="seasonal-cover">
      <span class="seasonal-place">${String(rank).padStart(2, '0')}</span>
    </div>
    <div class="seasonal-card-body">
      <div class="seasonal-card-score">
        ${title.currentScore!.toFixed(2)}<small>/10 · ${title.scoreSource}</small>
      </div>
      <a href="${anilistUrl(title)}" target="_blank" rel="noopener noreferrer">${title.title}</a>
      <p>${originText(title)}</p>
    </div>
  </article>`;
  const url = parseWebUrl(title.cover);
  if (url) {
    const image = document.createElement('img');
    image.src = url.href;
    image.alt = '';
    image.loading = 'lazy';
    card.querySelector('.seasonal-cover')!.prepend(image);
  }
  return card;
}

export function titleRow(
  title: SeasonalTitle,
  choices: SeasonalChoices,
  rank?: number
): HTMLElement {
  const row = html`<div class="seasonal-title-row">
    <div class="seasonal-title-info">
      <a href="${anilistUrl(title)}" target="_blank" rel="noopener noreferrer"
        >${rank ? `${rank}. ` : ''}${title.title}</a
      ><small
        >${title.leftover && title.origin
          ? `Leftover from ${seasonLabel(title.origin)} · `
          : ''}${statusText(title)}${title.format ? ` · ${title.format}` : ''}</small
      >
    </div>
    <strong
      >${title.currentScore === null
        ? ''
        : `${title.currentScore.toFixed(2)} · ${title.scoreSource}`}</strong
    >
  </div>`;
  row.prepend(coverArt(title.cover, title.title, 'aw-cover aw-cover--mini'));
  if (choices.confirmedMediaIds.includes(title.mediaId)) {
    row.append(
      html`<button type="button" class="seasonal-confirm-undo" data-unconfirm="${title.mediaId}">
        Participation confirmed · Undo
      </button>`
    );
  }
  return row;
}

function introSlide(report: SeasonalReport): SlideDraft {
  const element = slideShell('intro', 'seasonal-hero');
  const bounds = seasonBounds(report.period);
  const [season, year] = seasonLabel(report.period).split(' ');
  const top = html`<div class="aw-poster-top">
    <span class="aw-eyebrow">Seasonal Wrapped</span
    ><span class="seasonal-edition aw-tag"
      >${report.provisional ? 'Season in progress' : 'Season concluded'}</span
    >
  </div>`;
  const title = html`<h3 class="aw-display aw-display--stack">
    <span>${season}</span><span class="aw-outline">${year}</span>
  </h3>`;
  title.style.setProperty('--chars', String(Math.max(4, season.length)));
  const foot = html`<div class="aw-poster-foot">
    <p class="aw-lead">
      ${report.provisional
        ? 'The season so far. Final rankings include only titles whose broadcast has ended.'
        : 'The stories that reached their ending. The ones that stayed with you.'}
    </p>
  </div>`;
  foot.append(
    pills([
      [report.concluded.length, 'concluded'],
      [report.continuing.length, 'continuing'],
      [null, formatRange(bounds.start, bounds.end)],
    ]),
    html`<button type="button" class="aw-cta" data-story-next data-story-play>
      <i class="fa-solid fa-play" aria-hidden="true"></i> Play the season
    </button>`
  );
  inner(element).append(rise(top, 0), rise(title, 1), rise(foot, 3));
  return { label: 'Intro', mode: 'poster', element };
}

function tallySlide(report: SeasonalReport): SlideDraft {
  const element = slideShell('figure', 'aw-slide--end');
  const count = report.concluded.length;
  const facts = html`<div class="seasonal-metrics"></div>`;
  facts.append(
    pills([
      [report.completed, 'completed by you'],
      [report.leftovers, plural(report.leftovers, 'leftover')],
      [
        null,
        report.average === null ? 'No average score yet' : `★ ${report.average.toFixed(2)} average`,
      ],
      [report.dropped, 'dropped'],
    ])
  );
  inner(element).append(
    rise(kicker('This season'), 0),
    rise(displayNumber(count), 1),
    rise(html`<p class="aw-word">${count === 1 ? 'story ended' : 'stories ended'}</p>`, 2),
    rise(facts, 3)
  );
  if (report.continuing.length) {
    inner(element).append(
      rise(
        html`<p class="aw-callout">
          <b>${formatNumber(report.continuing.length)}</b>
          ${`more ${plural(report.continuing.length, 'continues', 'continue')} into another season.`}
        </p>`,
        4
      )
    );
  }
  return { label: 'The season in numbers', mode: 'poster', element };
}

function spotlightSlide(report: SeasonalReport): SlideDraft | null {
  const awarded = report.awards.find((award) => award.id === 'favorite')?.title ?? null;
  const top = awarded ?? report.ranking[0] ?? null;
  if (!top) return null;
  const element = slideShell('spotlight');
  const art = html`<div class="aw-spotlight-art"></div>`;
  art.append(coverArt(top.cover, top.title, 'aw-cover aw-cover--hero'));
  const facts: Array<readonly [number | null, string]> = [];
  if (top.currentScore !== null)
    facts.push([null, `★ ${top.currentScore.toFixed(2)} · ${top.scoreSource}`]);
  facts.push([null, originText(top)]);
  if (top.format) facts.push([null, top.format]);
  const copy = html`<div class="aw-spotlight-copy"></div>`;
  copy.append(
    rise(eyebrow(awarded ? 'Anime of the season' : 'Your highest rated'), 0),
    rise(
      kicker(
        awarded ? 'Your personal pick, above everything else' : 'The ending that stayed with you'
      ),
      2
    ),
    rise(
      html`<h3 class="aw-title-xl">
        <a href="${anilistUrl(top)}" target="_blank" rel="noopener noreferrer">${top.title}</a>
      </h3>`,
      3
    ),
    rise(pills(facts), 4)
  );
  const layout = html`<div class="aw-spotlight">
    <span class="aw-ghost-number" aria-hidden="true">#1</span>
  </div>`;
  layout.append(rise(art, 1), copy);
  inner(element).append(layout);
  return { label: awarded ? 'Anime of the season' : 'Highest rated', element };
}

function rankingSlide(report: SeasonalReport, choices: SeasonalChoices): SlideDraft {
  const element = slideShell('ranking');
  const section = html`<div class="seasonal-section">
    <div class="seasonal-podium"></div>
    <div class="seasonal-ranking aw-glass"></div>
  </div>`;
  if (!report.ranking.length)
    section.append(
      html`<p class="seasonal-empty">
        No completed, rated titles yet. Finish watching, add a score, or confirm missing viewing
        dates.
      </p>`
    );
  report.ranking.forEach((title, index) => {
    if (index < PODIUM_SIZE)
      section
        .querySelector('.seasonal-podium')!
        .append(stagger(titleCard(title, title.rank), index));
    else
      section
        .querySelector('.seasonal-ranking')!
        .append(stagger(titleRow(title, choices, title.rank), index - PODIUM_SIZE + 1));
  });
  if (report.ranking.length <= PODIUM_SIZE) section.querySelector('.seasonal-ranking')!.remove();
  inner(element).append(
    rise(eyebrow('The highlights'), 0),
    rise(html`<h3 class="aw-heading">Your top rated</h3>`, 1),
    rise(kicker('Current scores · Astra first, then AniList'), 2),
    section
  );
  return { label: 'Your top rated', element };
}

function picksSlide(report: SeasonalReport, choices: SeasonalChoices): SlideDraft {
  const element = slideShell('picks');
  const awards = html`<div class="seasonal-awards"></div>`;
  SEASONAL_AWARDS.forEach((award, index) => {
    const card = html`<label class="seasonal-award aw-glass"
      ><span
        ><i class="${`fa-solid ${AWARD_ICONS[award.id]}`}" aria-hidden="true"></i>
        ${award.label}</span
      ><select data-award="${award.id}" aria-label="${award.label}">
        <option value="">Not selected</option>
      </select></label
    >`;
    const select = card.querySelector('select')!;
    const eligible = report.concluded.filter(
      (title) => award.id === 'disappointment' || title.status === 'COMPLETED'
    );
    for (const title of eligible)
      select.append(html`<option value="${title.mediaId}">${title.title}</option>`);
    const selected = choices.awards[award.id];
    const pick = eligible.find((title) => title.mediaId === selected);
    select.value = pick ? String(pick.mediaId) : '';
    if (!eligible.length) {
      select.disabled = true;
      select.dataset.locked = '';
    }
    if (pick) card.prepend(coverArt(pick.cover, pick.title, 'aw-cover aw-cover--award'));
    awards.append(stagger(card, index));
  });
  inner(element).append(
    rise(eyebrow('Personal picks'), 0),
    rise(html`<h3 class="aw-heading">Your season, your awards</h3>`, 1),
    rise(
      html`<p class="seasonal-caption">
        Choose your own winners. Picks save locally to your account and are included in Astra
        backups. Biggest disappointment can also be a dropped title.
      </p>`,
      2
    ),
    awards
  );
  return { label: 'Personal picks', hold: true, element };
}

function librarySlide(report: SeasonalReport, choices: SeasonalChoices): SlideDraft {
  const element = slideShell('library');
  const genres = report.genres.slice(0, RADAR_GENRES);
  if (genres.length) element.prepend(marquee(genres.map((genre) => genre.name)));
  const watching = report.concluded.filter(
    (title) => !['COMPLETED', 'DROPPED'].includes(title.status)
  ).length;
  const layout = html`<div class="aw-library">
    <div class="seasonal-title-list aw-glass"></div>
    <div class="aw-library-side aw-glass"><div class="seasonal-genres"></div></div>
  </div>`;
  // Animate each glass panel directly so the layout cannot isolate its backdrop blur.
  rise(layout.querySelector<HTMLElement>('.seasonal-title-list')!, 3);
  rise(layout.querySelector<HTMLElement>('.aw-library-side')!, 4);
  report.concluded.forEach((title, index) =>
    layout
      .querySelector('.seasonal-title-list')!
      .append(stagger(titleRow(title, choices), Math.min(index, 8)))
  );
  if (!report.concluded.length)
    layout
      .querySelector('.seasonal-title-list')!
      .append(html`<p class="seasonal-empty">No confirmed concluded titles for this season.</p>`);
  const radar = genreRadar(
    genres.map((genre) => ({ label: genre.name, value: genre.count })),
    'titles'
  );
  if (radar) layout.querySelector('.aw-library-side')!.prepend(radar);
  for (const genre of genres)
    layout
      .querySelector('.seasonal-genres')!
      .append(html`<span>${genre.name} · ${genre.count}</span>`);
  inner(element).append(
    rise(eyebrow('The full picture'), 0),
    rise(html`<h3 class="aw-heading">Concluded this season</h3>`, 1),
    rise(
      html`<p class="seasonal-caption">
        ${`${report.dropped} dropped · ${watching} still on your watchlist. Only titles you completed receive a final score.`}
      </p>`,
      2
    ),
    layout
  );
  return { label: 'Concluded this season', hold: true, element };
}

function continuingSlide(report: SeasonalReport, choices: SeasonalChoices): SlideDraft {
  const element = slideShell('continuing', 'seasonal-continuing');
  const list = html`<div class="seasonal-title-list aw-glass" data-seasonal-continuing></div>`;
  report.continuing.forEach((title, index) =>
    list.append(stagger(titleRow(title, choices), Math.min(index, 8)))
  );
  if (!report.continuing.length)
    list.append(
      html`<p class="seasonal-empty">No continuing titles confirmed for this period.</p>`
    );
  inner(element).append(
    rise(eyebrow('To be continued'), 0),
    rise(html`<h3 class="aw-heading">Continues into another season</h3>`, 1),
    rise(
      html`<p class="seasonal-caption">
        These titles have no final vote, award or ranking here. They enter the recap of the season
        in which their broadcast ends.
      </p>`,
      2
    ),
    rise(list, 3)
  );
  return { label: 'To be continued', element };
}

function uncertainSlide(report: SeasonalReport, choices: SeasonalChoices): SlideDraft {
  const element = slideShell('uncertain', 'seasonal-uncertain');
  const list = html`<div class="seasonal-title-list aw-glass"></div>`;
  report.uncertain.forEach((title, index) => {
    const row = titleRow(title, choices);
    if (title.reason === 'viewing-dates')
      row.append(
        html`<label class="seasonal-confirm"
          ><input type="checkbox" data-confirm="${title.mediaId}" /> I followed this during
          ${seasonLabel(report.period)}</label
        >`
      );
    else
      row.append(
        html`<small class="seasonal-caption"
          >Broadcast dates or conclusion not confirmed. Refresh when AniList has updated
          dates.</small
        >`
      );
    list.append(stagger(row, Math.min(index, 8)));
  });
  inner(element).append(
    rise(eyebrow('A little context'), 0),
    rise(html`<h3 class="aw-heading">Dates to confirm</h3>`, 1),
    rise(
      html`<p class="seasonal-caption">
        Missing viewing dates do not prove you followed an anime during this season. Confirm only
        titles you were already watching by its end. This does not change your AniList dates.
      </p>`,
      2
    ),
    rise(list, 3)
  );
  return { label: 'Dates to confirm', hold: true, element };
}

function summarySlide(report: SeasonalReport, options: SeasonalSlideOptions): SlideDraft {
  const element = slideShell('summary');
  const metrics = html`<div class="aw-summary-metrics"></div>`;
  const values: Array<[number | null, string, number]> = [
    [report.concluded.length, 'Concluded', 0],
    [report.completed, 'Completed', 0],
    [report.leftovers, 'Leftovers', 0],
    [report.average, 'Average score', 2],
  ];
  for (const [value, label, decimals] of values) {
    const metric = html`<div><span>${label}</span></div>`;
    metric.prepend(
      value === null
        ? html`<strong class="aw-summary-value">—</strong>`
        : counter(value, decimals, 'aw-summary-value')
    );
    metrics.append(metric);
  }
  const highlights = html`<div class="aw-summary-columns">
    <section>
      <h4>Top rated</h4>
      <ol></ol>
    </section>
    <section>
      <h4>Your awards</h4>
      <ol class="aw-plain"></ol>
    </section>
  </div>`;
  const [ranking, awards] = highlights.querySelectorAll('ol');
  report.ranking
    .slice(0, 3)
    .forEach((title) =>
      ranking.append(
        html`<li><span>${title.title}</span><b>${title.currentScore!.toFixed(2)}</b></li>`
      )
    );
  if (!report.ranking.length) ranking.append(html`<li><span>No rated endings yet</span></li>`);
  report.awards.forEach((award) =>
    awards.append(
      html`<li><span>${award.label}</span><b>${award.title?.title ?? 'Not selected'}</b></li>`
    )
  );
  const card = html`<div class="aw-glass aw-summary-card"></div>`;
  card.append(metrics, highlights);
  const actions = html`<div class="aw-actions-row">
    <button type="button" class="aw-cta" data-seasonal-download>
      <i class="fa-solid fa-download" aria-hidden="true"></i> Download story</button
    ><button type="button" class="aw-ghost" data-story-restart>
      <i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i> Watch again
    </button>
  </div>`;
  const copy = html`<div class="aw-summary-copy"></div>`;
  copy.append(
    rise(eyebrow("That's a wrap"), 0),
    rise(html`<h3 class="aw-heading">${`${seasonLabel(report.period)}, wrapped.`}</h3>`, 1),
    rise(card, 2),
    rise(actions, 3),
    rise(
      html`<footer class="seasonal-footer">
        Backlog titles
        excluded${report.excludedRecoveries
          ? ` (${report.excludedRecoveries} started after this season)`
          : ''}.
        Separate AniList entries stay separate. Rankings use current personal scores; previous
        seasons are recalculated when refreshed.
      </footer>`,
      4
    )
  );
  const layout = html`<div class="aw-summary"></div>`;
  layout.append(copy);
  if (options.preview) layout.append(rise(cardPreview('data-seasonal-preview'), 3));
  inner(element).append(layout);
  return {
    label: 'Summary',
    element,
    onEnter: options.preview ? previewOnce(options.preview) : undefined,
  };
}
