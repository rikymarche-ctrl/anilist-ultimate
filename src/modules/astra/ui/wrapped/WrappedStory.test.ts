import { afterEach, describe, expect, it, vi } from 'vitest';
import { html } from '@core/utils/Template';
import { LIQUID_PALETTES, LiquidBackground } from './LiquidBackground';
import {
  WrappedStory,
  cardPreview,
  counter,
  coverArt,
  display,
  displayNumber,
  marquee,
  previewOnce,
  type WrappedSlide,
} from './WrappedStory';

const stories: WrappedStory[] = [];
afterEach(() => {
  for (const story of stories.splice(0)) story.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function deck(
  count = 3,
  liquid: LiquidBackground | null = null,
  onChange?: (index: number) => void
) {
  const slides: WrappedSlide[] = Array.from({ length: count }, (_, index) => ({
    label: `Slide ${index}`,
    palette: index % 2 ? LIQUID_PALETTES.ocean : LIQUID_PALETTES.nebula,
    element: html`<section>
      <div class="aw-slide-inner">
        <input data-field="${index}" /><strong data-count="1234">1,234</strong>
      </div>
    </section>`,
  }));
  const story = new WrappedStory(slides, liquid, onChange);
  stories.push(story);
  document.body.append(story.element);
  return {
    story,
    slides,
    button: (selector: string) => story.element.querySelector<HTMLButtonElement>(selector)!,
  };
}

describe('WrappedStory', () => {
  it('shows exactly one active slide and keeps inactive slides inert but queryable', () => {
    const { story, slides } = deck();
    story.go(1);
    expect(slides.map((slide) => slide.element.classList.contains('is-active'))).toEqual([
      false,
      true,
      false,
    ]);
    expect(slides[0].element.hasAttribute('inert')).toBe(true);
    expect(slides[0].element.getAttribute('aria-hidden')).toBe('true');
    expect(slides[1].element.hasAttribute('inert')).toBe(false);
    expect(story.element.querySelectorAll('[data-field]')).toHaveLength(3);
    expect(story.element.querySelector('.aw-nav-count')!.textContent).toBe('2 / 3');
  });

  it('clamps navigation and disables the edge controls', () => {
    const { story, button } = deck();
    story.go(0);
    expect(button('[data-story-prev]').disabled).toBe(true);
    story.previous();
    expect(story.current).toBe(0);
    story.go(99);
    expect(story.current).toBe(2);
    expect(button('[data-story-next]').disabled).toBe(true);
    story.go(Number.NaN);
    expect(story.current).toBe(0);
  });

  it('navigates through progress segments, buttons and restart controls', () => {
    const changes: number[] = [];
    const { story, button } = deck(4, null, (index) => changes.push(index));
    expect(story.find('Slide 2')).toBe(2);
    expect(story.find('Missing')).toBe(-1);
    story.go(0);
    button('[data-goto="2"]').click();
    expect(story.current).toBe(2);
    expect(button('[data-goto="2"]').getAttribute('aria-current')).toBe('step');
    expect(button('[data-goto="1"]').classList.contains('is-done')).toBe(true);
    button('[data-story-next]').click();
    expect(story.current).toBe(3);
    story.element
      .querySelector('.aw-slides')!
      .append(html`<button type="button" data-story-restart>Again</button>`);
    story.element.querySelector<HTMLButtonElement>('[data-story-restart]')!.click();
    expect(story.current).toBe(0);
    expect(changes).toEqual([0, 2, 3, 0]);
  });

  it('handles arrow, page and edge keys but never while typing in a field', () => {
    const { story, slides } = deck();
    story.go(0);
    const press = (key: string, target: EventTarget = story.element) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'target', { value: target });
      story.handleKey(event);
      return event;
    };
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    expect(story.current).toBe(1);
    press('End');
    expect(story.current).toBe(2);
    press('PageUp');
    expect(story.current).toBe(1);
    press('Home');
    expect(story.current).toBe(0);
    press('ArrowRight', slides[0].element.querySelector('input')!);
    expect(story.current).toBe(0);
    expect(press('a').defaultPrevented).toBe(false);
  });

  it('leaves final counter values in place without animation and after leaving a slide', () => {
    const { story, slides } = deck();
    story.go(1, false);
    expect(slides[1].element.querySelector('[data-count]')!.textContent).toBe('1,234');
    story.go(2);
    story.go(1);
    story.go(0);
    expect(slides[1].element.querySelector('[data-count]')!.textContent).toBe('1,234');
  });

  it('marks silent restores as static and passes slide palettes to the backdrop', () => {
    const liquid = { setPalette: vi.fn() } as unknown as LiquidBackground;
    const { story } = deck(3, liquid);
    story.go(2, false);
    expect(story.element.classList.contains('aw-story--static')).toBe(true);
    expect(liquid.setPalette).toHaveBeenLastCalledWith(LIQUID_PALETTES.nebula, false);
    story.go(1);
    expect(story.element.classList.contains('aw-story--static')).toBe(false);
    expect(liquid.setPalette).toHaveBeenLastCalledWith(LIQUID_PALETTES.ocean, true);
  });

  it('stops reacting to clicks after dispose', () => {
    const { story, button } = deck();
    story.go(0);
    story.dispose();
    button('[data-story-next]').click();
    expect(story.current).toBe(0);
  });
});

