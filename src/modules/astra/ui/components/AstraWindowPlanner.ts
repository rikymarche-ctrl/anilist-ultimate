import type { AstraWorkSummary } from '../../AstraInterfaces';

export type AstraWindowGroup = { status: string; collapsed: boolean; works: AstraWorkSummary[] };
export type AstraWindowBand = { status: string; header: boolean; works: AstraWorkSummary[]; top: number; height: number };

/** Pixel positions retain every logical work while the view mounts only nearby bands. */
export class AstraWindowPlanner {
  public readonly bands: AstraWindowBand[] = [];
  public readonly mediaBands = new Map<number, number>();
  public readonly totalHeight: number;

  constructor(groups: AstraWindowGroup[], columns: number, rowHeight: number, heights: Map<string, number>) {
    let top = 0;
    for (const group of groups) {
      const headerHeight = heights.get(`header:${group.status}:${group.collapsed}`) ?? 56;
      this.bands.push({ status: group.status, header: true, works: [], top, height: headerHeight });
      top += headerHeight;
      if (group.collapsed) continue;
      for (let start = 0; start < group.works.length; start += columns) {
        const works = group.works.slice(start, start + columns);
        const height = Math.max(...works.map(work => heights.get(`work:${work.mediaId}`) ?? rowHeight));
        for (const work of works) this.mediaBands.set(work.mediaId, this.bands.length);
        this.bands.push({ status: group.status, header: false, works, top, height });
        top += height;
      }
    }
    this.totalHeight = top;
  }

  public bandAt(position: number): number {
    let low = 0; let high = this.bands.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const band = this.bands[middle];
      if (band.top + band.height <= position) low = middle + 1; else high = middle;
    }
    return Math.min(low, Math.max(0, this.bands.length - 1));
  }

  public range(top: number, viewport: number, overscan = 400): { start: number; end: number } {
    return { start: this.bandAt(Math.max(0, top - overscan)), end: Math.min(this.bands.length, this.bandAt(top + viewport + overscan) + 1) };
  }
}
