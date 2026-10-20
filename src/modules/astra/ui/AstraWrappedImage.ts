/**
 * @file AstraWrappedImage.ts
 * @description The 1080 × 1920 Astra Wrapped share card: a dense poster of the year in the
 * liquid art direction. Covers and the top voice actor are drawn when their images loaded
 * with CORS; otherwise typographic tiles take their place, so the card always exports.
 */

import type { ReviewTitle, YearReviewReport } from '../services/year/YearReviewTypes';
import { parseWebUrl } from '@core/utils/WebUrl';
import { LIQUID_PALETTES } from './wrapped/LiquidBackground';
import {
  STORY_INNER as INNER,
  STORY_MARGIN as M,
  STORY_WIDTH as W,
  StoryCanvas,
  seedFrom,
  type BarItem,
} from './wrapped/WrappedCanvas';
import {
  formatNumber,
  formatRange,
  monthLabel,
  periodNoun,
  periodTitle,
  plural,
} from './wrapped/WrappedFormat';
import { TRAITS } from './wrapped/YearSlides';

const GAP = 20;
const POSTER_HEIGHT = 760;
const TOP_COVERS = 5;
const IMAGE_TIMEOUT_MS = 6000;

export type WrappedPictures = ReadonlyMap<string, HTMLImageElement>;

const cardTitles = (report: YearReviewReport): ReviewTitle[] => {
  const rated = report.topRated.filter((title) => title.type === 'ANIME');
  return (
    rated.length >= 3
      ? rated
      : report.titles.filter((title) => title.type === 'ANIME' && title.units > 0)
  ).slice(0, TOP_COVERS);
};

/**
 * Pictures already shown by the page were cached without CORS, and Chrome then refuses a CORS
 * request for the same URL; a distinct query string gives the canvas its own CORS response.
 */
const CORS_QUERY = 'astra-wrapped';
const corsUrl = (url: string) => {
  const parsed = parseWebUrl(url);
  if (!parsed) return null;
  parsed.searchParams.set(CORS_QUERY, '1');
  return parsed.href;
};

/** Loads the card's pictures with CORS; failures and slow images are simply left out. */
export async function loadWrappedPictures(report: YearReviewReport): Promise<WrappedPictures> {
  const urls = [
    ...cardTitles(report).map((title) => title.cover),
    report.voiceActors[0]?.image ?? null,
  ].flatMap((url) => (url ? [url] : []));
  const pictures = new Map<string, HTMLImageElement>();
  await Promise.all(
    [...new Set(urls)].map(
      (url) =>
        new Promise<void>((resolve) => {
          const source = corsUrl(url);
          if (!source) {
            resolve();
            return;
          }
          const image = new Image();
          const timer = setTimeout(resolve, IMAGE_TIMEOUT_MS);
          image.crossOrigin = 'anonymous';
          image.decoding = 'async';
          image.onload = () => {
            clearTimeout(timer);
            pictures.set(url, image);
            resolve();
          };
          image.onerror = () => {
            clearTimeout(timer);
            resolve();
          };
          image.src = source;
        })
    )
  );
  return pictures;
}

/** Draws the card; if any picture would taint the canvas, redraws it without pictures. */
export function drawWrappedImage(
  report: YearReviewReport,
  pictures: WrappedPictures = new Map()
): HTMLCanvasElement {
  const canvas = draw(report, pictures);
  if (!pictures.size) return canvas;
  try {
    canvas.getContext('2d')!.getImageData(0, 0, 1, 1);
    return canvas;
  } catch {
    return draw(report, new Map());
  }
}

function draw(report: YearReviewReport, pictures: WrappedPictures): HTMLCanvasElement {
  const { start, end } = report.period;
  const story = new StoryCanvas(LIQUID_PALETTES.nebula, seedFrom(`${start}|${end}`), {
    palette: LIQUID_PALETTES.vividNebula,
    height: POSTER_HEIGHT,
  });
  const picture = (url: string | null) => (url ? (pictures.get(url) ?? null) : null);
  drawPoster(story, report);
  drawTiles(story, report, 760);
  drawCovers(story, report, 916, picture);
  drawPeople(story, report, 1276, picture);
  drawGenres(story, report, M, 1544, (INNER - GAP) / 2, 280);
  drawMonths(story, report, M + (INNER + GAP) / 2, 1544, (INNER - GAP) / 2, 280);
  story.muted('From your AniList list activity · anilist.co', M, 1876, 19);
  story.text('AniList Ultimate · Astra', W - M, 1876, {
    size: 19,
    weight: 700,
    color: 'rgba(255, 255, 255, 0.85)',
    align: 'right',
  });
  return story.canvas;
}

