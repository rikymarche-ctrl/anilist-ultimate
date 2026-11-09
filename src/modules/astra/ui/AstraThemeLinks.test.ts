import { describe, expect, it, vi } from 'vitest';
import { decorateThemeLinks, type AstraThemeLinkSource } from './AstraThemeLinks';
import { withThemeRating, type ThemeRatingArchive } from '../store/AstraThemeRatings';
import type { AstraSection } from '../AstraInterfaces';
import type { ThemePromptSong } from '@core/interfaces/IThemeRatingPrompt';

const sections: AstraSection[] = [
  {
    id: 'sound',
    name: 'Sound',
    weight: 1,
    subSections: [{ id: 'outro', name: 'Outro', weight: 1, source: 'ED' }],
  },
];
const songs: ThemePromptSong[] = ['a', 'b', 'c', 'd'].map((title, i) => ({
  id: `5:ED:${i + 1}:${title}`,
  kind: 'ED',
  title,
  artist: '',
}));

function source(
  archive: ThemeRatingArchive = {},
  list: ThemePromptSong[] | null = songs
): AstraThemeLinkSource & { archive: () => ThemeRatingArchive } {
  let current = archive;
  return {
    archive: () => current,
    getRatings: async () => current[5] ?? { ratings: {} },
    getSongs: async () => list,
    saveSongScore: vi.fn(async (_mediaId: number, song: ThemePromptSong, score: number | null) => {
      current = withThemeRating(
        current,
        5,
        song.id,
        score === null ? null : { score, kind: song.kind, title: song.title }
      );
      return current[5] ?? { ratings: {} };
    }),
  };
}

function overlay() {
  const root = document.createElement('div');
  root.innerHTML = `<div class="astra-overall-area"></div>
    <div class="astra-score-input astra-score-input--sub" data-id="sound_outro"><div class="astra-label-left"></div>
    <input class="astra-score-num-input"><div class="astra-slider-row"><input type="range" class="astra-slider" min="0" max="10" step="0.1" value="5"></div></div>`;
  return root;
}

const rate = (row: Element, value: string) => {
  const slider = row.querySelector<HTMLInputElement>('.au-theme-rate__slider')!;
  slider.value = value;
  slider.dispatchEvent(new Event('change'));
};

describe('decorateThemeLinks', () => {
  it('lists every song and uses the mean of the rated ones only (3 of 4 → each 1/3)', async () => {
    let archive: ThemeRatingArchive = {};
    archive = withThemeRating(archive, 5, songs[0].id, { score: 9, kind: 'ED', title: 'a' });
    archive = withThemeRating(archive, 5, songs[1].id, { score: 6, kind: 'ED', title: 'b' });
    const root = overlay();
    const input = vi.fn();
    root.addEventListener('input', input);
    const linkSource = source(archive);
    await decorateThemeLinks(root, 5, sections, linkSource, () => true);
    const slider = root.querySelector<HTMLInputElement>('.astra-slider')!;
    expect(root.querySelectorAll('.astra-theme-song')).toHaveLength(4);
    expect(slider.value).toBe('7.5');
    expect(root.querySelector('.astra-theme-linked-note')!.textContent).toBe(
      'mean of endings · 2/4 rated'
    );

    rate(root.querySelectorAll('.astra-theme-song')[2], '3');
    await vi.waitFor(() => expect(slider.value).toBe('6'));
    expect(input).toHaveBeenCalledTimes(2);
    expect(root.querySelector('.astra-theme-linked-note')!.textContent).toBe(
      'mean of endings · 3/4 rated'
    );
    expect(root.querySelector('.astra-theme-means')!.textContent).toBe('ED 6.0');
  });

  it('explains an unavailable song list and leaves older seasons alone', async () => {
    const root = overlay();
    await decorateThemeLinks(root, 5, sections, source({}, null), () => true);
    expect(root.querySelector('.astra-theme-songs')!.textContent).toContain(
      'Could not load the endings'
    );
    const old = overlay();
    await decorateThemeLinks(old, 5, sections, source(), () => true, false);
    expect(old.querySelector('.astra-theme-songs')).toBeNull();
    expect(old.querySelector<HTMLInputElement>('.astra-slider')!.value).toBe('5');
  });
});
