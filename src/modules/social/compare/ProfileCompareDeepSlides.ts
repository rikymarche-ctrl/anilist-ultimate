/**
 * @file ProfileCompareDeepSlides.ts
 * @description Breakdown slides of the Versus story: conflicts, rare titles, genres, themes,
 * formats, people, who got there first, homework and the full title browser.
 */

import { html } from '@core/utils/Template';
import { LIQUID_PALETTES } from '@modules/astra/ui/wrapped/LiquidBackground';
import { formatNumber } from '@modules/astra/ui/wrapped/WrappedFormat';
import {
  coverArt,
  eyebrow,
  inner,
  note,
  pills,
  rise,
  slideShell,
  stagger,
  type WrappedSlide,
} from '@modules/astra/ui/wrapped/WrappedStory';
import {
  panel,
  rankList,
  scoreText,
  type RankItem,
} from '@modules/astra/ui/wrapped/YearSlideParts';
import { compareBrowser } from './ProfileCompareBrowser';
import type { PersonRow, ShareRow } from './ProfileCompareExtras';
import type {
  CompareReport,
  FirstLead,
  FirstWatch,
  GenreTaste,
  HomeworkTitle,
} from './ProfileCompareModel';
import { legend, scoreValue, seenWord, titleLink } from './ProfileCompareSlides';

const HOMEWORK_ROWS = 5;
const DAYS_PER_MONTH = 30.44;
const DAYS_PER_YEAR = 365.25;
const MONTHS_THRESHOLD_DAYS = 60;
const YEARS_THRESHOLD_DAYS = 2 * DAYS_PER_YEAR;
const MS_PER_DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MirroredRow {
  label: string;
  viewer: number;
  other: number;
  viewerText: string;
  otherText: string;
}

/** "12 days", "8 months", "3.2 years": a precise day count stops meaning anything over years. */
export function leadText(days: number): string {
  if (days < MONTHS_THRESHOLD_DAYS) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < YEARS_THRESHOLD_DAYS) return `${Math.round(days / DAYS_PER_MONTH)} months`;
  return `${formatNumber(days / DAYS_PER_YEAR, 1)} years`;
}