function drawPoster(story: StoryCanvas, report: YearReviewReport): void {
  const { start, end } = report.period;
  story.text('ASTRA WRAPPED', M, 118, { size: 22, weight: 800, tracking: 7 });
  story.muted(formatRange(start, end), W - M, 118, 22, 'right');
  const title = periodTitle(start, end);
  const size = story.fitSize(title, INNER + 20, 280, 900);
  const baseline = 150 + size * 0.76;
  story.liquid(title, M - 10, baseline, { size, weight: 900, tracking: -size * 0.04 });
  const noun = periodNoun(start, end);
  story.text(
    noun === 'period' ? 'Your AniList, wrapped.' : `Your ${noun} on AniList.`,
    M,
    baseline + 64,
    { size: 38, weight: 700, maxWidth: INNER - 360 }
  );
  const persona = report.traits[0] ? TRAITS[report.traits[0]].name : null;
  if (persona)
    story.text(persona.toUpperCase(), W - M, baseline + 64, {
      size: 22,
      weight: 900,
      tracking: 4,
      align: 'right',
      color: story.palette.accent,
    });
  const time = Math.round(report.minutes / 60);
  const figures: Array<[number, string]> = [
    [report.episodes, plural(report.episodes, 'episode')],
    [time, `${plural(time, 'hour')} watched`],
    report.chapters
      ? [report.chapters, plural(report.chapters, 'chapter')]
      : [report.titles.length, plural(report.titles.length, 'title')],
  ];
  const column = INNER / 3;
  const top = Math.max(baseline + 110, 520);
  figures.forEach(([value, label], index) => {
    const x = M + index * column;
    const numberSize = story.fitSize(formatNumber(value), column - 30, 130, 900);
    story.liquid(formatNumber(value), x - 4, top + numberSize * 0.76, {
      size: numberSize,
      weight: 900,
      tracking: -numberSize * 0.03,
    });
    story.text(label.toUpperCase(), x, top + 136, {
      size: 17,
      weight: 800,
      color: 'rgba(255, 255, 255, 0.78)',
      tracking: 4,
      maxWidth: column - 30,
    });
  });
}

function drawTiles(story: StoryCanvas, report: YearReviewReport, y: number): void {
  const width = (INNER - 3 * GAP) / 4;
  const delta =
    report.community.rated >= 3 && report.community.meanDifference !== null
      ? report.community.meanDifference / 10
      : null;
  const tiles: Array<[string, string]> = [
    [formatNumber(report.activeDays), 'Active days'],
    [formatNumber(report.longestStreak), 'Day streak'],
    [formatNumber(report.statuses.completed), 'Completed'],
    delta !== null
      ? [`${delta >= 0 ? '+' : '−'}${formatNumber(Math.abs(delta), 1)}`, 'vs AniList']
      : [formatNumber(report.titles.length), 'Titles'],
  ];
  tiles.forEach(([value, label], index) => {
    const x = M + index * (width + GAP);
    story.glass(x, y, width, 132, 26);
    story.text(value, x + 26, y + 78, { size: 52, weight: 900, maxWidth: width - 44 });
    story.text(label.toUpperCase(), x + 26, y + 112, {
      size: 15,
      weight: 800,
      color: 'rgba(255, 255, 255, 0.72)',
      tracking: 3,
      maxWidth: width - 44,
    });
  });
}

