/**
 * @file WrappedStory.ts
 * @description Story-style slide deck shared by Astra and Seasonal Wrapped.
 *
 * Owns progress segments, previous/next/play controls, keyboard navigation, count-up
 * figures and palette changes of the liquid backdrop. Every slide stays in the DOM
 * (inactive ones are inert/aria-hidden) so lists and form controls remain queryable.
 *
 * Slides are either "poster" (black page, liquid seen through white typography via
 * multiply blending) or "immersive" (liquid backdrop with glass panels). Autoplay is
 * opt-in from the intro, timed by the CSS fill of the active progress segment, and
 * stops on `hold` slides (forms, long lists) and on the last slide.
 */

import { html } from '@core/utils/Template';
import { parseWebUrl } from '@core/utils/WebUrl';
import {
  prefersReducedMotion,
  type LiquidBackground,
  type LiquidPalette,
} from './LiquidBackground';
import { formatNumber } from './WrappedFormat';

export type SlideMode = 'poster' | 'immersive';

export interface WrappedSlide {
  readonly label: string;
  readonly palette: LiquidPalette;
  readonly element: HTMLElement;
  /** Defaults to immersive. */
  readonly mode?: SlideMode;
  /** Autoplay stops here: the slide asks for reading or input. */
  readonly hold?: boolean;
  /** Called whenever the slide becomes active (lazy content such as the card preview). */
  readonly onEnter?: (element: HTMLElement) => void;
}

const COUNT_DURATION_MS = 1300;
/** Lets the summary transition settle before rendering the 1080 × 1920 preview. */
const PREVIEW_DELAY_MS = 450;
const FILL_ANIMATION = 'aw-fill';

