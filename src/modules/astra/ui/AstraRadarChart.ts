import { AstraSection } from '../AstraService';

export class AstraRadarChart {
  /**
   * Generates HTML for a radar chart with decoupled labels
   */
  public static getHTML(
    scores: Record<string, number | null>,
    sections: AstraSection[],
    skip: string[] = [],
    size: number = 300,
    showLabels: boolean = true
  ): string {
    const skipSet = new Set(skip);
    const enabled = sections.filter(s => !skipSet.has(s.id));
    const n = enabled.length;

    if (n < 3) {
      return `<div class="astra-radar-error">Need at least 3 active sections</div>`;
    }

    const cx = size / 2;
    const cy = size / 2;
    const r = (size / 2) * 0.85; // Large web!

    // Background rings
    const rings = [0.25, 0.5, 0.75, 1].map(pct => {
      const pts = enabled.map((_, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        return `${cx + Math.cos(angle) * r * pct},${cy + Math.sin(angle) * r * pct}`;
      }).join(' ');
      return `<polygon points="${pts}" fill="none" stroke="var(--astra-border)" stroke-width="1" />`;
    }).join('');

    // Axis lines
    const axes = enabled.map((_, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(angle) * r}" y2="${cy + Math.sin(angle) * r}" stroke="var(--astra-border)" stroke-width="0.5" />`;
    }).join('');

    // Score polygon
    const points = enabled.map((s, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const v = scores[s.id];
      const norm = v == null ? 0 : v / 10;
      return `${cx + Math.cos(angle) * r * norm},${cy + Math.sin(angle) * r * norm}`;
    }).join(' ');

    const scorePolygon = `<polygon points="${points}" fill="var(--astra-accent-a20)" stroke="var(--astra-accent)" stroke-width="2.5" />`;

    // HTML Labels (Decoupled)
    let labelsHTML = '';
    if (showLabels) {
      labelsHTML = enabled.map((s, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const v = scores[s.id];
        const color = this.getScoreColor(v);

        // Position labels as percentage of container
        const lx = 50 + Math.cos(angle) * 42;
        const ly = 50 + Math.sin(angle) * 42;

        let transform = 'translate(-50%, -50%)';

        return `
          <div class="astra-radar-label-abs" style="left: ${lx}%; top: ${ly}%; transform: ${transform};">
            <div class="astra-radar-label-name">${s.name}</div>
            <div class="astra-radar-label-val" style="color: ${color}">
              ${v == null ? '—' : v.toFixed(1)}
            </div>
          </div>
        `;
      }).join('');
    }

    return `
      <div class="astra-radar-wrapper" style="width: ${size}px; height: ${size}px;">
        <svg viewBox="0 0 ${size} ${size}" class="astra-radar-svg">
          ${rings}
          ${axes}
          ${scorePolygon}
        </svg>
        <div class="astra-radar-labels-layer">
          ${labelsHTML}
        </div>
      </div>
    `;
  }

  public static getScoreColor(v: number | null): string {
    if (v == null) return 'var(--astra-muted)';
    if (v >= 9) return 'var(--astra-score-great)';
    if (v >= 7) return 'var(--astra-score-good)';
    if (v >= 5) return 'var(--astra-score-mid)';
    if (v >= 3) return 'var(--astra-score-meh)';
    return 'var(--astra-score-bad)';
  }
}
