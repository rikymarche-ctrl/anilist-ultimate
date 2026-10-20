/**
 * @file YearSlidesTaste.ts
 * @description The "taste" chapter of Astra Wrapped: favourites, genres and tags, the
 * formats and eras watched, and how the user's scores compare with the AniList community.
 */

import { html } from '@core/utils/Template';
import type { ReviewComparison, ReviewTitle, YearReviewReport } from '../../services/year/YearReviewTypes';
import { LIQUID_PALETTES } from './LiquidBackground';
import { genreRadar, monthBars } from './WrappedCharts';
import { formatNumber, plural } from './WrappedFormat';
import { coverArt, eyebrow, inner, kicker, marquee, note, pills, rise, slideShell, stagger, type WrappedSlide } from './WrappedStory';
import {
  TYPE_NAMES, countryName, formatName, meterList, panel, percent, rankList, scoreText, sourceName, titleCount, unitShort, unitWords,
} from './YearSlideParts';

const TOP_TITLES = 5;
const MIN_RANKED = 3;
const TOP_GENRES = 6;
const CLOUD_TAGS = 18;
const MIX_ROWS = 5;
const MIN_COMMUNITY = 3;
const COLLAGE_COVERS = 3;

export function tasteSlides(report: YearReviewReport): Array<WrappedSlide | null> {
  return [
    spotlightSlide(report), topAnimeSlide(report), topMangaSlide(report), genreSlide(report), tagSlide(report),
    mixSlide(report), eraSlide(report), communitySlide(report), popularitySlide(report),
  ];
}

/** Favourite by score when the year has enough scores, otherwise the most watched anime. */
function favourites(report: YearReviewReport, type: ReviewTitle['type']): { titles: ReviewTitle[]; byScore: boolean } {
  const rated = report.topRated.filter((title) => title.type === type);
  if (rated.length >= MIN_RANKED) return { titles: rated, byScore: true };
  return { titles: report.titles.filter((title) => title.type === type && title.units > 0), byScore: false };
}

function spotlightSlide(report: YearReviewReport): WrappedSlide | null {
  const { titles, byScore } = favourites(report, 'ANIME');
  const top = titles[0] ?? report.titles[0];
  if (!top) return null;
  const element = slideShell('spotlight');
  const art = html`<div class="aw-spotlight-art"></div>`;
  art.append(coverArt(top.cover, top.title, 'aw-cover aw-cover--hero'));
  const facts: Array<readonly [number | null, string]> = [[top.units, unitWords(top.type, top.units)]];
  if (top.score !== null) facts.push([null, `${scoreText(top.score)} ${top.scoreSource === 'Astra' ? 'Astra' : 'your score'}`]);
  if (top.meanScore !== null) facts.push([null, `AniList ${top.meanScore}%`]);
  const copy = html`<div class="aw-spotlight-copy"></div>`;
  copy.append(
    rise(eyebrow('Your #1'), 0),
    rise(kicker(byScore ? 'Your highest-rated story of the year' : 'The story you kept coming back to'), 2),
    rise(html`<h3 class="aw-title-xl">${top.title}</h3>`, 3),
    rise(pills(facts), 4)
  );
  const layout = html`<div class="aw-spotlight"><span class="aw-ghost-number" aria-hidden="true">#1</span></div>`;
  layout.append(rise(art, 1), copy);
  inner(element).append(layout);
  return { label: 'Your number one', palette: LIQUID_PALETTES.lava, element };
}

function rankedSlide(titles: ReviewTitle[], byScore: boolean, heading: string, label: string, attribute: string): HTMLElement {
  const element = slideShell('ranking');
  const list = rankList(titles.slice(0, TOP_TITLES).map((title) => ({
    cover: title.cover, title: title.title,
    caption: [title.format ? formatName(title.format) : TYPE_NAMES[title.type], byScore ? `${formatNumber(title.units)} ${unitShort(title)}` : '']
      .filter(Boolean).join(' · '),
    value: byScore && title.score !== null ? scoreText(title.score) : `${formatNumber(title.units)} ${unitShort(title)}`,
  })), attribute);
  const layout = html`<div class="aw-top-layout"></div>`;
  layout.append(list);
  const covers = titles.slice(0, COLLAGE_COVERS).filter((title) => title.cover);
  if (covers.length) {
    const collage = html`<div class="aw-collage" aria-hidden="true"></div>`;
    covers.forEach((title) => collage.append(coverArt(title.cover, title.title, 'aw-cover aw-cover--collage')));
    layout.append(rise(collage, 3));
  }
  inner(element).append(rise(eyebrow(label), 0), rise(html`<h3 class="aw-heading">${heading}</h3>`, 1),
    rise(kicker(byScore ? 'Ranked by your scores' : 'Ranked by episodes and chapters logged'), 2), layout);
  return element;
}

function topAnimeSlide(report: YearReviewReport): WrappedSlide | null {
  const { titles, byScore } = favourites(report, 'ANIME');
  if (titles.length < 2) return null;
  return { label: 'Top anime', palette: LIQUID_PALETTES.ocean, element: rankedSlide(titles, byScore, 'Your top anime', 'The favourites', 'data-wrapped-titles') };
}

