import { afterEach, describe, expect, it } from 'vitest';
import { HomeProgressStrategy } from './HomeProgressStrategy';

afterEach(() => { document.body.innerHTML = ''; });

describe('HomeProgressStrategy', () => {
  it('returns individual Trending cards instead of wrappers and nested covers', () => {
    document.body.innerHTML = `
      <section class="list-preview-wrap">
        <h2>Trending Anime &amp; Manga</h2>
        <div class="media-preview-card-wrap">
          <article class="media-preview-card"><a class="cover" href="/anime/101/first"></a></article>
          <article class="media-preview-card"><a class="cover" href="/manga/202/second"></a></article>
        </div>
      </section>`;
    const strategy = new HomeProgressStrategy();
    const cards = strategy.getCards();

    expect(cards).toEqual(Array.from(document.querySelectorAll('.media-preview-card')));
    expect(cards.map(card => card.querySelector('a')?.getAttribute('href'))).toEqual([
      '/anime/101/first', '/manga/202/second',
    ]);
  });
});
