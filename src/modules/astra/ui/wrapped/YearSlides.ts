/**
 * @file YearSlides.ts
 * @description Story order for Astra Wrapped plus the "habits" chapter: volume, rhythm,
 * clock, months, the journey from first to last title, persona and summary.
 *
 * Art direction follows the existing story: poster slides (black page, liquid type)
 * alternate with immersive glass slides. Optional slides appear only when they have data.
 */

import { html } from '@core/utils/Template';
import type { ReviewTitle, ReviewTrait, YearReviewReport } from '../../services/year/YearReviewTypes';
import { LIQUID_PALETTES } from './LiquidBackground';
import { activityHeatmap, monthBars, type BarDatum } from './WrappedCharts';
import { formatDay, formatNumber, formatRange, monthLabel, monthName, periodNoun, periodTitle, plural } from './WrappedFormat';
import {
  cardPreview, counter, coverArt, display, displayNumber, eyebrow, inner, kicker, note, pills, previewOnce, rise, slideShell,
  stagger, type WrappedSlide,
} from './WrappedStory';
import { hours, percent, scoreText, tile, unitShort } from './YearSlideParts';
import { tasteSlides } from './YearSlidesTaste';
import { peopleSlides } from './YearSlidesPeople';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const NIGHT_HOURS = [22, 23, 0, 1, 2, 3, 4];

export const TRAITS: Record<ReviewTrait, { name: string; line: string }> = {
  binger: { name: 'The Binger', line: 'One more episode was never just one.' },
  'night-owl': { name: 'The Night Owl', line: 'Most of your updates landed after dark.' },
  completionist: { name: 'The Completionist', line: 'You finish what you start.' },
  explorer: { name: 'The Explorer', line: 'You go where few members have been.' },
  critic: { name: 'The Critic', line: 'Your scores rarely follow the crowd.' },
  loyalist: { name: 'The Loyalist', line: 'One genre owned your year.' },
  simulcaster: { name: 'The Simulcaster', line: 'You watched history as it aired.' },
  archivist: { name: 'The Archivist', line: 'You dug through the classics.' },
};

export interface YearSlideOptions {
  /** Renders the share card for the summary preview; omitted where canvas is unavailable. */
  preview?: () => HTMLCanvasElement;
}

/** Slides in story order. Requires at least one title. */
export function yearSlides(report: YearReviewReport, options: YearSlideOptions = {}): WrappedSlide[] {
  const slides: Array<WrappedSlide | null> = [
    introSlide(report),
    report.episodes ? episodesSlide(report) : null,
    report.chapters ? chaptersSlide(report) : null,
    rhythmSlide(report),
    clockSlide(report),
    monthSlide(report),
    journeySlide(report),
    ...tasteSlides(report),
    ...peopleSlides(report),
    personaSlide(report),
    summarySlide(report, options),
  ];
  return slides.filter((slide): slide is WrappedSlide => slide !== null);
}

function introSlide(report: YearReviewReport): WrappedSlide {
  const { start, end } = report.period;
  const noun = periodNoun(start, end);
  const element = slideShell('intro');
  const top = html`<div class="aw-poster-top">
    <span class="aw-eyebrow">Astra Wrapped</span><span class="aw-tag">${formatRange(start, end)}</span>
  </div>`;
  const foot = html`<div class="aw-poster-foot">
    <p class="aw-lead">${noun === 'period' ? 'Your AniList, wrapped.' : `Your ${noun} on AniList.`}</p>
  </div>`;
  foot.append(
    pills([
      [report.titles.length, plural(report.titles.length, 'title')],
      [report.activeDays, plural(report.activeDays, 'active day')],
      [report.listActivities, plural(report.listActivities, 'list update')],
    ]),
    html`<button type="button" class="aw-cta" data-story-next data-story-play>
      <i class="fa-solid fa-play" aria-hidden="true"></i> Play your story
    </button>`
  );
  inner(element).append(rise(top, 0), rise(display(periodTitle(start, end)), 1), rise(foot, 3));
  return { label: 'Intro', palette: LIQUID_PALETTES.vividNebula, mode: 'poster', element };
}

function posterFigure(kickerText: string, value: number, word: string): HTMLElement {
  const element = slideShell('figure');
  inner(element).append(rise(kicker(kickerText), 0), rise(displayNumber(value), 1), rise(html`<p class="aw-word">${word}</p>`, 2));
  return element;
}