export class WrappedStory {
  readonly element: HTMLElement;
  private index = -1;
  private readonly frames = new Set<number>();
  private readonly segments: HTMLButtonElement[] = [];
  private readonly reducedMotion = prefersReducedMotion();
  private playing = false;
  private readonly onClick = (event: Event): void => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLElement>(
      '[data-goto], [data-story-prev], [data-story-next], [data-story-restart], [data-story-toggle]'
    );
    if (!control || !this.element.contains(control) || (control as HTMLButtonElement).disabled)
      return;
    if (control.dataset.goto !== undefined) this.go(Number(control.dataset.goto));
    else if (control.hasAttribute('data-story-prev')) this.previous();
    else if (control.hasAttribute('data-story-next')) {
      this.next();
      if (control.hasAttribute('data-story-play')) this.play();
    } else if (control.hasAttribute('data-story-toggle')) {
      if (this.playing) this.pause();
      else this.play();
    } else this.go(0);
  };
  /** The active segment finished filling: advance (go() stops on hold/last slides). */
  private readonly onFill = (event: Event): void => {
    if ((event as AnimationEvent).animationName === FILL_ANIMATION && this.playing) this.next();
  };
  /** Using a form control inside a slide means reading/deciding: stop the clock. */
  private readonly onFocusIn = (event: Event): void => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    )
      this.pause();
  };

  constructor(
    private readonly slides: readonly WrappedSlide[],
    private readonly liquid: LiquidBackground | null,
    private readonly onChange?: (index: number, label: string) => void
  ) {
    this.element = html`<div class="aw-story" tabindex="-1">
      <div class="aw-progress"></div>
      <div class="aw-slides"></div>
      <nav class="aw-nav" aria-label="Story navigation">
        <button type="button" class="aw-nav-button" data-story-prev aria-label="Previous slide">
          <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="aw-nav-button aw-nav-toggle"
          data-story-toggle
          aria-pressed="false"
          aria-label="Play story"
        >
          <i class="fa-solid fa-play" aria-hidden="true"></i
          ><i class="fa-solid fa-pause" aria-hidden="true"></i>
        </button>
        <span class="aw-nav-count" aria-live="polite"></span>
        <button type="button" class="aw-nav-button" data-story-next aria-label="Next slide">
          <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
        </button>
      </nav>
    </div>`;
    const progress = this.element.querySelector('.aw-progress')!;
    const host = this.element.querySelector('.aw-slides')!;
    slides.forEach((slide, index) => {
      const segment = html`<button
        type="button"
        class="aw-progress-segment"
        data-goto="${index}"
        aria-label="${`Slide ${index + 1} of ${slides.length}: ${slide.label}`}"
      >
        <i></i>
      </button>` as HTMLButtonElement;
      this.segments.push(segment);
      progress.append(segment);
      slide.element.classList.add('aw-slide', `aw-slide--${slide.mode ?? 'immersive'}`);
      slide.element.setAttribute('role', 'group');
      slide.element.setAttribute('aria-roledescription', 'slide');
      slide.element.setAttribute('aria-label', `${index + 1} of ${slides.length}: ${slide.label}`);
      host.append(slide.element);
    });
    this.element.addEventListener('click', this.onClick);
    this.element.addEventListener('animationend', this.onFill);
    this.element.addEventListener('focusin', this.onFocusIn);
    if (this.reducedMotion)
      this.element.querySelector<HTMLButtonElement>('[data-story-toggle]')!.hidden = true;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Starts timed advancing (not under reduced motion, not on hold/last slides). */
  play(): void {
    const slide = this.slides[this.index];
    if (this.reducedMotion || !slide || slide.hold || this.index === this.slides.length - 1) {
      this.setPlaying(false);
      return;
    }
    this.setPlaying(true);
  }

  pause(): void {
    this.setPlaying(false);
  }

  private setPlaying(value: boolean): void {
    this.playing = value;
    this.element.classList.toggle('is-playing', value);
    const toggle = this.element.querySelector<HTMLButtonElement>('[data-story-toggle]')!;
    toggle.setAttribute('aria-pressed', String(value));
    toggle.setAttribute('aria-label', value ? 'Pause story' : 'Play story');
  }

  get current(): number {
    return this.index;
  }
  get length(): number {
    return this.slides.length;
  }

  /** Index of the slide with this label, or -1; used to restore a position after slides change. */
  find(label: string): number {
    return this.slides.findIndex((slide) => slide.label === label);
  }

  next(): void {
    this.go(this.index + 1);
  }
  previous(): void {
    this.go(this.index - 1);
  }

  /** Shows a slide. `animate: false` restores a position silently after a re-render. */
  go(requested: number, animate = true): void {
    if (!this.slides.length) return;
    const target = Math.min(this.slides.length - 1, Math.max(0, Math.trunc(requested) || 0));
    if (target === this.index) return;
    const previous = this.slides[this.index];
    const focusInside = !!previous && previous.element.contains(document.activeElement);
    this.stopCounters();
    this.index = target;
    this.element.classList.toggle('aw-story--static', !animate);
    this.slides.forEach((slide, index) => {
      const active = index === target;
      slide.element.classList.toggle('is-active', active);
      slide.element.classList.toggle('is-before', index < target);
      slide.element.toggleAttribute('inert', !active);
      slide.element.setAttribute('aria-hidden', String(!active));
    });
    this.segments.forEach((segment, index) => {
      segment.classList.toggle('is-done', index < target);
      segment.classList.toggle('is-active', index === target);
      if (index === target) segment.setAttribute('aria-current', 'step');
      else segment.removeAttribute('aria-current');
    });
    this.element.querySelector<HTMLButtonElement>('[data-story-prev]')!.disabled = target === 0;
    this.element.querySelector<HTMLButtonElement>('[data-story-next]')!.disabled =
      target === this.slides.length - 1;
    this.element.querySelector('.aw-nav-count')!.textContent =
      `${target + 1} / ${this.slides.length}`;
    const slide = this.slides[target];
    this.element.dataset.mode = slide.mode ?? 'immersive';
    if (this.playing && (slide.hold || target === this.slides.length - 1)) this.setPlaying(false);
    if (animate) slide.element.scrollTop = 0;
    this.liquid?.setPalette(slide.palette, animate);
    slide.element
      .querySelectorAll<HTMLElement>('[data-count]')
      .forEach((counter) => this.countUp(counter, animate));
    slide.onEnter?.(slide.element);
    if (focusInside) this.element.focus({ preventScroll: true });
    this.onChange?.(target, slide.label);
  }

  /** Arrow keys, Page Up/Down, Home and End; ignored while typing in form controls. */
  handleKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    )
      return;
    const moves: Record<string, () => void> = {
      ArrowRight: () => this.next(),
      PageDown: () => this.next(),
      ArrowLeft: () => this.previous(),
      PageUp: () => this.previous(),
      Home: () => this.go(0),
      End: () => this.go(this.slides.length - 1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  }

  dispose(): void {
    this.stopCounters();
    this.setPlaying(false);
    this.element.removeEventListener('click', this.onClick);
    this.element.removeEventListener('animationend', this.onFill);
    this.element.removeEventListener('focusin', this.onFocusIn);
  }

  private stopCounters(): void {
    for (const frame of this.frames) cancelAnimationFrame(frame);
    this.frames.clear();
    this.slides[this.index]?.element
      .querySelectorAll<HTMLElement>('[data-count]')
      .forEach((counter) => {
        counter.textContent = formatNumber(
          Number(counter.dataset.count),
          Number(counter.dataset.decimals ?? 0)
        );
      });
  }

  private countUp(counter: HTMLElement, animate: boolean): void {
    const value = Number(counter.dataset.count);
    const decimals = Number(counter.dataset.decimals ?? 0);
    if (!Number.isFinite(value)) return;
    if (
      !animate ||
      this.reducedMotion ||
      typeof requestAnimationFrame !== 'function' ||
      value === 0
    ) {
      counter.textContent = formatNumber(value, decimals);
      return;
    }
    const start = performance.now();
    const step = (now: number): void => {
      this.frames.delete(frame);
      const progress = Math.min(1, (now - start) / COUNT_DURATION_MS);
      const eased = 1 - (1 - progress) ** 4;
      counter.textContent = formatNumber(
        decimals ? value * eased : Math.round(value * eased),
        decimals
      );
      if (progress < 1) {
        frame = requestAnimationFrame(step);
        this.frames.add(frame);
      }
    };
    let frame = requestAnimationFrame(step);
    this.frames.add(frame);
  }
}