function topMangaSlide(report: YearReviewReport): WrappedSlide | null {
  const { titles, byScore } = favourites(report, 'MANGA');
  if (!titles.length) return null;
  return { label: 'Top manga', palette: LIQUID_PALETTES.rose, element: rankedSlide(titles, byScore, 'Your top manga', 'On paper', 'data-wrapped-manga') };
}

function genreSlide(report: YearReviewReport): WrappedSlide | null {
  const top = report.genres[0];
  if (!top) return null;
  const element = slideShell('genres');
  const names = report.genres.slice(0, TOP_GENRES).map((genre) => genre.name);
  element.prepend(marquee(names), marquee([...names].reverse(), true));
  const layout = html`<div class="aw-genre-layout"></div>`;
  const radar = genreRadar(report.genres.map((genre) => ({ label: genre.name, value: genre.titles })), 'titles');
  if (radar) {
    const wrap = rise(html`<div class="aw-radar-wrap"></div>`, 2);
    wrap.append(radar);
    layout.append(wrap);
  }
  const list = meterList(report.genres.slice(0, TOP_GENRES).map((genre) => ({ label: genre.name, value: genre.titles, caption: titleCount(genre.titles) })));
  list.setAttribute('data-wrapped-genres', '');
  layout.append(list);
  inner(element).append(rise(eyebrow('Your genres'), 0), rise(html`<h3 class="aw-heading">You kept coming back to <em>${top.name}</em>.</h3>`, 1), layout);
  const shifts = report.genreShift
    .map((genre) => ({ ...genre, delta: Math.round((genre.now - genre.before) * 100) }))
    .filter((genre) => Math.abs(genre.delta) >= 2)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
  if (shifts.length) {
    inner(element).append(rise(pills(shifts.map((genre) => [null, `${genre.name} ${genre.delta > 0 ? '▲' : '▼'} ${Math.abs(genre.delta)} pts vs all time`] as const)), 3));
  }
  return { label: 'Your genres', palette: LIQUID_PALETTES.vividLagoon, mode: 'poster', element };
}

function tagSlide(report: YearReviewReport): WrappedSlide | null {
  if (report.tags.length < 3) return null;
  const element = slideShell('tags');
  const cloud = html`<ul class="aw-cloud" data-wrapped-tags></ul>`;
  const max = report.tags[0].titles;
  // Shuffle-free but balanced: alternate strong and weak tags so the cloud reads as a mix.
  const tags = report.tags.slice(0, CLOUD_TAGS);
  const order = tags.flatMap((_, index) => (index % 2 ? [tags[tags.length - 1 - (index >> 1)]] : [tags[index >> 1]])).slice(0, tags.length);
  order.forEach((tag, index) => {
    const item = html`<li title="${titleCount(tag.titles)}">${tag.name}</li>`;
    item.style.setProperty('--s', String(0.35 + (0.65 * tag.titles) / max));
    if (tag === tags[0]) item.classList.add('is-top');
    cloud.append(stagger(item, index));
  });
  inner(element).append(
    rise(eyebrow('Your themes'), 0),
    rise(html`<h3 class="aw-heading">Your year was full of <em>${tags[0].name}</em>.</h3>`, 1),
    rise(kicker(`AniList tagged ${titleCount(tags[0].titles)} you followed with it.`), 2),
    rise(cloud, 3)
  );
  return { label: 'Your themes', palette: LIQUID_PALETTES.nebula, element };
}

function mixSlide(report: YearReviewReport): WrappedSlide | null {
  if (!report.formats.length) return null;
  const element = slideShell('mix');
  const grid = html`<div class="aw-year-grid"></div>`;
  const add = (title: string, rows: YearReviewReport['formats'], name: (value: string) => string) => {
    if (rows.length) grid.append(panel(title, meterList(rows.slice(0, MIX_ROWS).map((row) => ({ label: name(row.name), value: row.titles, caption: formatNumber(row.titles) })))));
  };
  add('Formats', report.formats, formatName);
  add('Adapted from', report.sources, sourceName);
  if (report.countries.length > 1) add('Made in', report.countries, countryName);
  const format = report.formats[0];
  const source = report.sources[0];
  inner(element).append(
    rise(eyebrow('Your mix'), 0),
    rise(html`<h3 class="aw-heading">Mostly <em>${formatName(format.name)}</em>${source ? `, from ${sourceName(source.name).toLowerCase()}` : ''}.</h3>`, 1),
    rise(grid, 2)
  );
  return { label: 'Your mix', palette: LIQUID_PALETTES.oil, element };
}

