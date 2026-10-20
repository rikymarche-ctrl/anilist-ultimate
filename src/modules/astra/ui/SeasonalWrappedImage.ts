import { seasonKey, seasonLabel, type SeasonalReport } from '../services/SeasonalWrappedModel';
import { SEASON_PALETTES } from './wrapped/SeasonalWrappedSlides';
import {
  STORY_INNER as INNER,
  STORY_MARGIN as M,
  STORY_WIDTH as W,
  StoryCanvas,
  seedFrom,
} from './wrapped/WrappedCanvas';
import { formatNumber, plural } from './wrapped/WrappedFormat';

const GAP = 20;
const TOP_ROWS = 5;
const POSTER_HEIGHT = 1000;

/** 1080 × 1920 story card. Local canvas export deliberately excludes covers, remote fonts and personal notes. */
export function drawSeasonalImage(report: SeasonalReport): HTMLCanvasElement {
  const palettes = SEASON_PALETTES[report.period.season];
  const story = new StoryCanvas(palettes.deep, seedFrom(seasonKey(report.period)), {
    palette: palettes.vivid,
    height: POSTER_HEIGHT,
  });
  drawPoster(story, report);
  drawRanking(story, report);
  drawAwards(story, report);
  drawGenres(story, report);
  story.muted(
    `${report.continuing.length} continuing · ${report.uncertain.length} awaiting confirmation · backlog titles excluded`,
    M,
    1822,
    20,
    'left',
    INNER
  );
  story.muted(
    'Continuing titles have no final rating here. Current personal scores: Astra first, AniList when unrated.',
    M,
    1854,
    17,
    'left',
    INNER
  );
  story.muted(`Generated ${new Date().toLocaleDateString('en-GB')}`, M, 1886, 17);
  story.text('AniList Ultimate · Astra', W - M, 1886, {
    size: 19,
    weight: 700,
    color: 'rgba(255, 255, 255, 0.85)',
    align: 'right',
  });
  return story.canvas;
}

/** Black top band: season name filled with liquid, year outlined, three hero figures. */
function drawPoster(story: StoryCanvas, report: SeasonalReport): void {
  const [season, year] = seasonLabel(report.period).split(' ');
  story.text('SEASONAL WRAPPED', M, 128, { size: 22, weight: 800, tracking: 7 });
  story.muted(
    report.provisional ? 'Season in progress' : 'Season concluded',
    W - M,
    128,
    22,
    'right'
  );
  const size = Math.min(
    story.fitSize(season, INNER + 20, 290, 900),
    story.fitSize(year, INNER + 20, 290, 900)
  );
  const seasonBaseline = 160 + size * 0.76;
  story.liquid(season, M - 10, seasonBaseline, { size, weight: 900, tracking: -size * 0.04 });
  story.outline(year, M - 6, seasonBaseline + size * 0.86, size);
  const leadBaseline = seasonBaseline + size * 0.86 + 74;
  story.text(
    report.provisional ? 'The season so far.' : 'Your season, in perspective.',
    M,
    leadBaseline,
    { size: 40, weight: 700 }
  );
  const figures: Array<[string, string]> = [
    [
      formatNumber(report.concluded.length),
      report.concluded.length === 1 ? 'story ended' : 'stories ended',
    ],
    [formatNumber(report.completed), 'completed by you'],
    [report.average === null ? '—' : report.average.toFixed(2), 'average score'],
  ];
  const column = INNER / 3;
  const top = Math.max(leadBaseline + 50, 690);
  figures.forEach(([value, label], index) => {
    const x = M + index * column;
    const numberSize = story.fitSize(value, column - 30, 130, 900);
    story.liquid(value, x - 4, top + numberSize * 0.76, {
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

function drawRanking(story: StoryCanvas, report: SeasonalReport): void {
  const y = 1010;
  story.glass(M, y, INNER, 400);
  story.label('Your top rated', M + 44, y + 58);
  if (!report.ranking.length) story.muted('No completed, rated titles yet.', M + 44, y + 130, 28);
  report.ranking.slice(0, TOP_ROWS).forEach((title, index) => {
    const rowY = y + 120 + index * 60;
    if (index) story.line(M + 44, rowY - 38, M + INNER - 44, rowY - 38);
    story.text(String(title.rank).padStart(2, '0'), M + 44, rowY, {
      size: 30,
      weight: 900,
      color: story.shine(M + 44, 60),
    });
    story.text(title.title, M + 116, rowY - 4, { size: 26, weight: 700, maxWidth: INNER - 310 });
    story.muted(
      `${title.scoreSource}${title.leftover && title.origin ? ` · Leftover from ${seasonLabel(title.origin)}` : ''}`,
      M + 116,
      rowY + 18,
      15,
      'left',
      INNER - 310
    );
    story.text(title.currentScore!.toFixed(2), M + INNER - 44, rowY, {
      size: 28,
      weight: 900,
      color: story.palette.accent,
      align: 'right',
    });
  });
}

function drawAwards(story: StoryCanvas, report: SeasonalReport): void {
  const width = (INNER - GAP) / 2;
  report.awards.forEach((award, index) => {
    const x = M + (index % 2) * (width + GAP);
    const y = 1434 + Math.floor(index / 2) * 140;
    story.glass(x, y, width, 124, 26);
    story.label(award.label, x + 30, y + 48);
    if (award.title)
      story.text(award.title.title, x + 30, y + 94, {
        size: 27,
        weight: 800,
        maxWidth: width - 60,
      });
    else story.muted('Not selected', x + 30, y + 94, 25);
  });
}

function drawGenres(story: StoryCanvas, report: SeasonalReport): void {
  let x = M;
  for (const genre of report.genres.slice(0, 5)) {
    const label = `${genre.name} · ${formatNumber(genre.count)} ${plural(genre.count, 'title')}`;
    story.ctx.font = story.font(22, 600);
    if (x + story.ctx.measureText(label).width + 40 > M + INNER) break;
    x += story.pill(label, x, 1724) + 12;
  }
}