function episodesSlide(report: YearReviewReport): WrappedSlide {
  const element = posterFigure('You pressed play on', report.episodes, plural(report.episodes, 'episode'));
  const time = hours(report.minutes);
  const series = report.titles.filter((title) => title.type === 'ANIME' && title.units > 0).length;
  const facts: Array<readonly [number | null, string]> = [];
  if (report.timedEpisodes) facts.push([time, `${plural(time, 'hour')} of anime`]);
  if (time >= 24) facts.push([null, `${formatNumber(Math.round(report.minutes / 144) / 10, 1)} days back to back`]);
  facts.push([series, `${plural(series, 'series', 'series')} on screen`]);
  inner(element).append(rise(pills(facts), 3));
  if (report.timedEpisodes < report.episodes) {
    inner(element).append(rise(note(`Hours cover the ${formatNumber(report.timedEpisodes)} episodes with a known running time.`), 4));
  }
  return { label: 'Episodes watched', palette: LIQUID_PALETTES.vividOcean, mode: 'poster', element };
}

function chaptersSlide(report: YearReviewReport): WrappedSlide {
  const element = posterFigure('You turned the page on', report.chapters, plural(report.chapters, 'chapter'));
  element.classList.add('aw-slide--end');
  const manga = report.titles.filter((title) => title.type === 'MANGA' && title.units > 0);
  const facts: Array<readonly [number | null, string]> = [[manga.length, plural(manga.length, 'manga', 'manga')]];
  if (manga[0]) facts.push([null, `Most read: ${manga[0].title}`]);
  inner(element).append(rise(pills(facts), 3));
  return { label: 'Chapters read', palette: LIQUID_PALETTES.vividRose, mode: 'poster', element };
}

function rhythmSlide(report: YearReviewReport): WrappedSlide {
  const element = slideShell('rhythm');
  const busiest = report.weekdays.indexOf(Math.max(...report.weekdays));
  const streak = html`<div class="aw-streak">
    <i class="fa-solid fa-fire" aria-hidden="true"></i
    ><span>${plural(report.longestStreak, 'day', 'days')} in a row<small>your longest streak</small></span>
  </div>`;
  streak.insertBefore(counter(report.longestStreak, 0, 'aw-streak-value'), streak.children[1]);
  const copy = html`<div class="aw-rhythm-copy"></div>`;
  copy.append(
    rise(eyebrow('Your rhythm'), 0),
    rise(html`<h3 class="aw-heading">You showed up on <em>${formatNumber(report.activeDays)}</em> ${plural(report.activeDays, 'day')}.</h3>`, 1),
    rise(streak, 2)
  );
  if (report.bestDay) {
    copy.append(rise(html`<p class="aw-callout">Biggest day: <b>${formatDay(report.bestDay.date)}</b>, with
      <b>${formatNumber(report.bestDay.units)}</b> episodes and chapters.</p>`, 3));
  }
  const week = html`<div class="aw-glass aw-chart-panel aw-week"><h4 class="aw-panel-title">By weekday</h4></div>`;
  week.append(monthBars(WEEKDAYS.map((label, index) => ({
    label, primary: report.weekdays[index], secondary: 0,
    title: `${WEEKDAY_NAMES[index]}: ${formatNumber(report.weekdays[index])} episodes and chapters`,
  })), report.days.length ? busiest : -1));
  const split = html`<div class="aw-split"></div>`;
  split.append(copy, rise(week, 3));
  inner(element).append(split);
  const heatmap = activityHeatmap(report.period.start, report.period.end, new Map(report.days.map((day) => [day.date, day.units])), 'episodes & chapters');
  if (heatmap) {
    const heat = html`<div class="aw-glass aw-heat-panel"><div class="aw-heat-legend">
      <span>Less</span><i class="aw-heat-cell l1"></i><i class="aw-heat-cell l2"></i><i class="aw-heat-cell l3"></i><i class="aw-heat-cell l4"></i><span>More</span>
    </div></div>`;
    heat.prepend(heatmap);
    inner(element).append(rise(heat, 4));
  }
  return { label: 'Your rhythm', palette: LIQUID_PALETTES.violet, element };
}

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

