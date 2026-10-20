import { afterEach, describe, expect, it } from 'vitest';
import { AstraEnhancementService } from './AstraEnhancementService';
import { PillUIBuilder } from '../ui/PillUIBuilder';
import type { ICardEnhancementStrategy } from '../strategies/ICardEnhancementStrategy';
import { HomeProgressStrategy } from '../strategies/HomeProgressStrategy';

afterEach(() => { document.body.innerHTML = ''; });

function serviceFor(card: HTMLElement): AstraEnhancementService {
  const strategy: ICardEnhancementStrategy = {
    name: 'fixture',
    canHandle: () => true,
    getCards: () => [card],
    shouldEnhanceCard: () => true,
  };
  return new AstraEnhancementService(
    new PillUIBuilder(),
    [strategy],
    { isFeatureEnabled: () => true } as never,
    { getPreferences: () => ({ socialEnabled: false, socialShowAvatars: false }) } as never,
  );
}

describe('Astra card pill injection', () => {
  it('keeps editable media cards inside generic header wrappers eligible', () => {
    document.body.innerHTML = '<div class="header"><article class="media-card"><a href="/anime/16498/attack-on-titan">Attack on Titan</a></article></div>';
    const card = document.querySelector<HTMLElement>('.media-card')!;

    serviceFor(card).enhanceCards('/anime/16498/attack-on-titan');

    expect(card.querySelector('.au-pill-wrapper')?.getAttribute('data-au-media-id')).toBe('16498');
    expect(card.querySelector('[data-action="edit-entry"]')).not.toBeNull();
  });

  it('still excludes cards from navigation search', () => {
    document.body.innerHTML = '<nav class="nav"><article class="media-card"><a href="/anime/16498/attack-on-titan">Attack on Titan</a></article></nav>';
    const card = document.querySelector<HTMLElement>('.media-card')!;

    serviceFor(card).enhanceCards('/anime/16498/attack-on-titan');

    expect(card.querySelector('.au-pill-wrapper')).toBeNull();
  });

  it('binds each Trending pill to its own media instead of the surrounding section', () => {
    document.body.innerHTML = `
      <section class="list-preview-wrap">
        <h2>Trending Anime &amp; Manga</h2>
        <div class="media-preview-card-wrap">
          <article class="media-preview-card"><a class="cover" href="/anime/101/first"></a></article>
          <article class="media-preview-card"><a class="cover" href="/manga/202/second"></a></article>
        </div>
      </section>`;
    const strategy = new HomeProgressStrategy();
    const service = new AstraEnhancementService(
      new PillUIBuilder(), [strategy], { isFeatureEnabled: () => true } as never,
      { getPreferences: () => ({ socialEnabled: false, socialShowAvatars: false }) } as never,
    );

    service.enhanceCards('/');

    expect(Array.from(document.querySelectorAll('.media-preview-card .au-pill-wrapper'))
      .map(wrapper => wrapper.getAttribute('data-au-media-id'))).toEqual(['101', '202']);
    expect(document.querySelector('.media-preview-card-wrap > .au-pill-wrapper')).toBeNull();
    expect(document.querySelectorAll('[data-action="edit-entry"]')).toHaveLength(2);
  });

  it('does not add a pill to an ambiguous container with several media links', () => {
    document.body.innerHTML = `
      <div class="section-wrap">
        <a href="/anime/101/first"></a>
        <a href="/manga/202/second"></a>
      </div>`;
    const container = document.querySelector<HTMLElement>('.section-wrap')!;

    serviceFor(container).enhanceCards('/');

    expect(container.querySelector('.au-pill-wrapper')).toBeNull();
  });
});
