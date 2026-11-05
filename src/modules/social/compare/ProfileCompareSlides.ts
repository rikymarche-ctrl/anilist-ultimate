/**
 * @file ProfileCompareSlides.ts
 * @description Story of the profile comparison ("Versus"): opening, overlap and score slides.
 * The breakdown slides live in ProfileCompareDeepSlides.ts.
 *
 * Wrapped in style, not in length: the story is as long as the data deserves. A slide with
 * nothing honest to say is left out. You are always the solid shape, the other person the outline.
 */

import { html } from '@core/utils/Template';
import { LIQUID_PALETTES, type LiquidPalette } from '@modules/astra/ui/wrapped/LiquidBackground';
import { formatNumber } from '@modules/astra/ui/wrapped/WrappedFormat';
import {
  cardPreview,
  coverArt,
  displayNumber,
  eyebrow,
  inner,
  kicker,
  note,
  pills,
  previewOnce,
  rise,
  slideShell,
  stagger,
  type WrappedSlide,
} from '@modules/astra/ui/wrapped/WrappedStory';
import { deepSlides, mirroredRows } from './ProfileCompareDeepSlides';
import {
  vennLayout,
  type Affinity,
  type CompareReport,
  type ScoredTitle,
} from './ProfileCompareModel';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VENN_WIDTH = 460;
const VENN_HEIGHT = 300;
const VENN_TOP = 38;
const VENN_PADDING = 6;
const VENN_MIN_REGION = 34;
const PLOT_SIZE = 460;
const PLOT_PAD = 50;
const PLOT_END = 10;
/** The plot zooms to the scores in use, but always shows at least the top four points of the scale. */
const PLOT_MAX_FLOOR = 6;
const PLOT_DOT = 3;
const PLOT_DOT_GROWTH = 3;
const MINUTES_PER_HOUR = 60;

export interface CompareSlideOptions {
  /** Renders the share card for the verdict preview. */
  preview?: () => HTMLCanvasElement;
}

export const seenWord = (report: CompareReport): string =>
  report.media === 'ANIME' ? 'watched' : 'read';
export const mediaUrl = (report: CompareReport, mediaId: number): string =>
  `https://anilist.co/${report.media.toLowerCase()}/${mediaId}`;
export const scoreValue = (score: number): string =>
  score ? formatNumber(score, score % 1 ? 1 : 0) : 'NR';

/** Keeps the two people apart wherever a slide shows both. */
export function legend(report: CompareReport): HTMLElement {
  return html`<div class="aw-legend versus-legend">
    <span class="aw-key aw-key--primary">You</span>
    <span class="aw-key aw-key--secondary">${report.other.name}</span>
  </div>`;
}

export function titleLink(
  report: CompareReport,
  mediaId: number,
  title: string,
  className: string
): HTMLElement {
  const link = html`<a class="${className}" target="_blank" rel="noopener noreferrer">${title}</a>`;
  link.setAttribute('href', mediaUrl(report, mediaId));
  return link;
}

function identity(url: string | null, name: string): HTMLElement {
  const row = html`<span class="versus-identity"
    ><span class="versus-identity-name">${name}</span></span
  >`;
  row.prepend(coverArt(url, name, 'aw-cover versus-avatar'));
  return row;
}

function introSlide(report: CompareReport): WrappedSlide {
  const element = slideShell('intro', 'versus-intro');
  const noun = report.media === 'ANIME' ? 'Anime' : 'Manga';
  const top = html`<div class="aw-poster-top">
    <span class="aw-tag">Astra compare</span><span class="aw-tag">${`${noun} lists`}</span>
  </div>`;
  const title = html`<h3 class="versus-lockup"></h3>`;
  const you = identity(report.viewer.avatar, 'You');
  you.append(html`<span class="versus-lockup-times" aria-hidden="true">×</span>`);
  title.append(you, identity(report.other.avatar, report.other.name));
  title.style.setProperty('--chars', String(Math.max(6, [...report.other.name].length)));
  const foot = html`<div class="aw-poster-foot">
    <p class="aw-lead">Two lists, measured against each other, title by title.</p>
  </div>`;
  foot.append(
    pills([
      [report.viewerSeen, `${seenWord(report)} by you`],
      [report.otherSeen, `${seenWord(report)} by ${report.other.name}`],
    ]),
    html`<button type="button" class="aw-cta" data-story-next data-story-play>
      <i class="fa-solid fa-play" aria-hidden="true"></i> Play the story
    </button>`
  );
  inner(element).append(rise(top, 0), rise(title, 1), rise(foot, 3));
  return { label: 'Intro', palette: LIQUID_PALETTES.nebula, element };
}