describe('WrappedStory modes and autoplay', () => {
  function modal(holdAt = 2) {
    const slides: WrappedSlide[] = Array.from({ length: 4 }, (_, index) => ({
      label: `Slide ${index}`,
      palette: LIQUID_PALETTES.vividNebula,
      mode: index === 0 ? 'poster' : 'immersive',
      hold: index === holdAt,
      element: html`<section>
        <div class="aw-slide-inner">
          <button type="button" data-story-next data-story-play>Play</button
          ><select>
            <option>x</option>
          </select>
        </div>
      </section>`,
    }));
    const story = new WrappedStory(slides, null);
    stories.push(story);
    document.body.append(story.element);
    story.go(0);
    const fill = () =>
      story.element
        .querySelector('.aw-progress-segment.is-active i')!
        .dispatchEvent(
          Object.assign(new Event('animationend', { bubbles: true }), { animationName: 'aw-fill' })
        );
    return {
      story,
      slides,
      fill,
      toggle: () => story.element.querySelector<HTMLButtonElement>('[data-story-toggle]')!,
    };
  }

  it('tags slides with their mode and exposes the active mode for the backdrop', () => {
    const { story, slides } = modal();
    expect(slides[0].element.classList.contains('aw-slide--poster')).toBe(true);
    expect(slides[1].element.classList.contains('aw-slide--immersive')).toBe(true);
    expect(story.element.dataset.mode).toBe('poster');
    story.next();
    expect(story.element.dataset.mode).toBe('immersive');
  });

  it('starts from the intro call to action, advances on each filled segment and stops on hold slides', () => {
    const { story, slides, fill, toggle } = modal();
    slides[0].element.querySelector<HTMLButtonElement>('[data-story-play]')!.click();
    expect(story.current).toBe(1);
    expect(story.isPlaying).toBe(true);
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    fill();
    expect(story.current).toBe(2);
    expect(story.isPlaying).toBe(false);
    fill();
    expect(story.current).toBe(2);
  });

  it('ignores unrelated animations, pauses on form use and never plays on the last slide', () => {
    const { story, fill, toggle } = modal(-1);
    story.go(1);
    toggle().click();
    expect(story.isPlaying).toBe(true);
    story.element
      .querySelector('.aw-progress-segment.is-active i')!
      .dispatchEvent(
        Object.assign(new Event('animationend', { bubbles: true }), { animationName: 'aw-rise' })
      );
    expect(story.current).toBe(1);
    story.element
      .querySelector<HTMLSelectElement>('.aw-slide.is-active select')!
      .dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(story.isPlaying).toBe(false);
    story.play();
    fill();
    fill();
    expect(story.current).toBe(3);
    expect(story.isPlaying).toBe(false);
    story.play();
    expect(story.isPlaying).toBe(false);
  });
});