/** Empty slide shell; content goes into `.aw-slide-inner`. */
export function slideShell(modifier: string, extraClass = ''): HTMLElement {
  return html`<section class="${`aw-slide--${modifier} ${extraClass}`.trim()}">
    <div class="aw-slide-inner"></div>
  </section>`;
}

export function inner(slide: HTMLElement): HTMLElement {
  return slide.querySelector<HTMLElement>('.aw-slide-inner')!;
}

/** Count-up figure: the final value is in the DOM before any animation. */
export function counter(value: number, decimals = 0, className = 'aw-giant'): HTMLElement {
  const element = document.createElement('strong');
  element.className = className;
  element.dataset.count = String(value);
  if (decimals) element.dataset.decimals = String(decimals);
  element.textContent = formatNumber(value, decimals);
  return element;
}

/** Cover art when AniList supplied an HTTP(S) URL; otherwise a typographic tile. */
export function coverArt(
  url: string | null | undefined,
  title: string,
  className = 'aw-cover'
): HTMLElement {
  const frame = document.createElement('div');
  frame.className = className;
  const parsed = url ? parseWebUrl(url) : null;
  if (parsed) {
    const image = document.createElement('img');
    image.src = parsed.href;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    frame.append(image);
  } else {
    frame.classList.add('is-empty');
    const initial = document.createElement('span');
    initial.textContent = [...title.trim()][0]?.toUpperCase() ?? '★';
    frame.append(initial);
  }
  return frame;
}

/** Staggered entrance: `order` maps to `.aw-d1`…`.aw-d8` delays. */
export function rise<T extends Element>(element: T, order = 0): T {
  element.classList.add('aw-rise', `aw-d${Math.min(8, Math.max(0, order))}`);
  return element;
}

/** Staggered list entrance driven by the `--i` custom property. */
export function stagger<T extends HTMLElement>(element: T, index: number): T {
  element.classList.add('aw-rise-item');
  element.style.setProperty('--i', String(index));
  return element;
}

