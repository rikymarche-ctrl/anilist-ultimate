/**
 * @file WrappedCanvas.ts
 * @description 2D drawing kit for the 1080 × 1920 Wrapped story PNGs.
 * Liquid backdrop rendered locally with page fonts. Pictures are optional: callers pass
 * images already loaded with CORS (AniList's CDN allows it), and any missing one becomes
 * a typographic tile. No journal text is ever drawn.
 */

import { paintLiquid, type LiquidPalette } from './LiquidBackground';

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
export const STORY_MARGIN = 80;
export const STORY_INNER = STORY_WIDTH - 2 * STORY_MARGIN;

const FONT_STACK = '"Overpass", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const MUTED = 'rgba(255, 255, 255, 0.68)';
const FAINT = 'rgba(255, 255, 255, 0.16)';

export interface TextStyle {
  size: number;
  color?: string | CanvasGradient;
  weight?: number;
  align?: CanvasTextAlign;
  maxWidth?: number;
  tracking?: number;
}

export interface RadarItem {
  label: string;
  value: number;
}
export interface BarItem {
  label: string;
  primary: number;
  secondary: number;
}

/** Stable 0–199 seed so the same period always exports the same liquid pattern. */
export function seedFrom(text: string): number {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 200;
}

type TrackedContext = CanvasRenderingContext2D & { letterSpacing?: string };

/** Black "poster" band at the top of the card whose typography is filled with vivid liquid. */
export interface PosterBand {
  readonly palette: LiquidPalette;
  readonly height: number;
}

const POSTER_FADE = 220;