describe('Wrapped slide helpers', () => {
  it('sizes poster type by character count and duplicates marquee content for a seamless loop', () => {
    expect(display('2026').style.getPropertyValue('--chars')).toBe('4');
    expect(displayNumber(12345).style.getPropertyValue('--chars')).toBe('6');
    expect(displayNumber(7).style.getPropertyValue('--chars')).toBe('2');
    const band = marquee(['Fantasy', '<b>Drama</b>']);
    expect(band.getAttribute('aria-hidden')).toBe('true');
    expect(band.querySelector('b')).toBeNull();
    const words = [...band.querySelectorAll('span')].map((span) => span.textContent);
    expect(words.length % 2).toBe(0);
    expect(words.slice(0, words.length / 2)).toEqual(words.slice(words.length / 2));
  });

  it('renders the card preview once, after the transition, and only while connected', () => {
    vi.useFakeTimers();
    try {
      const slide = html`<section></section>`;
      slide.append(cardPreview('data-wrapped-preview'));
      document.body.append(slide);
      const render = vi.fn(() => document.createElement('canvas'));
      const enter = previewOnce(render);
      enter(slide);
      enter(slide);
      expect(render).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(render).toHaveBeenCalledOnce();
      expect(slide.querySelector('canvas.aw-card-canvas')).not.toBeNull();
      expect(slide.querySelector('.aw-card-placeholder')).toBeNull();
      const detached = html`<section></section>`;
      detached.append(cardPreview('data-wrapped-preview'));
      const unused = vi.fn(() => document.createElement('canvas'));
      previewOnce(unused)(detached);
      vi.runAllTimers();
      expect(unused).not.toHaveBeenCalled();
      const failing = html`<section></section>`;
      failing.append(cardPreview('data-wrapped-preview'));
      document.body.append(failing);
      previewOnce(() => {
        throw new Error('no canvas');
      })(failing);
      expect(() => vi.runAllTimers()).not.toThrow();
      expect(failing.querySelector('.aw-card-placeholder')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('formats counters with their decimals', () => {
    expect(counter(8.456, 2).textContent).toBe('8.46');
    expect(counter(12000).dataset.count).toBe('12000');
  });

  it('only renders HTTP(S) covers and falls back to an escaped initial', () => {
    expect(
      coverArt('https://s4.anilist.co/file/cover.jpg', 'Frieren').querySelector('img')!.src
    ).toBe('https://s4.anilist.co/file/cover.jpg');
    const unsafe = coverArt('javascript:alert(1)', '<b>x</b>');
    expect(unsafe.querySelector('img')).toBeNull();
    expect(unsafe.textContent).toBe('<');
    expect(coverArt(null, '').textContent).toBe('★');
  });
});

describe('LiquidBackground without WebGL', () => {
  it('falls back to CSS blobs, exposes palette variables and disposes safely', () => {
    const host = document.createElement('section');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    const liquid = new LiquidBackground(canvas, host, LIQUID_PALETTES.lava, 7);
    expect(liquid.isLive).toBe(false);
    expect(host.classList.contains('aw-liquid-fallback')).toBe(true);
    expect(host.style.getPropertyValue('--aw-accent')).toBe(LIQUID_PALETTES.lava.accent);
    liquid.setPalette(LIQUID_PALETTES.ocean);
    expect(host.style.getPropertyValue('--aw-c3')).toBe(LIQUID_PALETTES.ocean.colors[2]);
    liquid.dispose();
    liquid.dispose();
    liquid.setPalette(LIQUID_PALETTES.rose);
    expect(host.style.getPropertyValue('--aw-c3')).toBe(LIQUID_PALETTES.ocean.colors[2]);
  });
});