function eraSlide(report: YearReviewReport): WrappedSlide | null {
  if (report.freshShare === null || !report.decades.length) return null;
  const element = slideShell('eras');
  const peak = report.decades.reduce((best, decade, index) => (decade.titles > report.decades[best].titles ? index : best), 0);
  const chart = html`<div class="aw-glass aw-chart-panel aw-chart-panel--wide aw-eras"></div>`;
  chart.append(monthBars(report.decades.map((decade) => ({ label: decade.name, primary: decade.titles, secondary: 0, title: `${decade.name}: ${titleCount(decade.titles)}` })), peak));
  inner(element).append(
    rise(eyebrow('Your eras'), 0),
    rise(html`<h3 class="aw-heading"><em>${percent(report.freshShare)}</em> of it was brand new.</h3>`, 1),
    rise(kicker(`Titles first released in ${report.period.start.slice(0, 4)}${report.period.end.slice(0, 4) !== report.period.start.slice(0, 4) ? `–${report.period.end.slice(0, 4)}` : ''}, against everything you went back for.`), 2),
    rise(chart, 3)
  );
  if (report.oldest) inner(element).append(rise(html`<p class="aw-callout">Oldest trip: <b>${report.oldest.title}</b> (${String(report.oldest.releaseYear)}).</p>`, 4));
  return { label: 'Your eras', palette: LIQUID_PALETTES.ember, element };
}

function versusRow(item: ReviewComparison, index: number): HTMLElement {
  const row = html`<li class="aw-versus-row">
    <span class="aw-versus-title">${item.title.title}</span>
    <span class="aw-versus-bars"><i class="is-you"></i><i class="is-them"></i></span>
    <b>${`${item.difference > 0 ? '+' : ''}${Math.round(item.difference)}`}</b>
  </li>`;
  const [you, them] = row.querySelectorAll<HTMLElement>('.aw-versus-bars > i');
  you.style.setProperty('--w', `${item.you}%`);
  you.title = `You: ${Math.round(item.you)}`;
  them.style.setProperty('--w', `${item.community}%`);
  them.title = `AniList: ${Math.round(item.community)}`;
  return stagger(row, index);
}

function communitySlide(report: YearReviewReport): WrappedSlide | null {
  const { community } = report;
  if (community.rated < MIN_COMMUNITY || community.meanDifference === null) return null;
  const element = slideShell('community');
  const gap = community.meanDifference / 10;
  const size = formatNumber(Math.abs(gap), 1);
  const heading = size === '0.0' || size === '0'
    ? html`<h3 class="aw-heading">You scored <em>right in line</em> with AniList.</h3>`
    : html`<h3 class="aw-heading">You scored <em>${size}</em> ${plural(Math.abs(gap), 'point')} ${gap > 0 ? 'above' : 'below'} AniList.</h3>`;
  const grid = html`<div class="aw-year-grid"></div>`;
  const list = (items: ReviewComparison[]) => {
    const element = html`<ol class="aw-versus"></ol>`;
    items.forEach((item, index) => element.append(versusRow(item, index)));
    return element;
  };
  if (community.warmer.length) grid.append(panel('You loved more', list(community.warmer)));
  if (community.colder.length) grid.append(panel('You were harsher', list(community.colder)));
  inner(element).append(rise(eyebrow('You vs AniList'), 0), rise(heading, 1),
    rise(kicker(`Across ${titleCount(community.rated)} you scored, against each title's community average.`), 2));
  if (grid.children.length) inner(element).append(rise(grid, 3));
  const callouts: string[] = [];
  if (community.generous) callouts.push(`On ${community.generous.title.title} you were more generous than ${percent(community.generous.share)} of AniList.`);
  if (community.tough) callouts.push(`On ${community.tough.title.title} you were tougher than ${percent(community.tough.share)}.`);
  callouts.forEach((text, index) => inner(element).append(rise(html`<p class="aw-callout">${text}</p>`, 4 + index)));
  inner(element).append(rise(note('Your scores use your current Astra or AniList score; the community uses its 10-point score histogram.'), 6));
  return { label: 'You vs AniList', palette: LIQUID_PALETTES.violet, element };
}

function popularityCard(label: string, title: ReviewTitle): HTMLElement {
  const card = html`<article class="aw-glass aw-pop-card">
    <span class="aw-panel-title">${label}</span>
    <h4>${title.title}</h4>
    <p><b>${formatNumber(title.popularity)}</b> ${plural(title.popularity, 'member')} on AniList</p>
  </article>`;
  card.prepend(coverArt(title.cover, title.title, 'aw-cover aw-cover--pop'));
  return card;
}

function popularitySlide(report: YearReviewReport): WrappedSlide | null {
  const { mostPopular, hiddenGem, median } = report.popularity;
  if (!mostPopular || !hiddenGem || median === null) return null;
  const element = slideShell('popularity');
  const duo = html`<div class="aw-pop-duo"></div>`;
  duo.append(stagger(popularityCard('Most popular', mostPopular), 0), stagger(popularityCard('Hidden gem', hiddenGem), 1));
  inner(element).append(
    rise(eyebrow('Off the beaten path'), 0),
    rise(html`<h3 class="aw-heading">Half your titles have fewer than <em>${formatNumber(median)}</em> members.</h3>`, 1),
    rise(duo, 2)
  );
  return { label: 'Popularity', palette: LIQUID_PALETTES.lagoon, element };
}
