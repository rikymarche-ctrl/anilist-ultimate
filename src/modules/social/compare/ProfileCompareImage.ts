/**
 * @file ProfileCompareImage.ts
 * @description 1080 × 1920 share card of a profile comparison.
 * Drawn locally with no covers or avatars, so the export never depends on the image CDN.
 */

import { LIQUID_PALETTES } from '@modules/astra/ui/wrapped/LiquidBackground';
import {
  STORY_INNER as INNER,
  STORY_MARGIN as M,
  STORY_WIDTH as W,
  StoryCanvas,
  seedFrom,
} from '@modules/astra/ui/wrapped/WrappedCanvas';
import { formatNumber } from '@modules/astra/ui/wrapped/WrappedFormat';
import type { CompareReport } from './ProfileCompareModel';

const POSTER_HEIGHT = 1000;
const NAME_SIZE = 190;
const FIGHT_ROWS = 3;
const GENRE_ROWS = 4;
const SCORE_COLUMN = 170;

const score = (value: number): string => formatNumber(value, value % 1 ? 1 : 0);

function drawPoster(story: StoryCanvas, report: CompareReport): void {
  story.text('ASTRA COMPARE', M, 128, { size: 22, weight: 800, tracking: 7 });
  story.muted(report.media === 'ANIME' ? 'Anime lists' : 'Manga lists', W - M, 128, 22, 'right');
  // Shared with people who were not there: names, never "You".
  const size = Math.min(
    story.fitSize(report.viewer.name, INNER + 20, NAME_SIZE, 900),
    story.fitSize(report.other.name, INNER + 20, NAME_SIZE, 900)
  );
  const first = 170 + size * 0.76;
  story.liquid(report.viewer.name, M - 8, first, { size, weight: 900, tracking: -size * 0.04 });
  story.text('×', M, first + 76, { size: 64, weight: 800, color: 'rgba(255, 255, 255, 0.72)' });
  story.liquid(report.other.name, M - 8, first + 96 + size * 0.76, {
    size,
    weight: 900,
    tracking: -size * 0.04,
  });
  story.text(report.verdict, M, 700, { size: 60, weight: 900, maxWidth: INNER });
  const figures: Array<[string, string]> = [
    [formatNumber(report.shared), 'shared titles'],
    report.affinity
      ? [`${report.affinity.percent}%`, 'score affinity']
      : [`${report.overlap}%`, 'list overlap'],
    [report.genres ? `${report.genres.overlap}%` : '—', 'genre overlap'],
  ];
  const column = INNER / figures.length;
  figures.forEach(([value, label], index) => {
    const x = M + index * column;
    const numberSize = story.fitSize(value, column - 30, 120, 900);
    story.liquid(value, x - 4, 760 + numberSize * 0.76, { size: numberSize, weight: 900 });
    story.text(label.toUpperCase(), x, 900, {
      size: 17,
      weight: 800,
      color: 'rgba(255, 255, 255, 0.78)',
      tracking: 4,
      maxWidth: column - 30,
    });
  });
}

function drawFights(story: StoryCanvas, report: CompareReport): void {
  const y = 1020;
  story.glass(M, y, INNER, 350);
  story.label('Biggest disagreements', M + 44, y + 58);
  if (!report.fights.length) {
    story.muted('No score fights yet.', M + 44, y + 130, 28);
    return;
  }
  story.muted(
    `${report.viewer.name} vs ${report.other.name}`,
    W - M - 44,
    y + 58,
    20,
    'right',
    INNER / 2
  );
  report.fights.slice(0, FIGHT_ROWS).forEach((title, index) => {
    const row = y + 130 + index * 76;
    story.text(title.title, M + 44, row, {
      size: 32,
      weight: 800,
      maxWidth: INNER - 88 - SCORE_COLUMN,
    });
    story.text(`${score(title.viewerScore)} – ${score(title.otherScore)}`, W - M - 44, row, {
      size: 34,
      weight: 900,
      align: 'right',
    });
  });
}

function drawGenres(story: StoryCanvas, report: CompareReport): void {
  const y = 1400;
  story.glass(M, y, INNER, 390);
  story.label('Taste by genre', M + 44, y + 58);
  story.muted('Share of each list', W - M - 44, y + 58, 20, 'right', INNER / 2);
  (report.genres?.rows ?? []).slice(0, GENRE_ROWS).forEach((row, index) => {
    const line = y + 130 + index * 70;
    story.text(row.genre, M + 44, line, { size: 32, weight: 800, maxWidth: INNER / 2 });
    story.text(
      `${Math.round(row.viewerShare * 100)}% / ${Math.round(row.otherShare * 100)}%`,
      W - M - 44,
      line,
      { size: 32, weight: 900, align: 'right' }
    );
  });
}

export function drawCompareImage(report: CompareReport): HTMLCanvasElement {
  const story = new StoryCanvas(
    LIQUID_PALETTES.nebula,
    seedFrom(`${report.viewer.id}:${report.other.id}`),
    { palette: LIQUID_PALETTES.vividNebula, height: POSTER_HEIGHT }
  );
  drawPoster(story, report);
  drawFights(story, report);
  drawGenres(story, report);
  story.text('AniList Ultimate', W - M, 1860, {
    size: 19,
    weight: 700,
    color: 'rgba(255, 255, 255, 0.85)',
    align: 'right',
  });
  return story.canvas;
}