export function eyebrow(text: string): HTMLElement {
  return html`<span class="aw-eyebrow">${text}</span>`;
}
export function kicker(text: string): HTMLElement {
  return html`<p class="aw-kicker">${text}</p>`;
}
export function note(text: string): HTMLElement {
  return html`<p class="aw-note">${text}</p>`;
}

/** Poster-sized count-up whose size adapts to its character count (`--chars`). */
export function displayNumber(value: number, decimals = 0): HTMLElement {
  const element = counter(value, decimals, 'aw-display aw-display--number');
  element.style.setProperty('--chars', String(Math.max(2, formatNumber(value, decimals).length)));
  return element;
}

/** Poster headline sized by length; long custom ranges wrap instead of overflowing. */
export function display(text: string): HTMLElement {
  const element = html`<h3 class="aw-display">${text}</h3>`;
  element.style.setProperty('--chars', String(Math.max(3, [...text].length)));
  return element;
}

/** Decorative scrolling band (content duplicated for a seamless loop); hidden from assistive tech. */
export function marquee(words: readonly string[], reverse = false): HTMLElement {
  const band = html`<div
    class="${reverse ? 'aw-marquee aw-marquee--reverse' : 'aw-marquee'}"
    aria-hidden="true"
  >
    <div class="aw-marquee-track"></div>
  </div>`;
  const track = band.firstElementChild!;
  const items = words.length ? words : ['Stories'];
  const repeats = Math.max(2, Math.ceil(8 / items.length));
  for (let copy = 0; copy < 2; copy++) {
    for (let round = 0; round < repeats; round++) {
      for (const word of items) track.append(html`<span>${word}</span>`, html`<i>✦</i>`);
    }
  }
  return band;
}

/** Hero number with its unit underneath. */
export function figure(value: number, unit: string, decimals = 0): HTMLElement {
  const element = html`<div class="aw-figure"><span class="aw-unit">${unit}</span></div>`;
  element.prepend(counter(value, decimals));
  return element;
}

/** Secondary statistic: number, label and optional caption. */
export function fact(value: number, label: string, caption = '', decimals = 0): HTMLElement {
  const element = html`<div class="aw-fact"><span>${label}</span><small>${caption}</small></div>`;
  element.prepend(counter(value, decimals, 'aw-fact-value'));
  if (!caption) element.querySelector('small')!.remove();
  return element;
}

/** Row of pills; a null value renders a text-only pill. */
export function pills(items: ReadonlyArray<readonly [number | null, string]>): HTMLElement {
  const row = document.createElement('div');
  row.className = 'aw-pills';
  for (const [value, label] of items) {
    const pill = document.createElement('span');
    pill.className = 'aw-pill';
    if (value === null) pill.textContent = label;
    else {
      const bold = document.createElement('b');
      bold.textContent = formatNumber(value);
      pill.append(bold, ` ${label}`);
    }
    row.append(pill);
  }
  return row;
}

/** Placeholder frame for the share-card preview, filled lazily by previewOnce(). */
export function cardPreview(
  attribute: 'data-wrapped-preview' | 'data-seasonal-preview'
): HTMLElement {
  const figure = html`<figure class="aw-card-preview">
    <div class="aw-card-placeholder"></div>
    <figcaption>Your story card · 1080 × 1920</figcaption>
  </figure>`;
  figure.setAttribute(attribute, '');
  return figure;
}

/** Renders the share-card preview once, after the slide transition; failures keep the placeholder. */
export function previewOnce(render: () => HTMLCanvasElement): (slide: HTMLElement) => void {
  let started = false;
  return (slide) => {
    if (started) return;
    started = true;
    setTimeout(() => {
      const figure = slide.querySelector('[data-wrapped-preview], [data-seasonal-preview]');
      if (!figure?.isConnected) return;
      try {
        const canvas = render();
        if (!(canvas instanceof HTMLCanvasElement)) return;
        canvas.classList.add('aw-card-canvas');
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'Preview of the downloadable story card');
        figure.querySelector('.aw-card-placeholder')?.replaceWith(canvas);
      } catch {
        // No canvas support: the placeholder stays; Download reports its own errors.
      }
    }, PREVIEW_DELAY_MS);
  };
}
