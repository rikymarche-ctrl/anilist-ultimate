import { describe, expect, it } from 'vitest';
import { activityHeatmap, genreRadar, monthBars } from './WrappedCharts';
import { formatRange, monthLabel, periodNoun, periodTitle, plural } from './WrappedFormat';
import { seedFrom } from './WrappedCanvas';

describe('Wrapped wording', () => {
  it('names years, months and custom ranges', () => {
    expect(periodTitle('2026-01-01', '2026-10-19', '2026-10-19')).toBe('2026');
    expect(periodTitle('2026-01-01', '2026-12-31')).toBe('2026');
    expect(periodTitle('2026-01-01', '2026-01-31')).toBe('January 2026');
    expect(periodTitle('2026-01-01', '2026-03-31')).toBe('1 Jan – 31 Mar 2026');
    expect(periodTitle('2026-01-01', '2026-10-19', '2026-10-20')).toBe('1 Jan – 19 Oct 2026');
    expect(periodTitle('2026-10-01', '2026-10-19')).toBe('October 2026');
    expect(periodTitle('2026-03-02', '2026-10-19')).toBe('2 Mar – 19 Oct 2026');
    expect(periodTitle('2025-12-01', '2026-01-31')).toBe('1 Dec 2025 – 31 Jan 2026');
    expect(periodNoun('2026-01-01', '2026-12-31')).toBe('year');
    expect(periodNoun('2026-10-01', '2026-10-31')).toBe('month');
    expect(periodNoun('2026-03-02', '2026-10-19')).toBe('period');
    expect(formatRange('2026-01-01', '2026-10-19')).toBe('1 Jan – 19 Oct 2026');
    expect(monthLabel('2026-03', true)).toBe("Mar '26");
    expect(plural(1, 'story', 'stories')).toBe('story');
    expect(plural(2, 'episode')).toBe('episodes');
  });

  it('derives a stable export seed per period', () => {
    expect(seedFrom('2026-SPRING')).toBe(seedFrom('2026-SPRING'));
    expect(seedFrom('2026-SPRING')).not.toBe(seedFrom('2026-SUMMER'));
    expect(seedFrom('x')).toBeGreaterThanOrEqual(0);
    expect(seedFrom('x')).toBeLessThan(200);
  });
});

describe('Wrapped charts', () => {
  it('draws a radar only from three genres and keeps labels as text', () => {
    expect(
      genreRadar(
        [
          { label: 'Drama', value: 2 },
          { label: 'Fantasy', value: 1 },
        ],
        'titles'
      )
    ).toBeNull();
    const radar = genreRadar(
      ['<img src=x>', 'Fantasy', 'Drama', 'Comedy', 'Action', 'Romance', 'Ignored'].map(
        (label, index) => ({ label, value: 7 - index })
      ),
      'titles'
    )!;
    expect(radar.querySelectorAll('.aw-radar-label')).toHaveLength(6);
    expect(radar.querySelector('img')).toBeNull();
    expect(radar.querySelector('.aw-radar-label')!.textContent).toContain('<img src=x>');
    expect(radar.getAttribute('aria-label')).toContain('Fantasy 6 titles');
  });

  it('scales stacked bars to the busiest bucket and flags the peak', () => {
    const chart = monthBars(
      [
        { label: 'Jan', title: 'January', primary: 4, secondary: 0 },
        { label: 'Feb', title: 'February', primary: 2, secondary: 6 },
      ],
      1
    );
    const columns = chart.querySelectorAll<HTMLElement>('.aw-bar-col');
    expect(columns[1].classList.contains('is-peak')).toBe(true);
    expect(columns[0].querySelectorAll('.aw-bar')).toHaveLength(1);
    expect(
      columns[1].querySelector<HTMLElement>('.aw-bar--secondary')!.style.getPropertyValue('--h')
    ).toBe('75%');
    expect(chart.classList.contains('aw-bars--dense')).toBe(false);
    expect(
      monthBars(
        Array.from({ length: 13 }, (_, index) => ({
          label: String(index),
          title: '',
          primary: 1,
          secondary: 0,
        })),
        -1
      ).classList.contains('aw-bars--dense')
    ).toBe(true);
  });

  it('lays out a Monday-first heatmap and skips periods longer than a year', () => {
    // 2026-10-01 is a Thursday: three blank cells precede it.
    const grid = activityHeatmap(
      '2026-10-01',
      '2026-10-19',
      new Map([
        ['2026-10-03', 4],
        ['2026-10-04', 1],
      ]),
      'units'
    )!;
    expect(grid.querySelectorAll('.is-blank')).toHaveLength(3);
    expect(grid.querySelectorAll('.aw-heat-cell:not(.is-blank)')).toHaveLength(19);
    expect(grid.querySelectorAll('.l4')).toHaveLength(1);
    expect(grid.querySelectorAll('.l1')).toHaveLength(1);
    expect(grid.getAttribute('aria-label')).toContain('2 active days');
    expect(activityHeatmap('2024-01-01', '2026-01-01', new Map(), 'units')).toBeNull();
    expect(activityHeatmap('2026-02-01', '2026-01-01', new Map(), 'units')).toBeNull();
  });
});