export class StoryCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: TrackedContext;
  private readonly fillSource: HTMLCanvasElement | null = null;

  constructor(
    readonly palette: LiquidPalette,
    seed: number,
    poster?: PosterBand
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = STORY_WIDTH;
    this.canvas.height = STORY_HEIGHT;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Image export is unavailable in this browser.');
    this.ctx = ctx;
    paintLiquid(ctx, STORY_WIDTH, STORY_HEIGHT, palette, seed);
    this.veil();
    if (!poster) return;
    const ink = ctx.createLinearGradient(0, poster.height - POSTER_FADE, 0, poster.height);
    ink.addColorStop(0, '#050409');
    ink.addColorStop(1, 'rgba(5, 4, 9, 0)');
    ctx.fillStyle = '#050409';
    ctx.fillRect(0, 0, STORY_WIDTH, poster.height - POSTER_FADE);
    ctx.fillStyle = ink;
    ctx.fillRect(0, poster.height - POSTER_FADE, STORY_WIDTH, POSTER_FADE);
    this.fillSource = document.createElement('canvas');
    this.fillSource.width = STORY_WIDTH;
    this.fillSource.height = poster.height;
    const fill = this.fillSource.getContext('2d');
    if (fill) paintLiquid(fill, STORY_WIDTH, poster.height, poster.palette, seed + 7);
    else this.fillSource = null;
  }

  /** Darkens the liquid enough for white text everywhere, more at the top and bottom. */
  private veil(): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(5, 4, 14, 0.3)';
    ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
    const bottom = ctx.createLinearGradient(0, STORY_HEIGHT - 560, 0, STORY_HEIGHT);
    bottom.addColorStop(0, 'rgba(5, 4, 14, 0)');
    bottom.addColorStop(1, 'rgba(5, 4, 14, 0.62)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, STORY_HEIGHT - 560, STORY_WIDTH, 560);
  }

  /**
   * Text filled with the poster's vivid liquid (white without a poster band). The glyphs are
   * drawn on a scratch layer, then the liquid is composited "source-in" so it shows only inside them.
   */
  liquid(value: string, x: number, y: number, style: TextStyle): void {
    if (!this.fillSource) {
      this.text(value, x, y, style);
      return;
    }
    const { ctx } = this;
    ctx.font = this.font(style.size, style.weight ?? 900);
    const text = style.maxWidth ? this.fit(value, style.maxWidth) : value;
    const metrics = ctx.measureText(text);
    const pad = Math.ceil(style.size * 0.12);
    const width = Math.ceil(metrics.width) + pad * 2;
    const height = Math.ceil(style.size * 1.3) + pad * 2;
    const align = style.align ?? 'left';
    const left = Math.round(
      align === 'right'
        ? x - metrics.width - pad
        : align === 'center'
          ? x - metrics.width / 2 - pad
          : x - pad
    );
    const top = Math.round(y - style.size - pad);
    const layer = document.createElement('canvas');
    layer.width = Math.max(1, width);
    layer.height = Math.max(1, height);
    const scratch = layer.getContext('2d') as TrackedContext | null;
    if (!scratch) {
      this.text(value, x, y, style);
      return;
    }
    scratch.font = ctx.font;
    scratch.letterSpacing = `${style.tracking ?? 0}px`;
    scratch.fillStyle = '#ffffff';
    scratch.fillText(text, pad, y - top);
    scratch.globalCompositeOperation = 'source-in';
    scratch.drawImage(this.fillSource, -left, -top);
    ctx.drawImage(layer, left, top);
  }

  font(size: number, weight = 500): string {
    return `${weight} ${size}px ${FONT_STACK}`;
  }

  /** Truncates with an ellipsis using the current font. */
  fit(value: string, maxWidth: number): string {
    const chars = [...value.replace(/[\r\n\t]/g, ' ')];
    if (this.ctx.measureText(chars.join('')).width <= maxWidth) return chars.join('');
    while (chars.length && this.ctx.measureText(`${chars.join('')}…`).width > maxWidth) chars.pop();
    return `${chars.join('')}…`;
  }

  /** Largest size (down to 40%) at which `value` fits in one line. */
  fitSize(value: string, maxWidth: number, size: number, weight: number): number {
    let current = size;
    this.ctx.font = this.font(current, weight);
    while (current > size * 0.4 && this.ctx.measureText(value).width > maxWidth) {
      current -= 4;
      this.ctx.font = this.font(current, weight);
    }
    return current;
  }

  text(value: string, x: number, y: number, style: TextStyle): void {
    const { ctx } = this;
    ctx.font = this.font(style.size, style.weight ?? 500);
    ctx.fillStyle = style.color ?? '#ffffff';
    ctx.textAlign = style.align ?? 'left';
    ctx.letterSpacing = `${style.tracking ?? 0}px`;
    ctx.fillText(
      style.maxWidth ? this.fit(value, style.maxWidth) : value.replace(/[\r\n\t]/g, ' '),
      x,
      y
    );
    ctx.letterSpacing = '0px';
    ctx.textAlign = 'left';
  }

  /** Small uppercase section label in the palette accent. */
  label(value: string, x: number, y: number, align: CanvasTextAlign = 'left'): void {
    this.text(value.toUpperCase(), x, y, {
      size: 20,
      weight: 800,
      color: this.palette.accent,
      tracking: 5,
      align,
    });
  }

  muted(
    value: string,
    x: number,
    y: number,
    size = 20,
    align: CanvasTextAlign = 'left',
    maxWidth?: number
  ): void {
    this.text(value, x, y, { size, color: MUTED, align, maxWidth });
  }

  /** White → accent gradient across a horizontal span, for hero figures. */
  shine(x: number, width: number): CanvasGradient {
    const gradient = this.ctx.createLinearGradient(x, 0, x + width, 0);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, this.palette.accent);
    return gradient;
  }

  /** Hero text with a soft accent glow. */
  glow(value: string, x: number, y: number, style: TextStyle): void {
    const { ctx } = this;
    ctx.save();
    ctx.shadowColor = `${this.palette.colors[2]}cc`;
    ctx.shadowBlur = 60;
    this.text(value, x, y, style);
    ctx.restore();
  }

  outline(value: string, x: number, y: number, size: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = this.font(size, 900);
    ctx.strokeStyle = this.palette.accent;
    ctx.lineWidth = 3;
    ctx.strokeText(value, x, y);
    ctx.restore();
  }

  roundRect(x: number, y: number, width: number, height: number, radius: number): void {
    const { ctx } = this;
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  /**
   * Cover-fitted picture clipped to a rounded rectangle (a circle when radius ≥ half the size);
   * without an image, a palette gradient with the label's initial.
   */
  picture(image: CanvasImageSource | null, x: number, y: number, width: number, height: number, radius: number, label: string): void {
    const { ctx } = this;
    ctx.save();
    this.roundRect(x, y, width, height, radius);
    ctx.clip();
    if (image && image instanceof HTMLImageElement && image.naturalWidth && image.naturalHeight) {
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      // Faces sit in the upper part of covers and portraits.
      ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) * 0.2, drawWidth, drawHeight);
    } else {
      const fill = ctx.createLinearGradient(x, y, x + width, y + height);
      fill.addColorStop(0, this.palette.colors[1]);
      fill.addColorStop(1, this.palette.colors[2]);
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, width, height);
      this.text([...label.trim()][0]?.toUpperCase() ?? '★', x + width / 2, y + height / 2 + Math.min(width, height) * 0.16, {
        size: Math.round(Math.min(width, height) * 0.42), weight: 900, align: 'center', color: 'rgba(255, 255, 255, 0.9)',
      });
    }
    ctx.restore();
    ctx.save();
    this.roundRect(x, y, width, height, radius);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  /** Frosted card: translucent fill, top sheen and hairline border. */
  glass(x: number, y: number, width: number, height: number, radius = 30): void {
    const { ctx } = this;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 14;
    this.roundRect(x, y, width, height, radius);
    ctx.fillStyle = 'rgba(12, 10, 28, 0.42)';
    ctx.fill();
    ctx.restore();
    ctx.save();
    this.roundRect(x, y, width, height, radius);
    const sheen = ctx.createLinearGradient(0, y, 0, y + height);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0.03)');
    ctx.fillStyle = sheen;
    ctx.fill();
    ctx.strokeStyle = FAINT;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  line(x1: number, y1: number, x2: number, y2: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  pill(value: string, x: number, y: number): number {
    const { ctx } = this;
    ctx.font = this.font(22, 600);
    const width = ctx.measureText(value).width + 40;
    this.roundRect(x, y, width, 46, 23);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fill();
    ctx.strokeStyle = FAINT;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    this.text(value, x + 20, y + 31, { size: 22, weight: 600 });
    return width;
  }

  /** Genre radar after the original Wrapped renderer: rings, axes, filled shape and labels. */
  radar(cx: number, cy: number, radius: number, items: readonly RadarItem[]): void {
    const { ctx } = this;
    const data = items.slice(0, 6);
    const max = Math.max(1, ...data.map((item) => item.value));
    const point = (index: number, r: number): [number, number] => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / data.length;
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
    };
    const path = (r: (index: number) => number) => {
      ctx.beginPath();
      data.forEach((_, index) => {
        const [x, y] = point(index, r(index));
        if (index) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
    };
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.2;
    for (let ring = 1; ring <= 4; ring++) {
      path(() => (radius * ring) / 4);
      ctx.stroke();
    }
    data.forEach((_, index) => {
      const [x, y] = point(index, radius);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.stroke();
    });
    path((index) => Math.max(0.08, data[index].value / max) * radius);
    const fill = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    fill.addColorStop(0, `${this.palette.accent}66`);
    fill.addColorStop(1, `${this.palette.accent2}55`);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = this.palette.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
    data.forEach((item, index) => {
      const [x, y] = point(index, radius + 30);
      const cos = Math.cos(-Math.PI / 2 + (2 * Math.PI * index) / data.length);
      const align: CanvasTextAlign = Math.abs(cos) < 0.2 ? 'center' : cos > 0 ? 'left' : 'right';
      this.text(item.label, x, y, { size: 18, weight: 700, align, maxWidth: 150 });
      this.text(String(item.value), x, y + 22, { size: 16, color: MUTED, align });
    });
  }

  /** Stacked columns (primary on top of secondary) with a highlighted peak. */
  bars(x: number, y: number, width: number, height: number, items: readonly BarItem[]): void {
    const { ctx } = this;
    const max = Math.max(1, ...items.map((item) => item.primary + item.secondary));
    const slot = width / Math.max(1, items.length);
    const barWidth = Math.max(6, Math.min(34, slot * 0.6));
    const peak = items.reduce(
      (best, item, index) =>
        item.primary + item.secondary > items[best].primary + items[best].secondary ? index : best,
      0
    );
    items.forEach((item, index) => {
      const left = x + index * slot + (slot - barWidth) / 2;
      let base = y + height;
      for (const [value, color] of [
        [item.secondary, this.palette.accent2],
        [item.primary, this.palette.accent],
      ] as const) {
        if (!value) continue;
        const size = Math.max(4, (height * value) / max);
        this.roundRect(left, base - size, barWidth, size, Math.min(8, barWidth / 2));
        ctx.fillStyle = color;
        ctx.globalAlpha = index === peak ? 1 : 0.72;
        ctx.fill();
        ctx.globalAlpha = 1;
        base -= size;
      }
      if (!item.primary && !item.secondary) {
        this.roundRect(left, y + height - 4, barWidth, 4, 2);
        ctx.fillStyle = FAINT;
        ctx.fill();
      }
      if (items.length <= 12 || index % Math.ceil(items.length / 12) === 0) {
        this.text(item.label, left + barWidth / 2, y + height + 30, {
          size: 15,
          color: MUTED,
          align: 'center',
        });
      }
    });
  }
}