function drawCovers(
  story: StoryCanvas,
  report: YearReviewReport,
  y: number,
  picture: (url: string | null) => HTMLImageElement | null
): void {
  const titles = cardTitles(report);
  story.glass(M, y, INNER, 340);
  story.label(
    report.topRated.filter((title) => title.type === 'ANIME').length >= 3
      ? 'Top anime · your scores'
      : 'Most watched anime',
    M + 36,
    y + 52
  );
  const gap = 18;
  const width = (INNER - 72 - gap * (TOP_COVERS - 1)) / TOP_COVERS;
  titles.forEach((title, index) => {
    const x = M + 36 + index * (width + gap);
    story.picture(picture(title.cover), x, y + 76, width, width * 1.36, 14, title.title);
    story.text(String(index + 1), x + 12, y + 76 + width * 1.36 - 14, {
      size: 44,
      weight: 900,
      color: '#ffffff',
    });
    story.text(title.title, x, y + 76 + width * 1.36 + 30, {
      size: 17,
      weight: 700,
      maxWidth: width,
    });
  });
  if (!titles.length) story.muted('No anime this period', M + 36, y + 140, 24);
}

function drawPeople(
  story: StoryCanvas,
  report: YearReviewReport,
  y: number,
  picture: (url: string | null) => HTMLImageElement | null
): void {
  const half = (INNER - GAP) / 2;
  const actor = report.voiceActors[0];
  story.glass(M, y, half, 248);
  story.label('Top voice actor', M + 34, y + 50);
  if (actor) {
    story.picture(picture(actor.image), M + 34, y + 76, 140, 140, 70, actor.name);
    const nameSize = story.fitSize(actor.name, half - 230, 30, 900);
    story.text(actor.name, M + 196, y + 132, { size: nameSize, weight: 900, maxWidth: half - 220 });
    story.muted(
      `${formatNumber(actor.characters.length)} ${plural(actor.characters.length, 'character')} · ${formatNumber(actor.titles)} ${plural(actor.titles, 'title')}`,
      M + 196,
      y + 172,
      21,
      'left',
      half - 220
    );
  } else story.muted('No cast data yet', M + 34, y + 130, 22);
  const x = M + half + GAP;
  story.glass(x, y, half, 248);
  story.label('The creators', x + 34, y + 50);
  const rows: Array<[string, string | undefined]> = [
    ['Studio', report.studios[0]?.name],
    ['Director', report.directors[0]?.name],
    ['Music', report.composers[0]?.name],
  ];
  rows
    .filter(([, value]) => value)
    .forEach(([label, value], index) => {
      story.muted(label.toUpperCase(), x + 34, y + 104 + index * 50, 15);
      story.text(value!, x + 150, y + 104 + index * 50, {
        size: 24,
        weight: 800,
        maxWidth: half - 184,
      });
    });
}

function drawGenres(
  story: StoryCanvas,
  report: YearReviewReport,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  story.glass(x, y, width, height);
  story.label('Your genres', x + 34, y + 52);
  const genres = report.genres.map((genre) => ({ label: genre.name, value: genre.titles }));
  if (genres.length >= 3) {
    story.radar(x + width / 2, y + 170, 56, genres);
    return;
  }
  if (!genres.length) story.muted('No genres recorded', x + 34, y + 120, 24);
  genres.forEach((genre, index) =>
    story.text(`${genre.label} · ${genre.value}`, x + 34, y + 120 + index * 46, {
      size: 28,
      weight: 800,
      maxWidth: width - 68,
    })
  );
}

function drawMonths(
  story: StoryCanvas,
  report: YearReviewReport,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  story.glass(x, y, width, height);
  story.label('Month by month', x + 34, y + 52);
  const multiYear = new Set(report.months.map((month) => month.month.slice(0, 4))).size > 1;
  let items: BarItem[] = report.months.map((month) => ({
    label: monthLabel(month.month, false).slice(0, multiYear ? 3 : 1),
    primary: month.episodes,
    secondary: month.chapters,
  }));
  if (items.length > 24) {
    const years = new Map<string, BarItem>();
    for (const month of report.months) {
      const year = month.month.slice(0, 4);
      const item = years.get(year) ?? { label: `'${year.slice(2)}`, primary: 0, secondary: 0 };
      item.primary += month.episodes;
      item.secondary += month.chapters;
      years.set(year, item);
    }
    items = [...years.values()];
  }
  story.bars(x + 34, y + 84, width - 68, height - 140, items);
}
