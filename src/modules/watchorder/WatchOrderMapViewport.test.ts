import { describe, expect, it } from 'vitest';
import {
  clampViewBox,
  containViewBox,
  fitViewBox,
  frameViewBox,
  neighbourhood,
  zoomViewBox,
  type ViewBox,
} from './WatchOrderMapViewport';

const content = { width: 1000, height: 800 };

describe('fitViewBox', () => {
  it('fills the viewport width and starts at the top of a tall map', () => {
    expect(fitViewBox(content, 500, 240)).toEqual({ x: 0, y: 0, w: 1000, h: 480 });
  });
  it('centres a short map vertically', () => {
    expect(fitViewBox(content, 500, 600)).toEqual({ x: 0, y: -200, w: 1000, h: 1200 });
  });
  it('falls back to the whole content before the element has a size', () => {
    expect(fitViewBox(content, 0, 0)).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });
});

describe('containViewBox', () => {
  it('shows the whole map, centred, when it is taller than the viewport', () => {
    // 1000x800 into a 500x240 viewport: the height decides the scale.
    const box = containViewBox(content, 500, 240);
    expect(box.h).toBeCloseTo(800);
    expect(box.w).toBeCloseTo(1666.67, 1);
    expect(box.x).toBeCloseTo(-333.33, 1);
    expect(box.y).toBe(0);
  });
  it('shows the whole map when it is wider than the viewport', () => {
    expect(containViewBox(content, 500, 600)).toEqual({ x: 0, y: -200, w: 1000, h: 1200 });
  });
});

describe('zoomViewBox', () => {
  const fitted: ViewBox = { x: 0, y: 0, w: 1000, h: 480 };
  it('keeps the point under the cursor fixed', () => {
    const next = zoomViewBox(fitted, 2, 0.5, 0.5, fitted, content);
    expect(next.w).toBe(500);
    expect(next.x + 0.5 * next.w).toBeCloseTo(500);
    expect(next.y + 0.5 * next.h).toBeCloseTo(240);
  });
  it('limits magnification and zooming out', () => {
    expect(zoomViewBox(fitted, 100, 0.5, 0.5, fitted, content).w).toBe(250);
    expect(zoomViewBox(fitted, 0.001, 0.5, 0.5, fitted, content).w).toBe(1250);
  });
});

describe('clampViewBox', () => {
  it('never lets the content leave the viewport entirely', () => {
    const box = clampViewBox({ x: 9999, y: -9999, w: 400, h: 200 }, content);
    expect(box.x).toBe(800);
    expect(box.y).toBe(-100);
  });
});

describe('neighbourhood', () => {
  const edges = [
    { from: 1, to: 2 },
    { from: 2, to: 3 },
    { from: 4, to: 5 },
  ];
  it('returns the title, its neighbours and the edges between them', () => {
    const near = neighbourhood(edges, 2);
    expect([...near.nodes].sort()).toEqual([1, 2, 3]);
    expect([...near.edges].sort()).toEqual([0, 1]);
  });
  it('is just the title when it has no relations', () => {
    expect(neighbourhood(edges, 9).nodes).toEqual(new Set([9]));
  });
});

describe('frameViewBox', () => {
  it('shows a small map at 1:1, centred, instead of magnifying it', () => {
    expect(frameViewBox({ width: 400, height: 200 }, 800, 400, 0, 0)).toEqual({
      x: -200,
      y: -100,
      w: 800,
      h: 400,
    });
  });
  it('fits the whole map when it still reads well slightly shrunk', () => {
    expect(frameViewBox({ width: 1000, height: 400 }, 800, 400, 0, 0).w).toBeCloseTo(1000);
  });
  it('frames the current title at 1:1 when the whole map would be too small to read', () => {
    const box = frameViewBox({ width: 4000, height: 300 }, 800, 400, 2000, 150);
    expect(box).toMatchObject({ w: 800, h: 400, x: 1600, y: -50 });
  });
  it('never scrolls past the edge of the map when the current title is near it', () => {
    expect(frameViewBox({ width: 4000, height: 300 }, 800, 400, 100, 150).x).toBe(0);
    expect(frameViewBox({ width: 4000, height: 300 }, 800, 400, 3990, 150).x).toBe(3200);
  });
});