function tapeSlide(report: CompareReport): WrappedSlide {
  const element = slideShell('tape', 'versus-tape');
  const rows = report.tape.map((row) => ({
    label: row.label,
    viewer: row.viewer,
    other: row.other,
    viewerText: `${formatNumber(row.viewer, row.decimals)}${row.suffix}`,
    otherText: `${formatNumber(row.other, row.decimals)}${row.suffix}`,
  }));
  inner(element).append(
    rise(eyebrow('Head to head'), 0),
    rise(legend(report), 1),
    mirroredRows(rows, 'row', 'data-versus-tape')
  );
  return { label: 'Head to head', palette: LIQUID_PALETTES.oil, element };
}

function svgNode(name: string, attributes: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function svgText(
  x: number,
  y: number,
  value: string,
  anchor: string,
  className: string
): SVGElement {
  const text = svgNode('text', { class: className, x, y, 'text-anchor': anchor });
  text.textContent = value;
  return text;
}

/** Two circles whose areas follow the list sizes; names sit above, counts inside their own region. */
export function vennChart(report: CompareReport): SVGElement {
  const unit = vennLayout(report.viewerSeen, report.otherSeen, report.shared);
  const span = unit.viewerRadius + unit.distance + unit.otherRadius;
  const usableWidth = VENN_WIDTH - 2 * VENN_PADDING;
  const usableHeight = VENN_HEIGHT - VENN_TOP - VENN_PADDING;
  const largest = Math.max(unit.viewerRadius, unit.otherRadius);
  const scale = Math.min(usableWidth / span, usableHeight / (2 * largest));
  const viewerR = unit.viewerRadius * scale;
  const otherR = unit.otherRadius * scale;
  const left = (VENN_WIDTH - span * scale) / 2 + viewerR;
  const right = left + unit.distance * scale;
  const middle = VENN_TOP + usableHeight / 2;
  const root = svgNode('svg', {
    class: 'versus-venn',
    viewBox: `0 0 ${VENN_WIDTH} ${VENN_HEIGHT}`,
    role: 'img',
  });
  root.setAttribute(
    'aria-label',
    `${report.viewerOnly} titles only you, ${report.shared} shared, ${report.otherOnly} only ${report.other.name}`
  );
  const circle = (cx: number, r: number) =>
    svgNode('circle', { class: 'versus-venn-circle', cx, cy: middle, r });
  root.append(
    circle(left, viewerR),
    circle(right, otherR),
    svgText(left - viewerR, 22, 'You', 'start', 'versus-venn-name'),
    svgText(right + otherR, 22, report.other.name, 'end', 'versus-venn-name')
  );
  const count = (from: number, to: number, value: number) => {
    if (to - from >= VENN_MIN_REGION)
      root.append(
        svgText((from + to) / 2, middle + 7, formatNumber(value), 'middle', 'versus-venn-count')
      );
  };
  count(left - viewerR, right - otherR, report.viewerOnly);
  count(
    Math.max(left - viewerR, right - otherR),
    Math.min(left + viewerR, right + otherR),
    report.shared
  );
  count(left + viewerR, right + otherR, report.otherOnly);
  return root;
}

function overlapSlide(report: CompareReport): WrappedSlide {
  const element = slideShell('figure', 'versus-overlap');
  const percent = (part: number, whole: number) => (whole ? Math.round((100 * part) / whole) : 0);
  const copy = html`<div class="versus-overlap-copy"></div>`;
  copy.append(
    rise(eyebrow('On both lists'), 0),
    rise(displayNumber(report.shared), 1),
    rise(
      kicker(
        report.shared
          ? `${report.shared === 1 ? 'title' : 'titles'} you have both ${seenWord(report)}.`
          : `Not a single title in common with ${report.other.name}. Yet.`
      ),
      2
    ),
    rise(
      pills([
        [null, `${percent(report.shared, report.viewerSeen)}% of your list`],
        [null, `${percent(report.shared, report.otherSeen)}% of ${report.other.name}'s list`],
        [null, `${report.overlap}% of both combined`],
      ]),
      3
    )
  );
  const art = html`<div class="versus-venn-wrap"></div>`;
  art.append(vennChart(report));
  const layout = html`<div class="versus-overlap-layout"></div>`;
  layout.append(copy, rise(art, 2));
  inner(element).append(layout);
  return { label: 'Shared titles', mode: 'poster', palette: LIQUID_PALETTES.vividOcean, element };
}

function biasText(affinity: Affinity, otherName: string): string {
  const size = formatNumber(Math.abs(affinity.bias), 1);
  if (Number(size) === 0) return 'Neither of you scores higher';
  return affinity.bias > 0 ? `${otherName} scores ${size} higher` : `You score ${size} higher`;
}

function affinitySlide(report: CompareReport, affinity: Affinity): WrappedSlide {
  const element = slideShell('figure', 'versus-affinity');
  const figure = html`<div class="versus-percent"><span class="aw-word">%</span></div>`;
  figure.prepend(displayNumber(affinity.percent));
  inner(element).append(
    rise(eyebrow('Score affinity'), 0),
    rise(figure, 1),
    rise(
      kicker(
        `How closely your scores move together, across the ${affinity.pairs} titles you both rated.`
      ),
      2
    ),
    rise(
      pills([
        [affinity.exact, affinity.exact === 1 ? 'identical score' : 'identical scores'],
        [null, `${formatNumber(affinity.meanGap, 1)} points apart on average`],
        [null, biasText(affinity, report.other.name)],
      ]),
      3
    ),
    rise(note('100% moves in step, 0% is unrelated, below zero is opposite tastes.'), 4)
  );
  return { label: 'Score affinity', mode: 'poster', palette: LIQUID_PALETTES.vividRose, element };
}

export interface PlotBubble {
  viewerScore: number;
  otherScore: number;
  count: number;
}

/** Titles with nearly the same pair of scores become one bubble, so a crowded corner stays readable. */
export function plotBubbles(points: readonly ScoredTitle[]): PlotBubble[] {
  const bubbles = new Map<string, PlotBubble>();
  for (const point of points) {
    const viewerScore = Math.round(point.viewerScore * 2) / 2;
    const otherScore = Math.round(point.otherScore * 2) / 2;
    const key = `${viewerScore}:${otherScore}`;
    const count = (bubbles.get(key)?.count ?? 0) + 1;
    bubbles.set(key, { viewerScore, otherScore, count });
  }
  return [...bubbles.values()].sort((left, right) => right.count - left.count);
}

/** Every title both rated. Solid bubbles lean your way, outlined ones the other person's, as everywhere else. */
function scorePlot(report: CompareReport): SVGElement {
  const reach = PLOT_SIZE - PLOT_PAD - PLOT_END;
  const lowest = report.points.flatMap((point) => [point.viewerScore, point.otherScore]);
  const floor = Math.min(PLOT_MAX_FLOOR, Math.floor(Math.min(...lowest)));
  const span = 10 - floor;
  const x = (score: number) => PLOT_PAD + ((score - floor) / span) * reach;
  const y = (score: number) => PLOT_END + reach - ((score - floor) / span) * reach;
  const root = svgNode('svg', { class: 'versus-plot', viewBox: `0 0 ${PLOT_SIZE} ${PLOT_SIZE}`, role: 'img' });
  root.setAttribute('aria-label', `Each title both rated, by your score and ${report.other.name}'s score`);
  root.append(svgNode('rect', { class: 'versus-plot-frame', x: PLOT_PAD, y: PLOT_END, width: reach, height: reach, rx: 8 }));
  for (let tick = floor; tick <= 10; tick++) {
    root.append(
      svgNode('line', { class: 'versus-plot-grid', x1: x(tick), y1: PLOT_END, x2: x(tick), y2: PLOT_END + reach }),
      svgNode('line', { class: 'versus-plot-grid', x1: PLOT_PAD, y1: y(tick), x2: PLOT_PAD + reach, y2: y(tick) }),
      svgText(x(tick), PLOT_END + reach + 16, String(tick), 'middle', 'versus-plot-tick'),
      svgText(PLOT_PAD - 8, y(tick) + 4, String(tick), 'end', 'versus-plot-tick')
    );
  }
  root.append(
    svgNode('line', { class: 'versus-plot-diagonal', x1: x(floor), y1: y(floor), x2: x(10), y2: y(10) }),
    svgText(PLOT_PAD + 10, PLOT_END + 20, `${report.other.name} scored higher`, 'start', 'versus-plot-zone'),
    svgText(PLOT_PAD + reach - 10, PLOT_END + reach - 10, 'You scored higher', 'end', 'versus-plot-zone')
  );
  for (const bubble of plotBubbles(report.points)) {
    const side = bubble.viewerScore === bubble.otherScore ? 'same' : bubble.viewerScore > bubble.otherScore ? 'you' : 'them';
    const dot = svgNode('circle', {
      class: `versus-plot-dot versus-plot-dot--${side}`,
      cx: x(bubble.viewerScore),
      cy: y(bubble.otherScore),
      r: PLOT_DOT + Math.sqrt(bubble.count) * PLOT_DOT_GROWTH,
    });
    const title = svgNode('title', {});
    title.textContent = `You ${bubble.viewerScore}, ${report.other.name} ${bubble.otherScore}: ${bubble.count} ${bubble.count === 1 ? 'title' : 'titles'}`;
    dot.append(title);
    root.append(dot);
  }
  const axisY = svgText(0, 0, `${report.other.name}'s score`, 'middle', 'versus-plot-axis');
  axisY.setAttribute('transform', `translate(14 ${PLOT_END + reach / 2}) rotate(-90)`);
  root.append(svgText(PLOT_PAD + reach / 2, PLOT_SIZE - 6, 'Your score', 'middle', 'versus-plot-axis'), axisY);
  return root;
}

function habitsSlide(report: CompareReport): WrappedSlide {
  const element = slideShell('habits', 'versus-habits');
  const max = Math.max(
    ...report.distribution.flatMap((row) => [row.viewerShare, row.otherShare]),
    0.01
  );
  const bars = html`<div class="versus-histogram" data-versus-distribution></div>`;
  for (const row of report.distribution) {
    const column = html`<div class="versus-histogram-col">
      <span class="versus-histogram-pair"
        ><i class="versus-bar-you"></i><i class="versus-bar-them"></i
      ></span>
      <b>${String(row.bucket)}</b>
    </div>`;
    column.style.setProperty('--viewer', `${(100 * row.viewerShare) / max}%`);
    column.style.setProperty('--other', `${(100 * row.otherShare) / max}%`);
    bars.append(column);
  }
  const panels = html`<div class="versus-habits-layout"></div>`;
  const plot = html`<div class="versus-plot-wrap aw-glass"></div>`;
  if (report.points.length) plot.append(scorePlot(report));
  else plot.remove();
  const histogram = html`<div class="versus-histogram-wrap aw-glass">
    <h4 class="aw-panel-title">How you each use the scale</h4>
  </div>`;
  histogram.append(bars);
  panels.append(histogram);
  if (report.points.length) panels.append(plot);
  inner(element).append(
    rise(eyebrow('Scoring habits'), 0),
    rise(html`<h3 class="aw-heading">Same scale, <em>different habits.</em></h3>`, 1),
    rise(legend(report), 2),
    rise(panels, 2),
    rise(
      note(`Each bubble is a pair of scores on titles you both rated; bigger means more titles. On the dashed line you agree. Solid: you scored higher. Outlined: ${report.other.name} scored higher.`),
      3
    )
  );
  return { label: 'Scoring habits', palette: LIQUID_PALETTES.violet, element };
}

function fightRow(report: CompareReport, title: ScoredTitle, index: number): HTMLElement {
  const row = html`<li class="versus-fight">
    <span class="versus-fight-text"></span>
    <span class="versus-track">
      <i class="versus-track-span"></i>
      <b class="versus-dot versus-dot--viewer">${scoreValue(title.viewerScore)}</b>
      <b class="versus-dot versus-dot--other">${scoreValue(title.otherScore)}</b>
    </span>
  </li>`;
  row
    .querySelector('.versus-fight-text')!
    .append(titleLink(report, title.mediaId, title.title, 'versus-fight-title'));
  row.prepend(coverArt(title.cover, title.title, 'aw-cover aw-cover--thumb'));
  const track = row.querySelector<HTMLElement>('.versus-track')!;
  track.style.setProperty('--viewer', `${title.viewerScore * 10}%`);
  track.style.setProperty('--other', `${title.otherScore * 10}%`);
  track.style.setProperty('--from', `${Math.min(title.viewerScore, title.otherScore) * 10}%`);
  track.style.setProperty('--to', `${Math.max(title.viewerScore, title.otherScore) * 10}%`);
  return stagger(row, index);
}

function fightsSlide(
  report: CompareReport,
  titles: readonly ScoredTitle[],
  yours: boolean
): WrappedSlide {
  const element = slideShell('fights', 'versus-fights');
  const [top] = titles;
  const name = report.other.name;
  const list = html`<ol class="versus-fight-list" data-versus-fights></ol>`;
  titles.forEach((title, index) => list.append(fightRow(report, title, index)));
  const copy = html`<div class="versus-fight-copy"></div>`;
  copy.append(
    rise(eyebrow(yours ? 'You rate them higher' : `${name} rates them higher`), 0),
    rise(
      html`<h3 class="aw-heading">
        <em>${yours ? 'You love these.' : `${name} loves these.`}</em>
      </h3>`,
      1
    ),
    rise(legend(report), 2),
    list
  );
  const layout = html`<div class="versus-duel"></div>`;
  layout.append(
    rise(coverArt(top.cover, top.title, 'aw-cover aw-cover--hero versus-fight-cover'), 1),
    copy
  );
  inner(element).append(layout);
  return {
    label: yours ? 'You rate higher' : 'They rate higher',
    palette: LIQUID_PALETTES.lava,
    element,
  };
}

function wallCard(report: CompareReport, title: ScoredTitle, index: number): HTMLElement {
  const card = html`<li class="versus-wall-card">
    <span class="versus-wall-scores">
      <b class="versus-chip versus-chip--viewer">${scoreValue(title.viewerScore)}</b>
      <b class="versus-chip versus-chip--other">${scoreValue(title.otherScore)}</b>
    </span>
  </li>`;
  card.prepend(coverArt(title.cover, title.title, 'aw-cover versus-wall-cover'));
  card.append(titleLink(report, title.mediaId, title.title, 'versus-wall-title'));
  return stagger(card, index);
}

function wallSlide(
  report: CompareReport,
  titles: readonly ScoredTitle[],
  label: string,
  heading: HTMLElement,
  palette: LiquidPalette
): WrappedSlide {
  const element = slideShell('agreements', 'versus-agreements');
  const wall = html`<ol class="versus-wall" data-versus-wall></ol>`;
  titles.forEach((title, index) => wall.append(wallCard(report, title, index)));
  inner(element).append(rise(eyebrow(label), 0), rise(heading, 1), rise(legend(report), 2), wall);
  return { label, palette, element };
}

function metric(value: string, label: string): HTMLElement {
  return html`<div><strong class="aw-summary-value">${value}</strong><span>${label}</span></div>`;
}

function verdictMetrics(report: CompareReport): HTMLElement {
  const grid = html`<div class="aw-summary-metrics"></div>`;
  grid.append(metric(formatNumber(report.shared), 'Shared titles'));
  grid.append(
    report.affinity
      ? metric(`${report.affinity.percent}%`, 'Score affinity')
      : metric(`${report.overlap}%`, 'List overlap')
  );
  if (report.genres) grid.append(metric(`${report.genres.overlap}%`, 'Genre overlap'));
  if (report.media === 'ANIME')
    grid.append(
      metric(
        formatNumber(Math.round(report.viewer.stats.minutes / MINUTES_PER_HOUR)),
        'Your hours'
      ),
      metric(
        formatNumber(Math.round(report.other.stats.minutes / MINUTES_PER_HOUR)),
        `${report.other.name}'s hours`
      )
    );
  return grid;
}

function verdictSlide(report: CompareReport, options: CompareSlideOptions): WrappedSlide {
  const element = slideShell('summary', 'versus-verdict');
  const card = html`<div class="aw-summary-card aw-glass"></div>`;
  card.append(verdictMetrics(report));
  const actions = html`<div class="aw-actions-row">
    <button type="button" class="aw-cta" data-versus-download>
      <i class="fa-solid fa-download" aria-hidden="true"></i> Download story card
    </button>
    <button type="button" class="aw-ghost" data-story-restart>Watch again</button>
  </div>`;
  const verdict = html`<h3 class="versus-verdict-title">${report.verdict}</h3>`;
  const longest = Math.max(...report.verdict.split(' ').map((word) => word.length));
  verdict.style.setProperty('--chars', String(longest));
  const copy = html`<div class="aw-summary-copy"></div>`;
  copy.append(
    rise(eyebrow('The verdict'), 0),
    rise(verdict, 1),
    rise(card, 2),
    rise(actions, 3),
    rise(note('Your private entries are left out, and adult titles are never named.'), 4)
  );
  const layout = html`<div class="aw-summary"></div>`;
  layout.append(copy, rise(cardPreview('data-wrapped-preview'), 3));
  inner(element).append(layout);
  return {
    label: 'Verdict',
    hold: true,
    palette: LIQUID_PALETTES.rose,
    element,
    onEnter: options.preview ? previewOnce(options.preview) : undefined,
  };
}

/** Puts a slide's content on one blurred panel: the liquid behind it must never hurt legibility. */
function wrapInPanel(slide: WrappedSlide): void {
  const content = inner(slide.element);
  const surface = document.createElement('div');
  surface.className = 'versus-panel aw-glass';
  surface.append(...content.childNodes);
  content.append(surface);
}

export function compareSlides(
  report: CompareReport,
  options: CompareSlideOptions = {}
): WrappedSlide[] {
  const slides: WrappedSlide[] = [introSlide(report), tapeSlide(report), overlapSlide(report)];
  if (report.affinity) slides.push(affinitySlide(report, report.affinity));
  if (report.distribution.some((row) => row.viewerShare || row.otherShare))
    slides.push(habitsSlide(report));
  if (report.fightsViewer.length) slides.push(fightsSlide(report, report.fightsViewer, true));
  if (report.fightsOther.length) slides.push(fightsSlide(report, report.fightsOther, false));
  if (report.agreements.length)
    slides.push(
      wallSlide(
        report,
        report.agreements,
        'Loved by both',
        html`<h3 class="aw-heading">On these, <em>you are one person.</em></h3>`,
        LIQUID_PALETTES.lagoon
      )
    );
  if (report.bothLow.length)
    slides.push(
      wallSlide(
        report,
        report.bothLow,
        'Disliked by both',
        html`<h3 class="aw-heading">At least you <em>agree on these.</em></h3>`,
        LIQUID_PALETTES.ember
      )
    );
  slides.push(...deepSlides(report), verdictSlide(report, options));
  slides.filter((slide) => slide.mode !== 'poster').forEach(wrapInPanel);
  return slides;
}

/** Backdrop before the first slide is on screen. */
export const COMPARE_LOADING_PALETTE: LiquidPalette = LIQUID_PALETTES.nebula;
