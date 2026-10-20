/**
 * @file AstraRadarChart.ts
 * @description SVG-based radar chart component for visual score representation
 *
 * Generates an inline SVG polygon radar chart from Astra section scores.
 * Stateless utility — all input via method parameters, no DOM state.
 *
 * The web needs at least three active sections. Without a rated section it is replaced by a
 * short empty state instead of an empty grid.
 *
 * @see AstraRatingModal.ts for per-work usage
 * @see docs/MODULES.md#5-astra-module-advanced-scoring
 */

import type { AstraSection } from '../AstraInterfaces';
import { escapeHtml } from '@core/utils/Template';

/** Fewest active sections that form a web. */
const MIN_SECTIONS = 3;

/** Sections taking part in the radar: skipped sections are left out. */
function activeSections(sections: AstraSection[], skip: string[]): AstraSection[] {
  const skipSet = new Set(skip);
  return sections.filter((s) => !skipSet.has(s.id));
}

/** A section counts as rated only with a positive score; 0 and null both mean unrated. */
function isRated(value: number | null | undefined): value is number {
  return typeof value === 'number' && value > 0;
}

export class AstraRadarChart {
  /**
   * Whether the radar belongs on screen: at least three active sections.
   * Callers hide the radar container when this is false.
   */
  public static isVisible(sections: AstraSection[], skip: string[] = []): boolean {
    return activeSections(sections, skip).length >= MIN_SECTIONS;
  }

  /**
   * Generates HTML for a radar chart with decoupled labels.
   * Returns '' when fewer than three sections are active, and an empty state when none is rated.
   */
  public static getHTML(
    scores: Record<string, number | null>,
    sections: AstraSection[],
    skip: string[] = [],
    size: number = 300,
    showLabels: boolean = true
  ): string {
    const enabled = activeSections(sections, skip);
    const n = enabled.length;

    if (n < MIN_SECTIONS) return '';
    if (!enabled.some((s) => isRated(scores[s.id]))) {
      return `<div class="astra-radar-empty">Rate the sections to draw the chart</div>`;
    }

    const cx = size / 2;
    const cy = size / 2;
    const r = (size / 2) * 0.85; // Large web!
    const angleAt = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;

    // Background rings, kept subtle so the score shape carries the reading
    const rings = [0.25, 0.5, 0.75, 1]
      .map((pct) => {
        const pts = enabled
          .map((_, i) => {
            const angle = angleAt(i);
            return `${cx + Math.cos(angle) * r * pct},${cy + Math.sin(angle) * r * pct}`;
          })
          .join(' ');
        return `<polygon points="${pts}" fill="none" stroke="var(--astra-border)" stroke-opacity="0.5" stroke-width="1" />`;
      })
      .join('');

    // Axis lines
    const axes = enabled
      .map((_, i) => {
        const angle = angleAt(i);
        return `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(angle) * r}" y2="${cy + Math.sin(angle) * r}" stroke="var(--astra-border)" stroke-opacity="0.6" stroke-width="0.5" />`;
      })
      .join('');

    // Score polygon: accent fill at about a quarter opacity, with a solid stroke and vertex dots
    const vertices = enabled.map((s, i) => {
      const angle = angleAt(i);
      const v = scores[s.id];
      const norm = isRated(v) ? v / 10 : 0;
      return {
        x: cx + Math.cos(angle) * r * norm,
        y: cy + Math.sin(angle) * r * norm,
        rated: isRated(v),
      };
    });
    const points = vertices.map((p) => `${p.x},${p.y}`).join(' ');
    const scorePolygon = `<polygon points="${points}" fill="var(--astra-accent)" fill-opacity="0.25" stroke="var(--astra-accent)" stroke-width="2" stroke-linejoin="round" />`;
    const dots = vertices
      .filter((p) => p.rated)
      .map((p) => `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="var(--astra-accent)" />`)
      .join('');

    // HTML Labels (Decoupled): name, then the section's score to one decimal
    let labelsHTML = '';
    if (showLabels) {
      labelsHTML = enabled
        .map((s, i) => {
          const angle = angleAt(i);
          const v = scores[s.id];
          const color = this.getScoreColor(v);

          // Position labels as percentage of container
          const lx = 50 + Math.cos(angle) * 42;
          const ly = 50 + Math.sin(angle) * 42;

          const transform = 'translate(-50%, -50%)';
          const formattedVal = isRated(v) ? v.toFixed(1) : '—';

          return `
          <div class="astra-radar-label-abs" style="left: ${lx}%; top: ${ly}%; transform: ${transform};">
            <div class="astra-radar-label-name">${escapeHtml(s.name)}</div>
            <div class="astra-radar-label-val" style="color: ${color}">
              ${formattedVal}
            </div>
          </div>
        `;
        })
        .join('');
    }

    return `
      <div class="astra-radar-wrapper" style="width: ${size}px; height: ${size}px;">
        <svg viewBox="0 0 ${size} ${size}" class="astra-radar-svg">
          ${rings}
          ${axes}
          ${scorePolygon}
          ${dots}
        </svg>
        <div class="astra-radar-labels-layer">
          ${labelsHTML}
        </div>
      </div>
    `;
  }

  public static getScoreColor(v: number | null): string {
    if (v == null || v === 0) return 'var(--astra-muted)';
    // 0.1 (Red) -> 10 (Green)
    const hue = (v / 10) * 120;
    return `hsl(${hue}, 80%, 60%)`;
  }
}
