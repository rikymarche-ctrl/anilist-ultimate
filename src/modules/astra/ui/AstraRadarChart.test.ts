import { describe, it, expect } from 'vitest';
import { AstraRadarChart } from './AstraRadarChart';
import type { AstraSection } from '../AstraInterfaces';

const sections = (count: number): AstraSection[] =>
  Array.from({ length: count }, (_, i) => ({ id: `s${i}`, name: `Section ${i}`, weight: 1 }));

describe('AstraRadarChart visibility', () => {
  it('is hidden with fewer than three active sections', () => {
    expect(AstraRadarChart.isVisible(sections(2))).toBe(false);
    expect(AstraRadarChart.getHTML({}, sections(2))).toBe('');
  });

  it('does not count skipped sections towards the three', () => {
    expect(AstraRadarChart.isVisible(sections(3), ['s0'])).toBe(false);
    expect(AstraRadarChart.isVisible(sections(4), ['s0'])).toBe(true);
  });

  it('is hidden with no sections at all', () => {
    expect(AstraRadarChart.isVisible([])).toBe(false);
    expect(AstraRadarChart.getHTML({}, [])).toBe('');
  });
});

describe('AstraRadarChart rendering', () => {
  it('shows an empty state instead of the web while no section has a score', () => {
    const html = AstraRadarChart.getHTML({ s0: null, s1: 0 }, sections(3));
    expect(html).toContain('Rate the sections to draw the chart');
    expect(html).not.toContain('astra-radar-svg');
  });

  it('draws the score polygon in the accent colour with vertex dots for rated sections', () => {
    const html = AstraRadarChart.getHTML({ s0: 8, s1: 6, s2: null }, sections(3));
    expect(html).toContain('astra-radar-svg');
    expect(html).toMatch(
      /<polygon points="[^"]+" fill="var\(--astra-accent\)" fill-opacity="0\.25" stroke="var\(--astra-accent\)" stroke-width="2"/
    );
    expect(html.match(/<circle /g)).toHaveLength(2);
  });

  it('shows each rated section score to one decimal and a dash for an unrated one', () => {
    const html = AstraRadarChart.getHTML({ s0: 8, s1: 6.25, s2: null }, sections(3));
    expect(html).toContain('8.0');
    expect(html).toContain('6.3');
    expect(html).toContain('—');
  });

  it('keeps the public score colour helper', () => {
    expect(AstraRadarChart.getScoreColor(null)).toBe('var(--astra-muted)');
    expect(AstraRadarChart.getScoreColor(10)).toBe('hsl(120, 80%, 60%)');
  });
});