export function dayText(day: number): string {
  const date = new Date(day * MS_PER_DAY);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** You on the left, them on the right. `row` scales each row alone; `all` shares one scale. */
export function mirroredRows(
  rows: readonly MirroredRow[],
  scale: 'row' | 'all',
  attribute: string
): HTMLElement {
  const list = html`<ol class="versus-mirror"></ol>`;
  list.setAttribute(attribute, '');
  const shared = Math.max(...rows.flatMap((row) => [row.viewer, row.other]), 0);
  rows.forEach((row, index) => {
    const max = (scale === 'all' ? shared : Math.max(row.viewer, row.other)) || 1;
    const element = html`<li class="versus-mirror-row">
      <span class="versus-mirror-side versus-mirror-side--viewer"
        ><i></i><b>${row.viewerText}</b></span
      >
      <span class="versus-mirror-label">${row.label}</span>
      <span class="versus-mirror-side versus-mirror-side--other"
        ><i></i><b>${row.otherText}</b></span
      >
    </li>`;
    element.style.setProperty('--viewer', `${(100 * row.viewer) / max}%`);
    element.style.setProperty('--other', `${(100 * row.other) / max}%`);
    if (row.viewer > row.other) element.classList.add('is-viewer-ahead');
    else if (row.other > row.viewer) element.classList.add('is-other-ahead');
    list.append(stagger(element, index));
  });
  return list;
}

const percent = (share: number): string => `${Math.round(share * 100)}%`;
const shareToMirror = (row: ShareRow): MirroredRow => ({
  label: row.label,
  viewer: row.viewerShare,
  other: row.otherShare,
  viewerText: percent(row.viewerShare),
  otherText: percent(row.otherShare),
});

function conflictsSlide(report: CompareReport): WrappedSlide {
  const element = slideShell('conflicts', 'versus-conflicts');
  const name = report.other.name;
  const list = html`<ol class="versus-conflict-list" data-versus-conflicts></ol>`;
  report.conflicts.forEach((row, index) => {
    const yours = row.completedBy === 'viewer';
    const item = html`<li class="versus-conflict aw-glass">
      <span class="versus-conflict-text"
        ><small
          >${yours
            ? `You finished it. ${name} dropped it.`
            : `${name} finished it. You dropped it.`}</small
        ></span
      >
    </li>`;
    item
      .querySelector('.versus-conflict-text')!
      .prepend(titleLink(report, row.mediaId, row.title, 'versus-fight-title'));
    item.prepend(coverArt(row.cover, row.title, 'aw-cover aw-cover--thumb'));
    list.append(stagger(item, index));
  });
  inner(element).append(
    rise(eyebrow('Finished against dropped'), 0),
    rise(html`<h3 class="aw-heading">One of you <em>gave up.</em></h3>`, 1),
    list
  );
  return { label: 'Finished against dropped', palette: LIQUID_PALETTES.lava, element };
}

function deepCutsSlide(report: CompareReport): WrappedSlide {
  const element = slideShell('deep', 'versus-deep');
  const items: RankItem[] = report.deepCuts.map((cut) => ({
    cover: cut.cover,
    title: cut.title,
    caption: `You ${scoreValue(cut.viewerScore)} · ${report.other.name} ${scoreValue(cut.otherScore)}`,
    value: `${formatNumber(cut.popularity)} users`,
  }));
  inner(element).append(
    rise(eyebrow('Your rarest links'), 0),
    rise(html`<h3 class="aw-heading">Few people have seen these. <em>You both have.</em></h3>`, 1),
    rankList(items, 'data-versus-deep')
  );
  return { label: 'Rarest links', palette: LIQUID_PALETTES.ocean, element };
}

function genreHeadline(genres: GenreTaste, otherName: string): HTMLElement {
  const heading = html`<h3 class="aw-heading"></h3>`;
  if (genres.common) heading.append(html`<em>${genres.common.genre}</em>`, ' brings you together.');
  const divide = genres.divide;
  if (divide && divide.genre !== genres.common?.genre) {
    const fan = divide.viewerShare >= divide.otherShare ? 'You lean' : `${otherName} leans`;
    heading.append(` ${fan} into `, html`<em>${divide.genre}</em>`, '.');
  }
  return heading;
}

function genresSlide(report: CompareReport, genres: GenreTaste): WrappedSlide {
  const element = slideShell('genres', 'versus-genres');
  const rows = genres.rows.map((row) => ({
    label: row.genre,
    viewer: row.viewerShare,
    other: row.otherShare,
    viewerText: percent(row.viewerShare),
    otherText: percent(row.otherShare),
  }));
  inner(element).append(
    rise(eyebrow('Taste overlap'), 0),
    rise(genreHeadline(genres, report.other.name), 1),
    rise(pills([[null, `${genres.overlap}% genre overlap`]]), 2),
    rise(legend(report), 2),
    mirroredRows(rows, 'all', 'data-versus-genres'),
    rise(note('Share of each list carrying the genre. A title can carry several.'), 4)
  );
  return { label: 'Genres', palette: LIQUID_PALETTES.nebula, element };
}

function genreScoresSlide(report: CompareReport): WrappedSlide {
  const element = slideShell('genre-scores', 'versus-genre-scores');
  const rows = report.genreScores.map((row) => ({
    label: row.genre,
    viewer: row.viewerMean,
    other: row.otherMean,
    viewerText: formatNumber(row.viewerMean, 1),
    otherText: formatNumber(row.otherMean, 1),
  }));
  inner(element).append(
    rise(eyebrow('Mean score by genre'), 0),
    rise(html`<h3 class="aw-heading">Same genre, <em>different standards.</em></h3>`, 1),
    rise(legend(report), 2),
    mirroredRows(rows, 'all', 'data-versus-genre-scores'),
    rise(note('Genres where your averages differ most, with at least five rated titles each.'), 4)
  );
  return { label: 'Scores by genre', palette: LIQUID_PALETTES.rose, element };
}

function tagsSlide(report: CompareReport): WrappedSlide {
  const element = slideShell('tags', 'versus-tags');
  inner(element).append(
    rise(eyebrow('Themes'), 0),
    rise(html`<h3 class="aw-heading">What your lists <em>keep coming back to.</em></h3>`, 1),
    rise(legend(report), 2),
    mirroredRows(report.tags.map(shareToMirror), 'all', 'data-versus-tags'),
    rise(note('AniList tags on each list, without adult or spoiler tags.'), 4)
  );
  return { label: 'Themes', palette: LIQUID_PALETTES.lagoon, element };
}

function shapeSlide(report: CompareReport): WrappedSlide {
  const element = slideShell('shape', 'versus-shape');
  const columns = html`<div class="versus-columns versus-columns--three"></div>`;
  const add = (title: string, rows: readonly ShareRow[], attribute: string) => {
    if (rows.length)
      columns.append(panel(title, mirroredRows(rows.map(shareToMirror), 'all', attribute)));
  };
  add('Formats', report.formats, 'data-versus-formats');
  add('Release decades', report.decades, 'data-versus-decades');
  add('Countries', report.countries, 'data-versus-countries');
  inner(element).append(
    rise(eyebrow('The shape of your lists'), 0),
    rise(legend(report), 1),
    rise(columns, 2)
  );
  return { label: 'Formats and decades', palette: LIQUID_PALETTES.oil, element };
}

function peoplePanel(title: string, people: readonly PersonRow[], attribute: string): HTMLElement {
  const list = html`<ol class="versus-people"></ol>`;
  list.setAttribute(attribute, '');
  people.forEach((person, index) => {
    const row = html`<li class="versus-person">
      <span class="versus-person-name">${person.name}</span>
      <b class="versus-chip versus-chip--viewer">${String(person.viewerCount)}</b>
      <b class="versus-chip versus-chip--other">${String(person.otherCount)}</b>
    </li>`;
    row.prepend(coverArt(person.image, person.name, 'aw-cover versus-person-image'));
    list.append(stagger(row, index));
  });
  return panel(title, list);
}

function peopleSlide(report: CompareReport): WrappedSlide {
  const element = slideShell('people', 'versus-people-slide');
  const columns = html`<div class="versus-columns versus-columns--three"></div>`;
  if (report.people.studios.length)
    columns.append(peoplePanel('Studios', report.people.studios, 'data-versus-studios'));
  if (report.people.voiceActors.length)
    columns.append(peoplePanel('Voice actors', report.people.voiceActors, 'data-versus-voices'));
  if (report.people.staff.length)
    columns.append(
      peoplePanel(
        report.media === 'ANIME' ? 'Staff' : 'Authors and staff',
        report.people.staff,
        'data-versus-staff'
      )
    );
  inner(element).append(
    rise(eyebrow('In common behind the scenes'), 0),
    rise(html`<h3 class="aw-heading">The people <em>both your lists follow.</em></h3>`, 1),
    rise(legend(report), 2),
    rise(columns, 3),
    rise(note('Titles each of you has with them, among your top fifty.'), 4)
  );
  return { label: 'People in common', palette: LIQUID_PALETTES.violet, element };
}

function leadRow(report: CompareReport, lead: FirstLead, index: number): HTMLElement {
  const name = report.other.name;
  const verb = lead.basis === 'started' ? 'started' : 'finished';
  const item = html`<li class="versus-lead aw-glass">
    <span class="versus-lead-text">
      <span class="versus-lead-dates">
        <span
          ><b class="versus-chip versus-chip--viewer">You</b>
          ${`${verb} ${dayText(lead.viewerDay)}`}</span
        >
        <span
          ><b class="versus-chip versus-chip--other">${name}</b>
          ${`${verb} ${dayText(lead.otherDay)}`}</span
        >
      </span>
    </span>
    <strong class="versus-lead-gap">${leadText(lead.days)}</strong>
  </li>`;
  item
    .querySelector('.versus-lead-text')!
    .prepend(titleLink(report, lead.mediaId, lead.title, 'versus-fight-title'));
  item.prepend(coverArt(lead.cover, lead.title, 'aw-cover aw-cover--thumb'));
  return stagger(item, index);
}

function firstHeadline(report: CompareReport, first: FirstWatch): string {
  const total = first.viewer + first.other + first.sameDay;
  const noun = `of the ${total} shared titles with dates on both lists`;
  if (first.viewer === first.other) return `A dead heat: ${first.viewer} each, ${noun}.`;
  const ahead = first.viewer > first.other;
  const count = Math.max(first.viewer, first.other);
  return `${ahead ? 'You' : report.other.name} ${ahead ? 'were' : 'was'} first on ${count} ${noun}.`;
}

function firstSlide(report: CompareReport, first: FirstWatch): WrappedSlide {
  const element = slideShell('first', 'versus-first');
  const name = report.other.name;
  const total = first.viewer + first.other + first.sameDay;
  const split = html`<div class="versus-split" data-versus-first-split>
    <span class="versus-split-you"><b>${formatNumber(first.viewer)}</b> You first</span>
    <span class="versus-split-same"><b>${formatNumber(first.sameDay)}</b> Same day</span>
    <span class="versus-split-them"><b>${formatNumber(first.other)}</b> ${`${name} first`}</span>
  </div>`;
  split.style.setProperty('--you', String(first.viewer / total));
  split.style.setProperty('--same', String(first.sameDay / total));
  split.style.setProperty('--them', String(first.other / total));
  const columns = html`<div class="versus-columns"></div>`;
  const add = (title: string, leads: readonly FirstLead[]) => {
    if (!leads.length) return;
    const list = html`<ol class="versus-lead-list"></ol>`;
    leads.forEach((lead, index) => list.append(leadRow(report, lead, index)));
    columns.append(panel(title, list));
  };
  add('Your biggest head starts', first.viewerLeads);
  add(`${name}'s biggest head starts`, first.otherLeads);
  inner(element).append(
    rise(eyebrow('Who got there first'), 0),
    rise(html`<h3 class="aw-heading versus-first-heading">${firstHeadline(report, first)}</h3>`, 1),
    rise(split, 2),
    rise(columns, 3),
    rise(
      note(
        `Typical gap between you: ${leadText(first.medianDays)}. Start dates are compared when both exist, otherwise finish dates.`
      ),
      4
    )
  );
  return { label: 'Who was first', palette: LIQUID_PALETTES.ocean, element };
}

function homeworkItems(titles: readonly HomeworkTitle[], planner: string): RankItem[] {
  return titles.slice(0, HOMEWORK_ROWS).map((title) => ({
    cover: title.cover,
    title: title.title,
    caption: title.onPlanning ? `Already on ${planner} Planning list` : 'Not on the list yet',
    value: scoreText(title.score),
  }));
}

function homeworkSlide(report: CompareReport): WrappedSlide {
  const element = slideShell('homework', 'versus-homework');
  const name = report.other.name;
  const seen = seenWord(report);
  const columns = html`<div class="versus-columns"></div>`;
  if (report.homework.viewer.length)
    columns.append(
      panel(
        `${name} rates these, you have not ${seen} them`,
        rankList(homeworkItems(report.homework.viewer, 'your'), 'data-versus-homework-viewer')
      )
    );
  if (report.homework.other.length)
    columns.append(
      panel(
        `You rate these, ${name} has not ${seen} them`,
        rankList(homeworkItems(report.homework.other, `${name}'s`), 'data-versus-homework-other')
      )
    );
  inner(element).append(
    rise(eyebrow('Homework'), 0),
    rise(html`<h3 class="aw-heading">Settle it. <em>Try each other's favourites.</em></h3>`, 1),
    rise(columns, 2)
  );
  return { label: 'Homework', palette: LIQUID_PALETTES.violet, element };
}

function browserSlide(report: CompareReport): WrappedSlide {
  const element = slideShell('browse', 'versus-browser');
  inner(element).append(
    rise(eyebrow('Every title, side by side'), 0),
    rise(
      compareBrowser({
        media: report.media.toLowerCase(),
        otherName: report.other.name,
        rows: report.browser,
      }),
      1
    )
  );
  return { label: 'All titles', hold: true, palette: LIQUID_PALETTES.oil, element };
}

export function deepSlides(report: CompareReport): WrappedSlide[] {
  const slides: WrappedSlide[] = [];
  if (report.conflicts.length) slides.push(conflictsSlide(report));
  if (report.deepCuts.length) slides.push(deepCutsSlide(report));
  if (report.genres) slides.push(genresSlide(report, report.genres));
  if (report.genreScores.length) slides.push(genreScoresSlide(report));
  if (report.tags.length) slides.push(tagsSlide(report));
  if (report.formats.length || report.decades.length || report.countries.length)
    slides.push(shapeSlide(report));
  const { studios, voiceActors, staff } = report.people;
  if (studios.length || voiceActors.length || staff.length) slides.push(peopleSlide(report));
  if (report.first) slides.push(firstSlide(report, report.first));
  if (report.homework.viewer.length || report.homework.other.length)
    slides.push(homeworkSlide(report));
  slides.push(browserSlide(report));
  return slides;
}
