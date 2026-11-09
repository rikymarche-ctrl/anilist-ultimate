import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IThemeRatingPrompt, ThemeRatingAvailability } from '@core/interfaces/IThemeRatingPrompt';
import { mountThemeRatings } from './MediaThemeRatings';

const THEMES = { openings: ['1: "First" by A (eps 1-12)', '2: "Second" by A (eps 13-24)'], endings: ['1: "Last" by B'] };

function page(): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = ['OP:0', 'OP:1', 'ED:0']
    .map((id) => `<div data-au-theme-card="${id}"><div class="au-theme-rate-slot"></div></div>`)
    .join('');
  document.body.append(container);
  return container;
}

function prompt(availability: ThemeRatingAvailability): IThemeRatingPrompt {
  return {
    availability: vi.fn(async () => availability),
    findNewThemes: vi.fn(async () => []),
    getScores: vi.fn(async () => ({})),
    rate: vi.fn(async () => {}),
  };
}

const slots = (container: HTMLElement) =>
  [...container.querySelectorAll('.au-theme-rate-slot')].map((slot) =>
    slot.querySelector('.au-theme-rate-hint') ? 'hint' : slot.childElementCount ? 'slider' : 'empty'
  );

describe('mountThemeRatings', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows nothing when song ratings are off', async () => {
    const container = page();
    await mountThemeRatings(container, 5, THEMES, prompt({ enabled: false, kinds: { OP: 'linked', ED: 'linked' } }), () => true);
    expect(slots(container)).toEqual(['empty', 'empty', 'empty']);
  });

  it('shows sliders for set-up kinds and one reminder for a kind never set up', async () => {
    const container = page();
    await mountThemeRatings(container, 5, THEMES, prompt({ enabled: true, kinds: { OP: 'unset', ED: 'linked' } }), () => true);
    expect(slots(container)).toEqual(['hint', 'empty', 'slider']);
    expect(container.querySelector('.au-theme-rate-hint')!.textContent).toContain('for Openings');
    expect(container.querySelector('.au-theme-rate__tag')).toBeNull();
  });

  it('rates "Not counted" songs too, tagged as such', async () => {
    const container = page();
    await mountThemeRatings(container, 5, THEMES, prompt({ enabled: true, kinds: { OP: 'uncounted', ED: 'linked' } }), () => true);
    expect(slots(container)).toEqual(['slider', 'slider', 'slider']);
    const tags = [...container.querySelectorAll('[data-au-theme-card]')].map((card) => !!card.querySelector('.au-theme-rate__tag'));
    expect(tags).toEqual([true, true, false]);
  });
});