function clockSlide(report: YearReviewReport): WrappedSlide | null {
  const total = report.hours.reduce((sum, count) => sum + count, 0);
  if (!total) return null;
  const element = slideShell('clock');
  const peak = report.hours.indexOf(Math.max(...report.hours));
  const night = NIGHT_HOURS.reduce((sum, hour) => sum + report.hours[hour], 0) / total;
  const bars: BarDatum[] = report.hours.map((count, hour) => ({
    label: hour % 3 === 0 ? String(hour).padStart(2, '0') : '', primary: count, secondary: 0,
    title: `${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}: ${formatNumber(count)} ${plural(count, 'update')}`,
  }));
  const chart = html`<div class="aw-glass aw-chart-panel aw-chart-panel--wide aw-clock"></div>`;
  chart.append(monthBars(bars, peak));
  inner(element).append(
    rise(eyebrow('Your clock'), 0),
    rise(html`<h3 class="aw-heading">Prime time was <em>${hourLabel(peak)}</em>.</h3>`, 1),
    rise(kicker(`${percent(night)} of your list updates landed between 22:00 and 05:00.`), 2),
    rise(chart, 3),
    rise(note('Times are when you updated AniList, in your current time zone.'), 4)
  );
  return { label: 'Your clock', palette: LIQUID_PALETTES.oil, element };
}

function monthSlide(report: YearReviewReport): WrappedSlide {
  const element = slideShell('months');
  const multiYear = new Set(report.months.map((month) => month.month.slice(0, 4))).size > 1;
  const totals = report.months.map((month) => month.episodes + month.chapters);
  const peakTotal = Math.max(0, ...totals);
  const peak = peakTotal ? totals.indexOf(peakTotal) : -1;
  const chart = monthBars(report.months.map((month) => ({
    label: monthLabel(month.month, multiYear), primary: month.episodes, secondary: month.chapters,
    title: `${monthName(month.month)}: ${formatNumber(month.episodes)} ${plural(month.episodes, 'episode')} · ${formatNumber(month.chapters)} ${plural(month.chapters, 'chapter')}`,
  })), peak);
  chart.setAttribute('data-wrapped-months', '');
  const legend = html`<div class="aw-legend"></div>`;
  if (report.episodes) legend.append(html`<span class="aw-key aw-key--primary">Episodes</span>`);
  if (report.chapters) legend.append(html`<span class="aw-key aw-key--secondary">Chapters</span>`);
  const panelElement = rise(html`<div class="aw-glass aw-chart-panel aw-chart-panel--wide"></div>`, 3);
  panelElement.append(chart, legend);
  inner(element).append(
    rise(eyebrow('Month by month'), 0),
    rise(peak >= 0 ? html`<h3 class="aw-heading"><em>${monthName(report.months[peak].month)}</em> was your peak.</h3>`
      : html`<h3 class="aw-heading">A quiet stretch.</h3>`, 1)
  );
  if (peak >= 0) inner(element).append(rise(kicker(`${formatNumber(peakTotal)} episodes and chapters in a single month.`), 2));
  inner(element).append(panelElement);
  return { label: 'Month by month', palette: LIQUID_PALETTES.ember, element };
}

function bookend(label: string, title: ReviewTitle): HTMLElement {
  const card = html`<figure class="aw-bookend"><figcaption><span>${label}</span><b>${title.title}</b></figcaption></figure>`;
  card.prepend(coverArt(title.cover, title.title, 'aw-cover aw-cover--bookend'));
  return card;
}

function journeySlide(report: YearReviewReport): WrappedSlide | null {
  if (!report.first || !report.last) return null;
  const element = slideShell('journey');
  const { completed, paused, dropped, planned, repeated } = report.statuses;
  const pair = html`<div class="aw-bookends"><i class="fa-solid fa-chevron-right aw-bookend-arrow" aria-hidden="true"></i></div>`;
  pair.prepend(bookend('First', report.first));
  pair.append(bookend('Last', report.last));
  const grid = html`<div class="aw-year-tiles"></div>`;
  const tiles: Array<[number, string, string]> = [
    [completed, 'Completed', ''], [repeated, 'Rewatched', 'or reread'], [paused, 'Paused', ''],
    [dropped, 'Dropped', ''], [planned, 'Planned', 'promises to keep'],
  ];
  tiles.filter(([value], index) => value > 0 || index === 0).forEach(([value, label, caption], index) =>
    grid.append(stagger(tile(formatNumber(value), label, caption), index)));
  const heading = report.first.mediaId === report.last.mediaId
    ? html`<h3 class="aw-heading">It began and ended with <em>${report.first.title}</em>.</h3>`
    : html`<h3 class="aw-heading">From <em>${report.first.title}</em> to <em>${report.last.title}</em>.</h3>`;
  inner(element).append(rise(eyebrow('Your journey'), 0), rise(heading, 1), rise(pair, 2), rise(grid, 3));
  return { label: 'Your journey', palette: LIQUID_PALETTES.lagoon, element };
}

