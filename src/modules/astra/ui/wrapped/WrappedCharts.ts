/**
 * @file WrappedCharts.ts
 * @description DOM/SVG charts for the Wrapped stories: genre radar, monthly bars and daily heatmap.
 * Text is always assigned through textContent; sizes go through CSS custom properties (CSSOM).
 */

import { formatDay, formatNumber, parseLocalDate } from './WrappedFormat';
import { localDateKey } from '../../services/AstraWrapped';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RADAR_WIDTH = 440;
const RADAR_HEIGHT = 340;
const RADAR_RADIUS = 112;
const RADAR_MAX_AXES = 6;
const HEATMAP_MAX_DAYS = 371;

export interface ChartDatum {
  label: string;
  value: number;
}
export interface BarDatum {
  label: string;
  title: string;
  primary: number;
  secondary: number;
}

function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

/** Radar of the strongest genres, relative to the top one. Needs at least three axes. */
export function genreRadar(data: readonly ChartDatum[], unit: string): SVGSVGElement | null {
  const items = data.slice(0, RADAR_MAX_AXES);
  if (items.length < 3) return null;
  const cx = RADAR_WIDTH / 2;
  const cy = RADAR_HEIGHT / 2;
  const max = Math.max(1, ...items.map((item) => item.value));
  const point = (index: number, radius: number): [number, number] => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / items.length;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  };
  const polygon = (radius: (index: number) => number) =>
    items
      .map((_, index) =>
        point(index, radius(index))
          .map((value) => value.toFixed(1))
          .join(',')
      )
      .join(' ');
  const root = svg('svg', {
    viewBox: `0 0 ${RADAR_WIDTH} ${RADAR_HEIGHT}`,
    class: 'aw-radar',
    role: 'img',
    'aria-label': `Genres: ${items.map((item) => `${item.label} ${item.value} ${unit}`).join(', ')}`,
  });
  for (let ring = 1; ring <= 4; ring++)
    root.append(
      svg('polygon', { class: 'aw-radar-ring', points: polygon(() => (RADAR_RADIUS * ring) / 4) })
    );
  items.forEach((_, index) => {
    const [x, y] = point(index, RADAR_RADIUS);
    root.append(
      svg('line', { class: 'aw-radar-axis', x1: cx, y1: cy, x2: x.toFixed(1), y2: y.toFixed(1) })
    );
  });
  const shape = svg('g', { class: 'aw-radar-shape' });
  shape.append(
    svg('polygon', {
      class: 'aw-radar-area',
      points: polygon((index) => Math.max(0.08, items[index].value / max) * RADAR_RADIUS),
    })
  );
  items.forEach((item, index) => {
    const [x, y] = point(index, Math.max(0.08, item.value / max) * RADAR_RADIUS);
    shape.append(
      svg('circle', { class: 'aw-radar-dot', cx: x.toFixed(1), cy: y.toFixed(1), r: 4.5 })
    );
  });
  root.append(shape);
  items.forEach((item, index) => {
    const [x, y] = point(index, RADAR_RADIUS + 26);
    const cos = Math.cos(-Math.PI / 2 + (2 * Math.PI * index) / items.length);
    const label = svg('text', {
      class: 'aw-radar-label',
      x: x.toFixed(1),
      y: (y - 4).toFixed(1),
      'text-anchor': Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end',
    });
    label.textContent = item.label;
    const value = svg('tspan', { class: 'aw-radar-value', x: x.toFixed(1), dy: 18 });
    value.textContent = formatNumber(item.value);
    label.append(value);
    root.append(label);
  });
  return root;
}

/** Stacked monthly columns; heights are percentages of the busiest bucket. */
export function monthBars(data: readonly BarDatum[], peakIndex: number): HTMLElement {
  const chart = document.createElement('div');
  // Dense charts label every other column.
  chart.className = data.length > 12 ? 'aw-bars aw-bars--dense' : 'aw-bars';
  chart.style.setProperty('--cols', String(Math.max(1, data.length)));
  const max = Math.max(1, ...data.map((item) => item.primary + item.secondary));
  data.forEach((item, index) => {
    const column = document.createElement('div');
    column.className = `aw-bar-col${index === peakIndex ? ' is-peak' : ''}`;
    column.title = item.title;
    column.style.setProperty('--i', String(index));
    const track = document.createElement('div');
    track.className = 'aw-bar-track';
    for (const [value, kind] of [
      [item.secondary, 'secondary'],
      [item.primary, 'primary'],
    ] as const) {
      if (!value) continue;
      const bar = document.createElement('i');
      bar.className = `aw-bar aw-bar--${kind}`;
      bar.style.setProperty('--h', `${(100 * value) / max}%`);
      track.append(bar);
    }
    const label = document.createElement('span');
    label.className = 'aw-bar-label';
    label.textContent = item.label;
    column.append(track, label);
    chart.append(column);
  });
  return chart;
}

/** Monday-first activity grid for periods up to roughly a year; null for longer ranges. */
export function activityHeatmap(
  start: string,
  end: string,
  days: ReadonlyMap<string, number>,
  unitLabel: string
): HTMLElement | null {
  const first = parseLocalDate(start);
  const last = parseLocalDate(end);
  const total = Math.round((last.getTime() - first.getTime()) / 86400000) + 1;
  if (total < 1 || total > HEATMAP_MAX_DAYS) return null;
  const offset = (first.getDay() + 6) % 7;
  const grid = document.createElement('div');
  grid.className = 'aw-heat';
  grid.style.setProperty('--weeks', String(Math.ceil((offset + total) / 7)));
  grid.setAttribute('role', 'img');
  grid.setAttribute(
    'aria-label',
    `${days.size} active ${days.size === 1 ? 'day' : 'days'} from ${formatDay(start)} to ${formatDay(end)}`
  );
  for (let index = 0; index < offset; index++) {
    const blank = document.createElement('i');
    blank.className = 'aw-heat-cell is-blank';
    grid.append(blank);
  }
  const max = Math.max(1, ...days.values());
  const cursor = new Date(first);
  for (let index = 0; index < total; index++) {
    const key = localDateKey(cursor);
    const units = days.get(key) ?? 0;
    const cell = document.createElement('i');
    cell.className = `aw-heat-cell l${units ? Math.max(1, Math.ceil((4 * units) / max)) : 0}`;
    cell.title = `${formatDay(key)} · ${units} ${unitLabel}`;
    grid.append(cell);
    cursor.setDate(cursor.getDate() + 1);
  }
  return grid;
}