function personaSlide(report: YearReviewReport): WrappedSlide {
  const element = slideShell('persona');
  const [main, ...rest] = report.traits;
  const persona = main ? TRAITS[main] : { name: 'The Wanderer', line: 'A little of everything, on your own terms.' };
  inner(element).append(rise(kicker('This year, you were'), 0), rise(display(persona.name.toUpperCase()), 1),
    rise(html`<p class="aw-lead">${persona.line}</p>`, 2));
  if (rest.length) inner(element).append(rise(pills(rest.map((trait) => [null, TRAITS[trait].name] as const)), 3));
  return { label: 'Your persona', palette: LIQUID_PALETTES.vividLava, mode: 'poster', element };
}

function summarySlide(report: YearReviewReport, options: YearSlideOptions): WrappedSlide {
  const element = slideShell('summary');
  const metrics = html`<div class="aw-summary-metrics"></div>`;
  const values: Array<[number, string]> = [
    [report.episodes, 'Episodes'], [report.chapters, 'Chapters'], [hours(report.minutes), 'Hours'],
    [report.activeDays, 'Active days'], [report.statuses.completed, 'Completed'], [report.longestStreak, 'Day streak'],
  ];
  for (const [value, label] of values) {
    const metric = html`<div><span>${label}</span></div>`;
    metric.prepend(counter(value, 0, 'aw-summary-value'));
    metrics.append(metric);
  }
  const columns = html`<div class="aw-summary-columns">
    <section><h4>Top titles</h4><ol></ol></section><section><h4>Your people</h4><ol class="aw-plain"></ol></section>
  </div>`;
  const [titles, people] = columns.querySelectorAll('ol');
  const top = report.topRated.length >= 3 ? report.topRated : report.titles;
  top.slice(0, 3).forEach((title) => titles.append(html`<li><span>${title.title}</span><b>${
    title.score !== null && report.topRated.length >= 3 ? scoreText(title.score) : `${formatNumber(title.units)} ${unitShort(title)}`}</b></li>`));
  const facts: Array<[string, string | undefined]> = [
    ['Genre', report.genres[0]?.name], ['Voice', report.voiceActors[0]?.name], ['Studio', report.studios[0]?.name],
  ];
  for (const [label, value] of facts) if (value) people.append(html`<li><span>${label}</span><b>${value}</b></li>`);
  const card = html`<div class="aw-glass aw-summary-card"></div>`;
  card.append(metrics, columns);
  const actions = html`<div class="aw-actions-row">
    <button type="button" class="aw-cta" data-wrapped-download><i class="fa-solid fa-download" aria-hidden="true"></i> Download story</button
    ><button type="button" class="aw-ghost" data-story-restart><i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i> Watch again</button>
  </div>`;
  const copy = html`<div class="aw-summary-copy"></div>`;
  copy.append(
    rise(eyebrow("That's a wrap"), 0),
    rise(html`<h3 class="aw-heading">${`${periodTitle(report.period.start, report.period.end)}, wrapped.`}</h3>`, 1),
    rise(card, 2), rise(actions, 3),
    rise(note(`Built from your AniList list activity${report.truncated ? ' (AniList returns at most 5,000 updates, so the most recent ones are missing)' : ''}. A completed title adds the episodes after your last logged progress. Hours use AniList running times.`), 4)
  );
  const layout = html`<div class="aw-summary"></div>`;
  layout.append(copy);
  if (options.preview) layout.append(rise(cardPreview('data-wrapped-preview'), 3));
  inner(element).append(layout);
  return { label: 'Summary', palette: LIQUID_PALETTES.nebula, element, onEnter: options.preview ? previewOnce(options.preview) : undefined };
}
